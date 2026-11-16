# Adaptador de IA

O adaptador permite trocar o provedor sem mudar os contratos usados pelo editor.

## Configuração local

No PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="sua-chave"
$env:DEEPSEEK_MODEL="deepseek-flash"
```

Não coloque a chave em arquivos versionados, HTML, JSON de exemplo ou mensagens de commit.

## Uso básico

```js
import { createDeepSeekAdapter } from "./deepseek-adapter.mjs";

const adapter = createDeepSeekAdapter();
const result = await adapter.complete({
  system: "Responda somente JSON válido.",
  user: "Crie um roteiro institucional com seis slides."
});
```

O retorno inclui conteúdo parseado, modelo, uso de tokens, duração e motivo de finalização.

## Tratamento

- chave ausente: erro de configuração;
- HTTP 429 ou 5xx: erro retentável;
- resposta vazia ou JSON inválido: erro não retentável até análise;
- toda resposta deve passar pelo validador do Deck AI antes de ser salva.
