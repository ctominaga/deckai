const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";

export function createDeepSeekAdapter({
  apiKey = process.env.DEEPSEEK_API_KEY,
  baseUrl = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY_MISSING");

  async function complete({ system, user, temperature = 0.2, maxTokens = 8192, requestId = crypto.randomUUID() }) {
    const startedAt = Date.now();
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature,
        max_tokens: maxTokens
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? "DEEPSEEK_REQUEST_FAILED");
      error.code = payload?.error?.type ?? "DEEPSEEK_REQUEST_FAILED";
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    const rawContent = payload?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string" || !rawContent.trim()) throw new Error("DEEPSEEK_EMPTY_RESPONSE");

    let content;
    try { content = JSON.parse(rawContent); } catch {
      throw new Error("DEEPSEEK_INVALID_JSON");
    }

    return {
      requestId,
      provider: "deepseek",
      model: payload.model ?? model,
      content,
      usage: payload.usage ?? null,
      durationMs: Date.now() - startedAt,
      finishReason: payload.choices?.[0]?.finish_reason ?? null
    };
  }

  return { complete, provider: "deepseek", model };
}

export function buildPresentationPrompt({ briefing, jumpContext, schema }) {
  return {
    system: [
      "Você gera apresentações estruturadas para o Deck AI.",
      "Responda somente com JSON válido conforme o schema fornecido.",
      "Não invente números, clientes, cases ou resultados.",
      "Use somente o conteúdo Jump aprovado recebido.",
      "Toda afirmação factual deve incluir uma referência.",
      `Schema: ${JSON.stringify(schema)}`
    ].join("\n"),
    user: JSON.stringify({ briefing, jumpContext })
  };
}
