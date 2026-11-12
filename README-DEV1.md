# Entrega Dev 1 — IA e geração

Esta branch preserva a contribuição do Dev 1 para o DeckAI: transformar um briefing em roteiro revisável e apresentação estruturada, com aprovação explícita, validação de contratos e integração ao frontend existente. Não foram implementadas funcionalidades novas durante a organização da entrega.

## Estado da entrega

- Repositório: `https://github.com/ctominaga/deckai`.
- Branch de entrega: `feat/dev1-ia-geracao`.
- Origem: estado local de `feat/integracao-ia-html`, baseado em `e699d47`.
- Na inspeção de 12/11/2026, a `main` remota estava em `f3f4c11`, com um commit adicional do Dev 3 que cria `platform/local-store/auth-store.js` e sua documentação. Esse commit não foi incorporado nem modificado nesta entrega. A equipe deve considerar essa diferença ao integrar as frentes.
- A entrega mantém a implementação já existente, incluindo a regeneração individual previamente implementada e validada. A organização não altera a `main`, não faz merge nem cria Pull Request.

## Funcionalidades implementadas

- Geração de roteiros e apresentações com provedores Mock, Gemini e DeepSeek; DeepSeek é a seleção inicial do gerador integrado e Mock permite uso sem rede.
- Briefing tipado, roteiros estruturados e apresentações validados com Zod.
- Aprovação explícita da revisão do roteiro, com snapshot e bloqueio de geração sem aprovação correspondente.
- Edição manual do título, slides, objetivos e tópicos; alterações salvas incrementam a revisão e exigem reaprovação.
- Edição individual de textos com IA: prévia, aceitar/descartar, limites, revisão e proteção contra sugestões antigas. Em fluxos reais, essa operação usa DeepSeek; no Mock usa simulação.
- Seis layouts: `cover`, `text_image`, `two_columns`, `metrics`, `case` e `closing`.
- Navegação Briefing → Roteiro → Apresentação, seleção de slides, Anterior/Próximo, responsividade e consulta avançada de JSON.
- Adaptador para `shared/presentation-schema.json`, mantendo o JSON original e emitindo avisos sobre campos sem equivalente.
- Regeneração de um único slide com DeepSeek ou Mock, comparação e aceite explícito, preservando os demais slides e o roteiro aprovado. Gemini não oferece essa operação, e a interface informa a indisponibilidade.
- Revisão própria da apresentação; respostas atrasadas, sugestões expiradas e aceites concorrentes são rejeitados.
- Testes de serviços, contratos, HTTP e navegador, com provedores/transporte simulados.

## Arquitetura e arquivos

