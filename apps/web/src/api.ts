const TOKEN_KEY = "deckai.session.token";
export const session = { get token() { return sessionStorage.getItem(TOKEN_KEY); }, set token(value: string | null) { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY); } };

export class ApiClientError extends Error { constructor(public code: string, message: string, public status: number, public details?: unknown) { super(message); } }

export async function imageRequest(path: string, file?: File): Promise<Response> {
  const headers = new Headers();
  if (session.token) headers.set("authorization", `Bearer ${session.token}`);
  if (file) headers.set("content-type", file.type);
  const response = await fetch(path, { method: file ? "POST" : "GET", headers, body: file ?? null });
  if (!response.ok) {
    if (response.status === 401) { session.token = null; window.dispatchEvent(new CustomEvent("deckai:unauthorized")); }
    const result = await response.json().catch(() => ({}));
    throw new ApiClientError(result.error?.code ?? "IMAGE_ERROR", result.error?.message ?? "Não foi possível carregar a imagem.", response.status);
  }
  return response;
}

export async function api<T>(path: string, options: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (session.token) headers.set("authorization", `Bearer ${session.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const { body, ...requestOptions } = options;
  const init: RequestInit = { ...requestOptions, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  const result = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = result?.error;
    if (response.status === 401) {
      session.token = null;
      window.dispatchEvent(new CustomEvent("deckai:unauthorized"));
    }
    throw new ApiClientError(error?.code ?? "HTTP_ERROR", error?.message ?? "A solicitação falhou.", response.status, error?.details);
  }
  return result as T;
}
