import { getStore } from "@netlify/blobs";

const store = getStore("home-game-poker-tracker");

export function playerKey(name = "") {
  return String(name).trim().toLocaleLowerCase();
}

export function money(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export async function getSessions() {
  return (await store.get("sessions", { type: "json" })) || [];
}

export async function saveSessions(sessions) {
  await store.setJSON("sessions", sessions);
}

export async function getBarredPlayers() {
  return (await store.get("barred-players", { type: "json" })) || {};
}

export async function saveBarredPlayers(players) {
  await store.setJSON("barred-players", players);
}

export function summarizeSessions(sessions) {
  const sessionStats = sessions
    .slice()
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
    .map((session) => {
      const players = session.players.map((player) => ({
        name: player.name,
        buyIn: money(player.buyIn),
        cashOut: money(player.cashOut),
        net: money(player.cashOut - player.buyIn)
      }));
      return {
        id: session.id,
        sessionSlug: session.sessionSlug || "",
        sessionName: session.sessionName,
        finishedAt: session.finishedAt,
        totalBuyIn: money(players.reduce((sum, player) => sum + player.buyIn, 0)),
        totalCashOut: money(players.reduce((sum, player) => sum + player.cashOut, 0)),
        cashContributions: session.cashContributions || [],
        cashAllocations: session.cashAllocations || [],
        players
      };
    });

  const lifetimeMap = new Map();
  sessionStats.forEach((session) => {
    session.players.forEach((player) => {
      const key = playerKey(player.name);
      const existing = lifetimeMap.get(key) || {
        name: player.name,
        sessions: 0,
        totalBuyIn: 0,
        totalCashOut: 0,
        net: 0
      };
      existing.sessions += 1;
      existing.totalBuyIn = money(existing.totalBuyIn + player.buyIn);
      existing.totalCashOut = money(existing.totalCashOut + player.cashOut);
      existing.net = money(existing.net + player.net);
      lifetimeMap.set(key, existing);
    });
  });

  return {
    sessions: sessionStats,
    lifetime: [...lifetimeMap.values()].sort((a, b) => b.net - a.net)
  };
}
