const STORAGE_KEY = "deckai.auth.v1";

const permissions = {
  owner: ["presentation:read", "presentation:write", "jump:read", "jump:write", "jump:approve", "export:create", "export:download", "user:manage"],
  editor: ["presentation:read", "presentation:write", "jump:read", "export:create", "export:download"],
  reviewer: ["presentation:read", "jump:read", "jump:write", "jump:approve", "export:download"],
  viewer: ["presentation:read", "jump:read", "export:download"]
};

function readUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function writeUsers(users) { localStorage.setItem(STORAGE_KEY, JSON.stringify(users)); }

export function listUsers() { return readUsers(); }

export function addUser({ name, email, role = "viewer" }) {
  if (!name?.trim() || !email?.trim()) throw new Error("USER_REQUIRED_FIELDS");
  if (!permissions[role]) throw new Error("INVALID_ROLE");
  const users = readUsers();
  if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) throw new Error("USER_ALREADY_EXISTS");
  const user = { userId: `user_${crypto.randomUUID()}`, name: name.trim(), email: email.trim(), role, status: "active" };
  writeUsers([...users, user]);
  return user;
}

export function can(user, action) {
  return Boolean(user && user.status === "active" && permissions[user.role]?.includes(action));
}

export function requirePermission(user, action) {
  if (!can(user, action)) throw new Error(`FORBIDDEN:${action}`);
  return true;
}

export function updateUserRole(userId, role) {
  if (!permissions[role]) throw new Error("INVALID_ROLE");
  const users = readUsers();
  const user = users.find((item) => item.userId === userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  user.role = role;
  writeUsers(users);
  return user;
}

export function seedUsers(users) { writeUsers(users ?? []); }
export function clearUsers() { localStorage.removeItem(STORAGE_KEY); }

export { permissions };
