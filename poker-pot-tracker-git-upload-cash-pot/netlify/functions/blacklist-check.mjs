import { getBarredPlayers, playerKey } from "./_data.mjs";
import { jsonResponse } from "./_admin-auth.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const names = Array.isArray(body.names) ? body.names : [];
  const barredPlayers = await getBarredPlayers();
  const barred = names
    .map((name) => barredPlayers[playerKey(name)])
    .filter(Boolean)
    .map((player) => ({ name: player.name, note: player.note || "" }));

  return jsonResponse({ barred });
};

export const config = {
  path: "/.netlify/functions/blacklist-check"
};
