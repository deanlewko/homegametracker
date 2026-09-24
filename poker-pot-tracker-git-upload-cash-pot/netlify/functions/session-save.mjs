import { getSessions, money, saveSessions } from "./_data.mjs";
import { jsonResponse } from "./_admin-auth.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const players = Array.isArray(body.players) ? body.players : [];
  if (!body.id || !players.length) {
    return jsonResponse({ error: "Missing session data" }, 400);
  }

  const session = {
    id: String(body.id),
    sessionSlug: String(body.sessionSlug || "").slice(0, 24),
    sessionName: String(body.sessionName || "Home game").slice(0, 120),
    finishedAt: body.finishedAt || new Date().toISOString(),
    players: players
      .map((player) => ({
        name: String(player.name || "").trim().slice(0, 80),
        buyIn: money(player.buyIn),
        cashOut: money(player.cashOut)
      }))
      .filter((player) => player.name),
    cashContributions: (Array.isArray(body.cashContributions) ? body.cashContributions : [])
      .map((payment) => ({
        from: String(payment.from || "").trim().slice(0, 80),
        amount: money(payment.amount)
      }))
      .filter((payment) => payment.from && payment.amount > 0),
    cashAllocations: (Array.isArray(body.cashAllocations) ? body.cashAllocations : [])
      .map((payment) => ({
        to: String(payment.to || "").trim().slice(0, 80),
        amount: money(payment.amount)
      }))
      .filter((payment) => payment.to && payment.amount > 0)
  };

  const sessions = await getSessions();
  const withoutDuplicate = sessions.filter((item) => item.id !== session.id);
  withoutDuplicate.push(session);
  await saveSessions(withoutDuplicate.slice(-300));

  return jsonResponse({ ok: true });
};

export const config = {
  path: "/.netlify/functions/session-save"
};