| Área | Localização e responsabilidade |
| --- | --- |
| Contratos de entrada e saída | `src/schemas/`: briefing, roteiro, apresentação, reescrita e regeneração; validação Zod |
| Provedores | `src/providers/`: interface comum, Mock, Gemini, DeepSeek e contratos de geração |
| Regras de negócio | `src/services/`: geração, edição, aprovação, fidelidade, reescrita, regeneração e diagnósticos sanitizados |
| Adaptação | `src/integration/presentation-adapter.ts`: projeção isolada para o schema compartilhado |
| API e estado | `src/dev-preview/server.ts`: estado em memória, endpoints, revisões e sugestões temporárias |
| Servidor integrado | `src/integrated/server.ts`: HTML oficial e API na mesma origem, lista fechada de arquivos públicos |
| Interface reutilizada | `src/dev-preview/app.js` e `styles.css`: editor, renderizador e painéis de sugestões; `index.html` mantém o laboratório local |
| Integração visual | `preview-dev3/gerar-ia.html`, `ai-shell.css`, `workflow.js` e `shared-json.js` |
| Demos e dados fictícios | `src/mocks/` e entradas `src/*demo.ts`, `src/main.ts` |
| Verificação | `tests/`, `e2e/`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` |
| Execução reproduzível | `package.json`, `package-lock.json`, `.env.example`, `.vscode/tasks.json`, `.gitignore` |
| Documentação complementar | `README.md`, `INTEGRACAO-IA.md`, `DEEPSEEK.md`, `UX-GERACAO.md`, `REGENERACAO-SLIDES.md` |

As únicas alterações em arquivos preexistentes do frontend do Dev 3 são:

- `preview-dev3/index.html`: stylesheet da integração, link lateral **Gerar com IA** e abertura do modal existente de usuários por parâmetro de URL.
- `preview-dev3/prototipo.html`: links de retorno/IA e abertura da aba existente pelo fragmento da URL.
- `.gitignore`: proteção de configuração local, dependências e artefatos dos testes.

Os módulos de `platform/`, o schema compartilhado e o laboratório externo `prototipo-ia/` não recebem alterações desta entrega. O código de IA no repositório oficial é independente da pasta do laboratório externo.

## Configurar o ambiente local

Requisitos: Node.js >= 22.9.0, npm e Git. No PowerShell, use `npm.cmd`/`npx.cmd` quando a política local impedir executar os wrappers `.ps1`.

Para avaliar a branch em uma cópia do repositório:

```powershell
git fetch origin
git switch -c avaliacao/dev1 origin/feat/dev1-ia-geracao
npm.cmd ci
npx.cmd playwright install chromium
```

Faça a troca de branch em uma cópia limpa ou após preservar seu próprio trabalho. Se `avaliacao/dev1` já existir, inspecione-a antes de reutilizar o nome. Nenhum caminho absoluto do computador original é necessário para executar o projeto.

Mock funciona sem arquivos de credenciais. Para uso real, crie manualmente `.env.local` na raiz, usando `.env.example` como referência. O template contém chaves vazias e provedores reais desativados. As configurações relevantes são:

| Variável | Uso |
| --- | --- |
| `DEEPSEEK_API_KEY` | Chave DeepSeek, somente no backend |
| `DEEPSEEK_MODEL` | Modelo configurável; padrão atual do código: `deepseek-flash` |
| `DECKAI_ENABLE_REAL_DEEPSEEK` | Deve ser `true` para permitir o uso real do DeepSeek |
| `GEMINI_API_KEY` | Chave Gemini, somente no backend |
| `GEMINI_MODEL` | Modelo configurável; padrão atual do código: `gemini-3.6-flash` |
| `DECKAI_ENABLE_REAL_GEMINI` | Deve ser `true` para permitir o uso real do Gemini |
| `INTEGRATED_PORT` | Porta do servidor integrado; padrão `4175` |

Os nomes de modelos acima descrevem a configuração preservada no código, sem nova confirmação de disponibilidade comercial nesta entrega. O uso real depende de acesso, saldo e modelo disponível na conta da equipe.

`npm.cmd run dev:integrated` carrega opcionalmente `.env.local` pelo Node. Variáveis já presentes no ambiente têm prioridade. Reinicie o servidor após mudar a configuração. Não coloque chaves no frontend, nas tarefas, nos exemplos, nos testes ou no Git.

## Iniciar pelo Run Task

Abra a pasta **DeckAI-oficial** como workspace no VS Code e execute **Terminal → Run Task**:

- **DeckAI — Iniciar sistema integrado**: `http://127.0.0.1:4175/`.
- **DeckAI — Iniciar frontend oficial**: `http://127.0.0.1:4174/`.

Ambas executam `npm.cmd run dev:integrated`, carregam a configuração local opcional e servem frontend/API na mesma origem. Encerre pelo término da tarefa ou Ctrl+C. Cada processo mantém seu próprio estado, e localStorage é separado por origem/porta.

Alternativa pelo terminal:

```powershell
npm.cmd run dev:integrated
```

