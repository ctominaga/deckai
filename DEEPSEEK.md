# DeepSeek no sistema integrado

DeepSeek foi adicionado ao lado de Mock e Gemini na branch `feat/integracao-ia-html`. No gerador integrado, DeepSeek é a seleção inicial. Custos só podem ocorrer após os cliques explícitos de geração e com a ativação configurada no backend. Mock permanece disponível para simular sem serviços externos; Gemini também foi preservado.

## Modelo e API confirmados

Consulta à documentação oficial em 11/11/2026: os identificadores publicados são `deepseek-flash` e `deepseek-v4-pro`. O padrão adotado é **deepseek-flash**, recomendado pela documentação para acessar a família Flash atual (na consulta, DeepSeek-V4.1-Flash-1017). O identificador é configurável por `DEEPSEEK_MODEL`; não há garantia de acesso ou saldo da chave da empresa, pois nenhuma chamada real foi feita.

Usamos o HTTP nativo do Node, sem SDK adicional, em `POST https://api.deepseek.com/chat/completions`, com autenticação Bearer exclusivamente no backend. As solicitações não usam streaming, desativam thinking explicitamente e solicitam `response_format: {"type":"json_object"}`. O prompt inclui instrução de JSON e o formato esperado; JSON Output não substitui validação de estrutura ou fidelidade.

Referências oficiais:

