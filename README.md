# DeckAI — desenvolvimento local

Guia de entrega da frente Dev 1, com arquitetura, configuração, validação e pontos de integração: [README-DEV1.md](README-DEV1.md).

O HTML de `preview-dev3/index.html` é a base inicial escolhida pela equipe. A área **Gerar com IA** usa os serviços TypeScript de geração e mantém o dashboard e o protótipo do Dev 3. Não usa iframe ou framework frontend.

## Iniciar

Requisitos: Node.js >=22.9 e npm. Na raiz deste repositório:

```powershell
npm.cmd ci
npm.cmd run dev:integrated
```

Abra **http://127.0.0.1:4175/** e clique em **Gerar com IA** na barra lateral. DeepSeek é a seleção inicial do gerador integrado; selecione Mock para simular sem serviços externos. Nenhuma geração ocorre sem um clique explícito. As etapas são Briefing, Roteiro e Apresentação: gere o roteiro, revise/edite, salve ou cancele alterações, aprove a revisão atual e clique em **Gerar apresentação**. A lista do roteiro seleciona um slide para trabalhar; a apresentação permite selecionar slides e usar Anterior/Próximo. Trocar de etapa preserva o estado e as edições pendentes. As sugestões usam seis layouts; o briefing aceita de 1 a 12 slides.

No VS Code, **Terminal → Run Task → DeckAI — Iniciar sistema integrado** inicia esse mesmo sistema na porta 4175. **DeckAI — Iniciar frontend oficial** agora serve HTML e API na porta 4174, para que o item de IA também funcione por essa tarefa. Encerre pelo comando de término de tarefa do VS Code ou Ctrl+C no terminal.

O laboratório original continua independente na pasta `Deck AI/prototipo-ia`, com sua tarefa **DeckAI — Iniciar laboratório** e porta 4173. Suas tarefas de testes e simulações não foram alteradas. Este repositório não depende dessa pasta para executar.

Para escolher outra porta no terminal, defina `INTEGRATED_PORT` antes de iniciar. Cada processo mantém seu próprio estado de IA.

## Provedores reais e credenciais

**DeepSeek também está disponível**, como opção preferencial para uso real, preservando Gemini e Mock. Configure `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (opcional; padrão `deepseek-flash`) e `DECKAI_ENABLE_REAL_DEEPSEEK=true` no ambiente do backend. Veja [DEEPSEEK.md](DEEPSEEK.md) para configuração segura, funcionamento e instruções de geração manual.

No desenvolvimento, `npm.cmd run dev:integrated` e as tarefas do VS Code carregam automaticamente **`.env.local` na raiz deste repositório**, usando o suporte nativo do Node. O arquivo é opcional e ignorado pelo Git. Variáveis já definidas no ambiente têm prioridade, inclusive flags com valor `false`. Não coloque chaves no HTML, nas tarefas ou no Git.

Crie o arquivo manualmente em `DeckAI-oficial/.env.local`:

```dotenv
DEEPSEEK_API_KEY=SUBSTITUA_PELA_SUA_CHAVE
DECKAI_ENABLE_REAL_DEEPSEEK=true
DEEPSEEK_MODEL=deepseek-flash
```

Reinicie a tarefa após editar o arquivo. Nenhum arquivo local com credenciais foi criado ou lido durante essa alteração. Para Gemini, as variáveis existentes também podem ser definidas nesse arquivo. `.env.example` permanece apenas como referência sem credenciais. Outros arquivos, como `.env`, não são carregados por esse comando.

O carregamento está restrito ao script de desenvolvimento: importar o servidor ou executá-lo diretamente com `node --import=tsx src/integrated/server.ts` não carrega arquivos locais. Os testes também evitam ler a configuração real do usuário.

Selecionar Gemini não dispara geração. Somente os botões de geração chamam o provedor; slides exigem aprovação explícita e um novo clique. O provedor é criado no backend sob demanda. Se as variáveis não estiverem configuradas, a interface apresenta o erro, sem substituir silenciosamente Gemini por Mock.

## Validação

```powershell
npm.cmd run typecheck
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:browser
node platform/validation/validate-jump-content.mjs platform/mock-data/jump-content-public.json
```

Os testes de navegador precisam das portas 4175 e 4185 livres. O sistema normal inicia com Gemini e DeepSeek reais desativados; o servidor de testes separado usa somente provedores/transporte simulados. Testes de serviços também não fazem solicitações reais aos provedores. Ajv e Playwright são dependências apenas de desenvolvimento para validar o contrato oficial e testar a interface no Chromium.

Se a porta 4175 estiver em uso, defina `DECKAI_TEST_PORT` com outra porta livre para os testes de navegador. Eles iniciam o servidor diretamente sem carregar o `.env.local` real.

Veja [INTEGRACAO-IA.md](INTEGRACAO-IA.md) para arquitetura, adaptação de contratos, arquivos e limitações.

## Regenerar um slide

Na etapa **Apresentação**, selecione um slide e clique em **Regenerar slide**. Escolha DeepSeek ou Mock, escreva uma instrução opcional e solicite a nova versão. Compare o original e a sugestão; **Aceitar nova versão** substitui exclusivamente esse slide e incrementa a revisão da apresentação. **Descartar** mantém conteúdo e revisão. O roteiro continua aprovado. A regeneração individual com Gemini aparece como indisponível, sem fallback automático.

Para experimentar sem rede, selecione Mock no briefing e mantenha Mock no painel de regeneração. Veja [REGENERACAO-SLIDES.md](REGENERACAO-SLIDES.md) para contratos, concorrência, testes e limitações desta etapa.
