import { paymentProfilesForGame } from "./_player-profiles.mjs";
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "./_admin-auth.mjs";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = value => createHash("sha256").update(value).digest("hex");
function isHost(record, token) {
  if (!token || !record?.hostHash) return false;
  return timingSafeEqual(Buffer.from(record.hostHash), Buffer.from(hash(token)));
}
const text = (value, length = 120) => String(value || "").slice(0, length);
function money(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error("Invalid amount");
  return Math.round(n * 100) / 100;
}
export function cleanState(input, id) {
  if (!input || !Array.isArray(input.players) || input.players.length > 100 || !Array.isArray(input.cashPayments) || input.cashPayments.length > 5000 || !Array.isArray(input.transactions) || input.transactions.length > 10000) throw new Error("Invalid game data");
  return {
    sessionId: id,
    sessionName: text(input.sessionName),
    sessionSlug: /^\d{6}$/.test(input.sessionSlug) ? input.sessionSlug : "",
    sessionEnded: Boolean(input.sessionEnded),
    players: input.players.map(p => ({id:text(p.id,80),name:text(p.name,80),payId:text(p.payId,160),beemHandle:text(p.beemHandle,80).replace(/^@/,""),contactDetails:text(p.contactDetails,300),buyIn:money(p.buyIn),cashOut:money(p.cashOut),cashEligible:Boolean(p.cashEligible),cashPreferred:Boolean(p.cashPreferred)})),
    cashPayments: input.cashPayments.map(p => ({id:text(p.id,80),fromId:text(p.fromId,80),amount:money(p.amount),createdAt:text(p.createdAt,40)})),
    transactions: input.transactions.map(t => ({id:text(t.id,80),at:text(t.at,40),text:text(t.text,600)}))
  };
}
export function publicState(state) {
  return {...state, players: state.players.map(({payId,contactDetails,...player}) => player.paymentProfileLinked ? {...player,payId} : player)};
}
// Conditional writes prevent an older host tab overwriting a newer saved game.
// Games are snapshots; balances are calculated by the client, never incremented in storage.
export function createHandler(getGameStore = () => getStore({name:"poker-live-games",consistency:"strong"}), getPaymentState = paymentProfilesForGame) {
  return async request => {
    try {
      if (!["GET","POST"].includes(request.method)) return jsonResponse({error:"Method not allowed"},405);
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      let body;
      if (request.method === "POST") {
        const raw = await request.text();
        if (raw.length > 2000000) return jsonResponse({error:"Game too large"},413);
        try { body = JSON.parse(raw); } catch { return jsonResponse({error:"Invalid JSON"},400); }
      }
      const id = body?.id || new URL(request.url).searchParams.get("id");
      if (!idPattern.test(id || "")) return jsonResponse({error:"Invalid game link"},400);
      const store = getGameStore();
      const key = `games/${id}`;
      const existing = await store.getWithMetadata(key,{type:"json"});
      if (request.method === "GET") {
        if (!existing) return jsonResponse({error:"Game not found"},404);
        const state = await getPaymentState(existing.data.state);
        return jsonResponse({revision:existing.data.revision,state:isHost(existing.data,token) ? state : publicState(state)});
      }
      if (!/^[0-9a-f-]{72}$/i.test(token)) return jsonResponse({error:"Host access required"},403);
      if (existing && !isHost(existing.data,token)) return jsonResponse({error:"Only the host can edit"},403);
      const revision = existing?.data.revision || 0;
      if (!Number.isSafeInteger(body.revision) || body.revision !== revision) return jsonResponse({error:"Another tab saved changes. Reload before editing."},409);
      let state;
      try { state = cleanState(body.state,id); } catch (error) { return jsonResponse({error:error.message},400); }
      const previous = existing?.data.state.transactions || [];
      if (previous.length > state.transactions.length || previous.some((t,i) => JSON.stringify(t) !== JSON.stringify(state.transactions[i]))) return jsonResponse({error:"Existing transaction history cannot be removed or edited"},400);
      const record = {hostHash:hash(token),revision:revision+1,state,updatedAt:new Date().toISOString()};
      const result = await store.setJSON(key,record,existing ? {onlyIfMatch:existing.etag} : {onlyIfNew:true});
      if (!result.modified) return jsonResponse({error:"Another tab saved changes. Reload before editing."},409);
      // Read back the write before reporting that it has saved online.
      const verified = await store.get(key,{type:"json"});
      if (!verified || verified.revision < record.revision) throw new Error("Save not confirmed");
      return jsonResponse({ok:true,revision:record.revision});
    } catch {
      return jsonResponse({error:"Game service unavailable. Your device keeps a local copy."},503);
    }
  };
}
export default createHandler();
export const config = {path:"/.netlify/functions/live-game"};
