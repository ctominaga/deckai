import type { FastifyRequest } from "fastify";
import type { Database } from "./database.js";
import { AppError } from "./errors.js";
import { hashToken } from "./security.js";

export interface AuthenticatedUser { id: string; organizationId: string; name: string; email: string; role: "owner" | "editor" | "reviewer" | "viewer"; mustChangePassword: boolean; }

export async function authenticate(request: FastifyRequest, database: Database, options: { allowPasswordChange?: boolean } = {}): Promise<AuthenticatedUser> {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError(401, "UNAUTHORIZED", "Faça login para continuar.");
  const result = await database.query<AuthenticatedUser>(`
    SELECT u.id, u.organization_id AS "organizationId", u.name, u.email, u.role, u.must_change_password AS "mustChangePassword"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
  `, [hashToken(token)]);
  const user = result.rows[0];
  if (!user) throw new AppError(401, "SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
  if (user.mustChangePassword && !options.allowPasswordChange) throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Troque a senha temporária antes de continuar.");
  return user;
}

export function requireWrite(user: AuthenticatedUser): void {
  if (!(["owner", "editor"] as string[]).includes(user.role)) throw new AppError(403, "FORBIDDEN", "Seu perfil não permite editar apresentações.");
}