## Executar os testes

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:browser
```

Os testes de navegador precisam das portas `4175` e `4185` livres. Se necessário, defina `DECKAI_TEST_PORT` para trocar somente a porta principal dos testes. Instale o Chromium antes da primeira execução.

A suíte inicia os servidores diretamente, sem carregar `.env.local`. O servidor normal de testes desativa os provedores reais; o servidor isolado em `tests/support/simulated-integrated-server.ts` injeta fábricas e transporte simulados. Os testes de Gemini e DeepSeek não fazem chamadas reais. As capturas/traces ficam em pastas ignoradas pelo Git.

Validação executada em 12/11/2026, com Node.js 26.7.0 e npm 11.19.0:

- `npm.cmd test -- --maxWorkers=2`: **217 testes aprovados em 17 arquivos**.
- `npm.cmd run typecheck`: **aprovado**, sem erros TypeScript.
- `npm.cmd run test:browser`: **23 testes Chromium aprovados**, com Mock e transportes simulados.
- Nenhuma chamada real a Gemini/DeepSeek, leitura de credenciais reais ou mudança no código das funcionalidades durante a entrega.

A primeira execução de `npm.cmd test` ocorreu simultaneamente aos testes de navegador e apresentou três timeouts de cinco segundos em testes que iniciam processos Node. A suíte completa passou ao ser repetida após o navegador, com dois workers, sem alterar testes, limites ou implementação. Em máquinas com recursos disputados, execute as suítes separadamente e use `--maxWorkers=2` no Vitest.

## Usar Mock, Gemini e DeepSeek

1. Abra **Gerar com IA** pela barra lateral.
2. Para testar sem rede, escolha **Mock — Simulação** no briefing. Para uso real, selecione Gemini ou DeepSeek após configurar e ativar o provedor no backend.
3. Preencha o briefing e clique em **Gerar roteiro**. Selecionar um provedor ou abrir a página não dispara geração.
4. Revise o roteiro. Edite manualmente ou use **Editar com IA**, comparando a sugestão antes de aceitar. Salve ou cancele alterações pendentes.
5. Clique em **Aprovar roteiro** e depois em **Gerar apresentação**.
6. Navegue pelos slides. **Regenerar slide** abre a comparação do slide atual, com instrução opcional e seleção explícita entre DeepSeek e Mock. O aceite altera apenas esse slide e incrementa a revisão da apresentação; descartar não altera a apresentação.
7. Consulte os JSONs na seção avançada e solicite a projeção do contrato compartilhado quando necessário.

Erros de configuração, HTTP, timeout ou resposta inválida são mostrados sem fallback silencioso. Não são inventadas fontes institucionais: os exemplos são demonstrações fictícias, métricas e cases mantêm classificação `DEMONSTRATION`, e imagens são placeholders. A revisão humana continua necessária.

## Conexão da IA com o frontend

O servidor integrado serve o HTML existente e reutiliza o JavaScript/CSS do laboratório por rotas `/ai/...`. O navegador usa requisições JSON `/api/...` na origem atual. A navegação de etapas em `preview-dev3/workflow.js` apenas seleciona o conteúdo visual; as operações de IA ficam em `src/dev-preview/app.js` e no backend.

| Endpoint | Função |
| --- | --- |
| `GET /api/state` | Recupera briefing, roteiro, apresentação e revisão da apresentação em memória |
| `POST /api/scripts` | Gera um roteiro no provedor escolhido |
| `POST /api/briefing/invalidate` | Invalida o fluxo quando o briefing muda |
| `POST /api/scripts/:id/edit` | Salva a revisão manual, invalidando aprovação e slides anteriores |
| `POST /api/scripts/:id/approve` | Aprova a revisão atual do roteiro |
| `POST /api/scripts/:id/presentation` | Gera a apresentação a partir do roteiro aprovado |
| `POST /api/scripts/:id/rewrite` | Solicita sugestão de texto sem salvar imediatamente |
| `POST /api/scripts/:id/rewrite-accept` e `rewrite-discard` | Aceita ou descarta a sugestão de texto |
| `POST /api/presentations/:id/regenerate-slide` | Solicita uma nova versão de um único slide |
| `POST /api/presentations/:id/regeneration-accept` e `regeneration-discard` | Aceita ou descarta a nova versão |
| `GET /api/presentation/shared` | Retorna o JSON adaptado e avisos sobre diferenças de contrato |

O frontend usa `textContent` para conteúdo gerado, sem executá-lo como HTML. O backend não serve arquivos de credenciais e sanitiza erros dos provedores. O servidor integrado escuta apenas em `127.0.0.1`; é um ambiente de desenvolvimento local, sem preparação de produção.

## Pontos de integração com os demais desenvolvedores

- **Persistência e usuários:** substituir o estado único em memória por armazenamento com isolamento por usuário/apresentação, mantendo aprovação por snapshot, revisão esperada e aplicação atômica de sugestões. Os stores do Dev 3 ainda são independentes; a IA não salva automaticamente neles.
- **Frontend/editor:** consumir os contratos/API e reutilizar os seis layouts. Eventos `deckai:workflow` comunicam o estado à navegação, e `deckai:presentation-updated` invalida a projeção compartilhada exibida.
- **Schema compartilhado:** usar `adaptPresentation`, sem mudar o JSON original. A projeção aceita 16:9; 4:3 é rejeitado. Metadados e catálogo de fontes permanecem no original, classificações aparecem como texto, e imagens sem assets reais são omitidas com aviso.
- **Biblioteca e fontes:** a biblioteca Jump simulada não é fonte da IA. Uma integração futura deve consumir exclusivamente conteúdo autorizado, aprovado e vigente, respeitando a política já existente no repositório.
- **Assets, temas e exportação:** ligar IDs reais de assets/temas e definir como o resultado será persistido/renderizado/exportado. Os jobs demonstrativos atuais não geram PDF/PPTX.
- **Integração Git:** a entrega consiste em um commit adicional sobre `e699d47`. A equipe pode avaliá-la pela branch ou aplicar esse commit em sua própria branch de integração com `git cherry-pick origin/feat/dev1-ia-geracao`, após revisar alterações concorrentes. Esse comando é uma orientação para a equipe; não foi executado nesta entrega. O commit independente `f3f4c11` do Dev 3 permanece na `main` remota.

## Pendências e limitações

- Persistência, autenticação, permissões efetivas e isolamento multiusuário ainda não estão conectados à API de IA.
- Estado salvo e sugestões são perdidos ao reiniciar o processo; rascunhos manuais não salvos ficam na memória da página.
- A regeneração individual com Gemini não está implementada. Apenas a sugestão de slide mais recente permanece elegível, com validade de dez minutos.
- Descartar uma regeneração invalida seu resultado, mas uma chamada já enviada ao provedor pode continuar no backend até concluir ou expirar.
- Não há geração de imagens, editor visual definitivo de cores/fontes ou exportação PDF/PPTX real.
- O adaptador não é reversível e não substitui uma decisão conjunta sobre evolução dos contratos.
- A validação estrutural é automatizada; qualidade da redação, fidelidade semântica e fatos/fontes exigem revisão humana.
- Disponibilidade, saldo, latência e qualidade dos provedores reais não foram avaliados nesta entrega.
- O CSP do servidor integrado ainda permite scripts/estilos inline para preservar o protótipo existente.

## Segurança da entrega

A revisão considera somente os arquivos necessários do Dev 1 e as adaptações de frontend descritas acima. `.env`, `.env.local` e demais `.env.*` estão ignorados; somente `.env.example`, com chaves vazias, é incluído. `node_modules/`, relatórios de navegador, resultados de testes e materiais privados permanecem fora do commit.

Os indicadores de segredos encontrados na inspeção dos testes correspondem a valores explicitamente fictícios, usados para verificar sanitização e transportes simulados. A revisão não encontrou credenciais reais ou documentos confidenciais nos arquivos preparados. Nenhum arquivo real de credenciais foi aberto ou modificado. A auditoria local é uma verificação por padrões e revisão dos arquivos, sem garantia de detecção universal de segredos.

As notas anteriores de “sem commits ou pushes” nos documentos das etapas descrevem o momento de cada implementação. Este documento é a referência da entrega organizada nesta branch; o hash e o resultado efetivo da publicação serão informados no relatório final.
