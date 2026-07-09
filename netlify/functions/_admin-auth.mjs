import crypto from "node:crypto";

const tokenLifetimeSeconds = 60 * 60 * 8;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  const secret = process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("ADMIN_TOKEN_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createAdminToken() {
  const payload = base64url(JSON.stringify({
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds
  }));
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(authHeader = "") {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const safeSignature = Buffer.from(signature);
  const safeExpected = Buffer.from(expected);
  if (safeSignature.length !== safeExpected.length) return false;
  if (!crypto.timingSafeEqual(safeSignature, safeExpected)) return false;

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return decoded.role === "admin" && decoded.exp > Math.floor(Date.now() / 1000);
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
