import { getStore } from '@netlify/blobs';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { jsonResponse } from './_admin-auth.mjs';
import { profileStore, digest, validId, linkKey, signedInAccount, ownsGame, safeAccount } from './_player-profiles.mjs';

const derive = promisify(scrypt);
const usernamePattern = /^[a-z0-9_]{3,32}$/;
const sessionLifetime = 30 * 24 * 60 * 60;
const normalizeUsername = value => String(value || '').trim().toLowerCase();
function reply(body,status=200,cookie) {
  const response = jsonResponse(body,status);
  if (cookie) response.headers.set('Set-Cookie',cookie);
  return response;
}
function cookieFor(request,token,maxAge=sessionLifetime) {
  return `poker_player=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function newSession(request,account,store) {
  const token = randomBytes(32).toString('hex');
  await store.setJSON(`sessions/${digest(token)}`,{username:account.username,expiresAt:Date.now()+sessionLifetime*1000});
  return reply({account:safeAccount(account)},200,cookieFor(request,token));
}
async function takeRateSlot(store,scope,limit) {
  const bucket = Math.floor(Date.now()/(15*60*1000));
  for (let i=0;i<limit;i++) {
    const result = await store.setJSON(`limits/${digest(scope)}/${bucket}/${i}`,{at:Date.now()},{onlyIfNew:true});
    if (result.modified) return true;
  }
  return false;
}
function requestKey(game,player,account) {return `requests/${game}/${player}/${account}`;}
export function createAccountHandler(getProfiles=profileStore,getGames=()=>getStore({name:'poker-live-games',consistency:'strong'})) {
  return async (request,context={}) => {
    try {
      if (!['GET','POST'].includes(request.method)) return reply({error:'Method not allowed'},405);
      const store=getProfiles();
      if (request.method==='GET') {
        const entry=await signedInAccount(request,store);
        if (!entry) return reply({error:'Sign in to manage your payment details'},401);
        const connectedPlayerIds=[];
        const gameId=new URL(request.url).searchParams.get('gameId');
        if (validId(gameId)) {
          for await (const page of store.list({prefix:`links/${gameId}/`,paginate:true})) {
            for (const blob of page.blobs) {
              const link=await store.get(blob.key,{type:'json'});
              if (link?.accountId===entry.data.id) connectedPlayerIds.push(blob.key.split('/').pop());
            }
          }
        }
        return reply({account:safeAccount(entry.data),connectedPlayerIds});
      }
      if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({error:'Request must come from this site'},403);
      const raw=await request.text();
      if (raw.length>8000) return reply({error:'Request too large'},413);
      let body;
      try {body=JSON.parse(raw);} catch {return reply({error:'Invalid request'},400);}
      const action=body.action;
      if (['register','login'].includes(action)) {
        const username=normalizeUsername(body.username);
        const password=String(body.password || '');
        if (!usernamePattern.test(username)) return reply({error:'Username must be 3–32 letters, numbers or underscores'},400);
        if (password.length<10 || password.length>128) return reply({error:'Use a password with 10–128 characters'},400);
        if (!await takeRateSlot(store,`ip:${context.ip || 'unknown'}`,40) || !await takeRateSlot(store,`user:${username}`,10)) return reply({error:'Too many attempts. Try again in 15 minutes.'},429);
        const key=`accounts/${username}`;
        const existing=await store.get(key,{type:'json'});
        if (action==='register') {
          const displayName=String(body.displayName || '').trim();
          if (!displayName || displayName.length>80) return reply({error:'Enter your name (up to 80 characters)'},400);
          if (existing) return reply({error:'That username is already taken. Sign in or choose another.'},409);
          const salt=randomBytes(16).toString('hex');
          const passwordHash=(await derive(password,salt,64)).toString('hex');
          const account={id:randomUUID(),username,displayName,passwordHash,salt,payId:'',beemHandle:'',revision:1};
          const result=await store.setJSON(key,account,{onlyIfNew:true});
          if (!result.modified) return reply({error:'That username is already taken'},409);
          return await newSession(request,account,store);
        }
        const candidate=await derive(password,existing?.salt || '00000000000000000000000000000000',64);
        if (!existing || !timingSafeEqual(Buffer.from(existing.passwordHash,'hex'),candidate)) return reply({error:'Incorrect username or password'},401);
        return await newSession(request,existing,store);
      }
      if (action==='logout') {
        const token=(request.headers.get('Cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('poker_player='))?.slice(13);
        if (token && /^[a-f0-9]{64}$/.test(token)) await store.delete(`sessions/${digest(token)}`);
        return reply({ok:true},200,cookieFor(request,'',0));
      }
      if (action==='host-requests' || action==='approve' || action==='reject') {
        if (!validId(body.gameId)) return reply({error:'Invalid game'},400);
        const game=await getGames().get(`games/${body.gameId}`,{type:'json'});
        if (!ownsGame(game,request)) return reply({error:'Only the host can confirm player accounts'},403);
        if (action==='host-requests') {
          const requests=[];
          for await (const page of store.list({prefix:`requests/${body.gameId}/`,paginate:true})) {
            for (const blob of page.blobs) {
              const item=await store.get(blob.key,{type:'json'});
              if (!item || item.status!=='pending') continue;
              const player=game.state.players.find(p=>p.id===item.playerId);
              const account=await store.get(`accounts/${item.username}`,{type:'json'});
              if (player && account?.id===item.accountId) requests.push({playerId:player.id,playerName:player.name,accountId:account.id,username:account.username,displayName:account.displayName});
            }
          }
          return reply({requests});
        }
        if (!validId(body.playerId) || !validId(body.accountId)) return reply({error:'Invalid player'},400);
        const key=requestKey(body.gameId,body.playerId,body.accountId);
        const item=await store.get(key,{type:'json'});
        if (!item || item.status!=='pending' || !game.state.players.some(p=>p.id===body.playerId)) return reply({error:'Request no longer available'},404);
        if (action==='approve') {
          const linked=await store.setJSON(linkKey(body.gameId,body.playerId),{username:item.username,accountId:item.accountId},{onlyIfNew:true});
          if (!linked.modified) {
            const current=await store.get(linkKey(body.gameId,body.playerId),{type:'json'});
            if (current.accountId!==item.accountId) return reply({error:'This player already has a connected account'},409);
          }
        }
        await store.setJSON(key,{...item,status:action==='approve'?'approved':'rejected'});
        return reply({ok:true});
      }
      const entry=await signedInAccount(request,store);
      if (!entry) return reply({error:'Please sign in again'},401);
      const account=entry.data;
      if (action==='save') {
        const payId=String(body.payId || '').trim();
        const beemHandle=String(body.beemHandle || '').trim().replace(/^@/,'');
        if (payId.length>160 || beemHandle.length>32 || (beemHandle && !/^[a-zA-Z0-9_.-]+$/.test(beemHandle))) return reply({error:'Check your PayID and Beem username'},400);
        if (body.revision!==account.revision) return reply({error:'Your profile changed in another tab. Reload before saving.'},409);
        const next={...account,payId,beemHandle,revision:account.revision+1};
        const result=await store.setJSON(`accounts/${account.username}`,next,{onlyIfMatch:entry.etag});
        if (!result.modified) return reply({error:'Your profile changed in another tab. Reload before saving.'},409);
        return reply({account:safeAccount(next)});
      }
      if (action==='connect' || action==='connection') {
        if (!validId(body.gameId) || !validId(body.playerId)) return reply({error:'Choose your player in the game'},400);
        const game=await getGames().get(`games/${body.gameId}`,{type:'json'});
        if (!game || !game.state.players.some(p=>p.id===body.playerId)) return reply({error:'Player not found in this game'},404);
        const link=await store.get(linkKey(body.gameId,body.playerId),{type:'json'});
        if (link) return reply({status:link.accountId===account.id?'approved':'unavailable'});
        const key=requestKey(body.gameId,body.playerId,account.id);
        const previous=await store.get(key,{type:'json'});
        if (action==='connection') return reply({status:previous?.status || 'not-connected'});
        if (body.share !== true) return reply({error:'Confirm sharing your PayID and Beem username with this game'},400);
        // One pending request per account in this game keeps the host's list clear.
        for await (const page of store.list({prefix:`requests/${body.gameId}/`,paginate:true})) {
          for (const blob of page.blobs) {
            const item=await store.get(blob.key,{type:'json'});
            if (item?.accountId===account.id && item.status==='pending' && blob.key!==key) await store.setJSON(blob.key,{...item,status:'cancelled'});
          }
        }
        await store.setJSON(key,{playerId:body.playerId,accountId:account.id,username:account.username,status:'pending',createdAt:new Date().toISOString()});
        return reply({status:'pending'});
      }
      return reply({error:'Unknown action'},400);
    } catch {
      return reply({error:'Player account service is unavailable. Please try again.'},503);
    }
  };
}
export default createAccountHandler();
export const config={path:'/.netlify/functions/player-account'};
