import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

export const profileStore = () => getStore({name:'poker-player-profiles',consistency:'strong'});
export const digest = value => createHash('sha256').update(value).digest('hex');
export const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export const linkKey = (gameId, playerId) => `links/${gameId}/${playerId}`;

export async function signedInAccount(request, store = profileStore()) {
  const token = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('poker_player='))?.slice(13);
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  const session = await store.get(`sessions/${digest(token)}`,{type:'json'});
  if (!session || session.expiresAt < Date.now()) return null;
  return await store.getWithMetadata(`accounts/${session.username}`,{type:'json'});
}
export function ownsGame(record, request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i,'');
  if (!record?.hostHash || !token) return false;
  return timingSafeEqual(Buffer.from(record.hostHash),Buffer.from(digest(token)));
}
export function safeAccount(account) {
  const {id,username,displayName,payId,beemHandle,revision} = account;
  return {id,username,displayName,payId,beemHandle,revision};
}
export async function paymentProfilesForGame(state, store = profileStore()) {
  const players = await Promise.all(state.players.map(async player => {
    const link = await store.get(linkKey(state.sessionId,player.id),{type:'json'});
    if (!link) return player;
    const account = await store.get(`accounts/${link.username}`,{type:'json'});
    if (!account || account.id !== link.accountId) return player;
    return {...player,payId:account.payId,beemHandle:account.beemHandle,paymentProfileLinked:true};
  }));
  return {...state,players};
}
