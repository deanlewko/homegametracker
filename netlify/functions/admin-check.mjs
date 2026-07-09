import { jsonResponse, verifyAdminToken } from "./_admin-auth.mjs";

export default async (request) => {
  if (!verifyAdminToken(request.headers.get("authorization") || "")) {
    return jsonResponse({ error: "Admin session expired. Log in again." }, 401);
  }

  return jsonResponse({ ok: true });
};

export const config = {
  path: "/.netlify/functions/admin-check"
};
