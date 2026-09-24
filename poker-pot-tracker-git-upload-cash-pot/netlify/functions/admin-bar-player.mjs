import { getBarredPlayers, playerKey, saveBarredPlayers } from "./_data.mjs";
import { jsonResponse, verifyAdminToken } from "./_admin-auth.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!verifyAdminToken(request.headers.get("authorization") || "")) {
    return jsonResponse({ error: "Admin session expired. Log in again." }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return jsonResponse({ error: "Player name is required" }, 400);

  const barredPlayers = await getBarredPlayers();
  const key = playerKey(name);

  if (body.barred === false) {
    delete barredPlayers[key];
  } else {
    barredPlayers[key] = {
      name,
      note: String(body.note || "").trim().slice(0, 240),
      barredAt: new Date().toISOString()
    };
  }

  await saveBarredPlayers(barredPlayers);
  return jsonResponse({ ok: true });
};

export const config = {
  path: "/.netlify/functions/admin-bar-player"
};
