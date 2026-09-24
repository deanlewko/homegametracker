import crypto from "node:crypto";
import { createAdminToken, jsonResponse } from "./_admin-auth.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return jsonResponse({ error: "ADMIN_PASSWORD is not configured in Netlify" }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const supplied = String(body.password || "");
  const expected = String(adminPassword);

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  const passwordMatches =
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

  if (!passwordMatches) {
    return jsonResponse({ error: "Incorrect password" }, 401);
  }

  return jsonResponse({ token: createAdminToken() });
};

export const config = {
  path: "/.netlify/functions/admin-login"
};
