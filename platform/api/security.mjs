import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const rolePermissions = {
  owner: ["presentation:read", "presentation:write", "jump:read", "jump:write", "jump:approve", "user:manage"],
  editor: ["presentation:read", "presentation:write", "jump:read"],
  reviewer: ["presentation:read", "jump:read", "jump:write", "jump:approve"],
  viewer: ["presentation:read", "jump:read"]
};

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 10) throw apiError(400, "WEAK_PASSWORD", "A senha deve ter pelo menos 10 caracteres.");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(userId) {
  return {
    sessionId: `ses_${randomUUID()}`,
    token: randomBytes(32).toString("base64url"),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
  };
}

export function apiError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details });
  return error;
}

export function requirePermission(user, permission) {
  if (!rolePermissions[user?.role]?.includes(permission)) {
    throw apiError(403, "FORBIDDEN", `Permissão necessária: ${permission}`);
  }
}
