export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown, public readonly retryable = false) { super(message); }
}

export function notFound(entity: string): AppError { return new AppError(404, "NOT_FOUND", `${entity} não encontrado.`); }
