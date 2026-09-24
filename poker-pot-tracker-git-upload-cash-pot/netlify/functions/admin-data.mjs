import { getBarredPlayers, getSessions, summarizeSessions } from "./_data.mjs";
import { jsonResponse, verifyAdminToken } from "./_admin-auth.mjs";

export default async (request) => {
  if (!verifyAdminToken(request.headers.get("authorization") || "")) {
    return jsonResponse({ error: "Admin session expired. Log in again." }, 401);
  }

  const sessions = await getSessions();
  const barredPlayers = await getBarredPlayers();
  return jsonResponse({
    ...summarizeSessions(sessions),
    barredPlayers: Object.values(barredPlayers).sort((a, b) => a.name.localeCompare(b.name))
  });
};

export const config = {
  path: "/.netlify/functions/admin-data"
};