- [Primeira chamada e identificadores de modelo](https://api-docs.deepseek.com/)
- [Modelos e recursos disponíveis](https://api-docs.deepseek.com/quick_start/pricing/)
- [Chat Completions, thinking e finish_reason](https://api-docs.deepseek.com/api/create-chat-completion/)
- [JSON Output e conteúdo vazio](https://api-docs.deepseek.com/guides/json_mode/)
- [Códigos de erro HTTP](https://api-docs.deepseek.com/quick_start/error_codes)

## Configurar e executar manualmente

O comando de desenvolvimento carrega automaticamente **`.env.local` na raiz de `DeckAI-oficial/`**. Crie o arquivo manualmente, sem enviar a chave ao Git ou ao chat:

```dotenv
DEEPSEEK_API_KEY=SUBSTITUA_PELA_SUA_CHAVE
DECKAI_ENABLE_REAL_DEEPSEEK=true
DEEPSEEK_MODEL=deepseek-flash
```

Esse arquivo é ignorado pelo Git. `.env.example` é somente uma referência sem credenciais. O carregamento nativo é feito por `node --env-file-if-exists=.env.local --import=tsx src/integrated/server.ts` no script `dev:integrated`, usando a raiz do projeto como diretório de trabalho. Não há dependência adicional. Se o arquivo não existir, o servidor inicia normalmente.

Variáveis já definidas no ambiente do processo têm prioridade sobre o arquivo, inclusive `DECKAI_ENABLE_REAL_DEEPSEEK=false`. Se uma configuração do arquivo não surtir efeito, verifique se há uma variável herdada com o mesmo nome. Alterações exigem reiniciar o servidor. Não são carregados `.env` ou outros arquivos automaticamente.

Somente o comando de desenvolvimento lê esse arquivo. Importar o servidor ou executá-lo diretamente sem a opção `--env-file-if-exists` não lê arquivos locais, preservando inicializações de outros ambientes. Gemini mantém suas próprias variáveis e ativação independentes.

Como alternativa ao arquivo local, ainda é possível configurar o ambiente no PowerShell sem gravar a chave no histórico do comando:

```powershell
$deepSeekCredential = Read-Host 'Chave DeepSeek (entrada oculta)' -AsSecureString
$env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', $deepSeekCredential).Password
$env:DEEPSEEK_MODEL = 'deepseek-flash'
$env:DECKAI_ENABLE_REAL_DEEPSEEK = 'true'
npm.cmd run dev:integrated
```

O código acima é instrução para o usuário; não foi executado durante a implementação. Para desativar, encerre o servidor e remova a variável de chave da sessão ou feche o terminal. Credenciais devem ficar fora do repositório e do navegador.

Run Tasks continuam disponíveis:

- **DeckAI — Iniciar sistema integrado:** http://127.0.0.1:4175/
- **DeckAI — Iniciar frontend oficial:** http://127.0.0.1:4174/
- Laboratório original e suas tarefas permanecem independentes, na porta 4173.

A tarefa **DeckAI — Iniciar sistema integrado** usa esse mesmo script e carrega `.env.local` automaticamente, sem precisar digitar a chave no PowerShell. Variáveis herdadas do VS Code continuam tendo prioridade. Definir variáveis somente no terminal integrado não altera o ambiente do processo pai; se preferir essa alternativa, execute o comando npm nesse mesmo terminal.

Na interface, abra **Gerar com IA**, selecione **DeepSeek — IA real** e clique em **Gerar roteiro**. Revise/edite, salve e aprove a revisão atual. Só então clique em **Gerar apresentação**. Cada botão de geração faz uma chamada independente ao provedor selecionado. Selecionar um provedor, abrir uma página ou aprovar um roteiro não faz chamadas reais. Trocar briefing ou provedor invalida o fluxo anterior.

## Implementação

- `src/providers/deepseek-generation.provider.ts`: implementação de AiGenerationProvider, geração de roteiro/apresentação, transporte injetável e falhas sanitizadas.
- `src/providers/ai-presentation-contract.ts`: contrato de conteúdo, metadados por provedor e validações compartilhadas de IDs, títulos, ordem, layouts, referências e placeholders. Gemini reutiliza essas funções; seu contrato específico de JSON Schema continua separado.
- `src/providers/gemini-presentation-contract.ts` e `gemini-outline-generation.provider.ts`: reutilização das funções comuns mantendo compatibilidade.
- `src/dev-preview/server.ts` e `src/integrated/server.ts`: seleção de serviço e fábrica DeepSeek sob demanda. As regras existentes de aprovação, snapshot, revisão e rejeição de respostas antigas permanecem.
- `src/dev-preview/app.js`, `src/dev-preview/index.html`, `preview-dev3/gerar-ia.html`: opção adicional e identificação correta do provedor em todos os estados, sem mudança de identidade visual.
- `src/services/generation-diagnostics.ts`: estágios e origens DeepSeek com metadados controlados.
- `tests/deepseek-provider.test.ts`, `tests/deepseek-server.test.ts`, `tests/support/simulated-integrated-server.ts`, `e2e/deepseek.spec.ts`, `playwright.config.ts`: respostas simuladas, concorrência, falhas e navegador.
- `.env.example`, `.gitignore`, `README.md`, `INTEGRACAO-IA.md` e este documento: configuração e instruções.

O servidor continua usando os mesmos serviços Zod e o adaptador oficial. `shared/presentation-schema.json` e os módulos independentes do Dev 3 não foram alterados. O protótipo original não foi modificado.

## Falhas e limites

Uma tentativa por operação, sem retentativas ou fallback automático. O timeout padrão é 60 segundos para a solicitação inteira, incluindo leitura do corpo. Limites locais: 4096 tokens para roteiro e 16384 para apresentação. O transporte é cancelado ao expirar o prazo.

HTTP 400/422, 401, 402, 429, 500/503 recebem mensagens próprias. Erros desconhecidos de rede são convertidos em mensagens controladas. O corpo de erros HTTP, headers de autenticação, prompts e saída do modelo não são registrados nos logs. Os logs contêm apenas estágio, origem, categoria, código controlado e status HTTP numérico.

Respostas vazias, envelopes inesperados, JSON inválido/truncado, `finish_reason=length`, término incompleto, schema incompatível e divergência do roteiro são rejeitados sem usar conteúdo parcial. IDs e títulos não são corrigidos silenciosamente. O backend acrescenta rótulos demonstrativos aos cases e métricas; referências e imagens são restritas aos identificadores fornecidos. Fidelidade semântica aos objetivos e tópicos ainda exige revisão humana.

Persistência, autenticação, banco, assets reais e exportações efetivas continuam fora desta etapa. Gemini e Mock permanecem disponíveis. Não há avaliação real de qualidade, latência, saldo ou disponibilidade do DeepSeek para a chave da empresa.

## Testes

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
```

Os testes usam somente respostas simuladas. O navegador inicia o sistema normal diretamente, sem o carregador de `.env.local`, com provedores reais desativados na porta 4175 e um servidor de testes isolado com fábricas/transporte simulados na porta 4185. Essa segunda entrada existe somente em `tests/support/`, não é acionada pelas tarefas ou pelo sistema normal. As duas portas precisam estar livres durante os testes de navegador. Os testes do carregamento nativo usam diretórios temporários e exclusivamente valores fictícios; não acessam o arquivo local real do usuário.

Resultado local em 11/11/2026: **136 testes automatizados e 4 testes de navegador aprovados**, typecheck sem erros, validador Jump aprovado para seis itens. A suíte anterior de 94 testes continua passando. Nenhuma chamada real de Gemini ou DeepSeek foi executada; nenhum arquivo com credenciais reais foi aberto.
