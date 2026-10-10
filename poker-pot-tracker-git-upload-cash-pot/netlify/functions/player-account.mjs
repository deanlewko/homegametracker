import { getStore } from '@netlify/blobs';
import { profileStore, validId, paymentProfilesForGame } from './_player-profiles.mjs';
import { jsonResponse } from './_admin-auth.mjs';

// The game link permits payment-detail edits only; balances remain host-only.
export function createPaymentHandler(getProfiles = profileStore, getGames = () => getStore({name:'poker-live-games',consistency:'strong'})) {
  return async request => {
    try {
      if (!['GET','POST'].includes(request.method)) return jsonResponse({error:'Method not allowed'},405);
      let input;
      if (request.method === 'POST') {
        if (request.headers.get('Origin') !== new URL(request.url).origin) return jsonResponse({error:'Open the game page to edit payment details'},403);
        const raw = await request.text();
        if (raw.length > 2048) return jsonResponse({error:'Payment details too long'},413);
        try { input = JSON.parse(raw); } catch { return jsonResponse({error:'Invalid details'},400); }
      } else input = Object.fromEntries(new URL(request.url).searchParams);
      const {gameId,playerId} = input || {};
      if (!validId(gameId) || !validId(playerId)) return jsonResponse({error:'Invalid player link'},400);
      const game = await getGames().get(`games/${gameId}`,{type:'json'});
      const player = game?.state?.players.find(p=>p.id === playerId);
      if (!player) return jsonResponse({error:'Player not found in this game'},404);
      const store = getProfiles();
      const key = `payments/${gameId}/${playerId}`;
      const existing = await store.getWithMetadata(key,{type:'json'});
      const revision = existing?.data.revision || 0;
      if (request.method === 'GET') {
        const current = existing?.data || (await paymentProfilesForGame({...game.state,players:[player]},store)).players[0];
        return jsonResponse({payId:current.payId || '',beemHandle:current.beemHandle || '',revision});
      }
      if (!Number.isSafeInteger(input.revision) || input.revision !== revision) return jsonResponse({error:'Someone updated these details. Close and reopen to load the latest version.'},409);
      if (typeof input.payId !== 'string' || typeof input.beemHandle !== 'string') return jsonResponse({error:'Invalid payment details'},400);
      const payId = input.payId.trim(), beemHandle = input.beemHandle.trim().replace(/^@/,'');
      if (payId.length > 160 || /[\u0000-\u001f\u007f]/.test(payId) || (beemHandle && !/^[a-zA-Z0-9_.-]{1,32}$/.test(beemHandle))) return jsonResponse({error:'Check your PayID and Beem username'},400);
      const details = {payId,beemHandle,revision:revision+1};
      const result = await store.setJSON(key,details,existing ? {onlyIfMatch:existing.etag} : {onlyIfNew:true});
      if (!result.modified) return jsonResponse({error:'Someone updated these details. Close and reopen to load the latest version.'},409);
      return jsonResponse(details);
    } catch { return jsonResponse({error:'Payment details are temporarily unavailable. Please try again.'},503); }
  };
}
export default createPaymentHandler();
export const config = {path:'/.netlify/functions/player-account'};
