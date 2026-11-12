# Integração da IA ao HTML oficial

## Base e preservação

Branch de trabalho: `feat/integracao-ia-html`, criada a partir de `main` no commit `e699d47`. A configuração local `.vscode/tasks.json` já existia sem rastreamento e foi preservada, com uma tarefa adicional e atualização do servidor da tarefa oficial.

O código de `prototipo-ia/src`, seus testes, configuração TypeScript e manifesto foram copiados por lista explícita para este repositório. Nenhum arquivo de credenciais foi copiado ou aberto. O protótipo original não foi modificado. A cópia permite desenvolver e executar o oficial sem caminhos absolutos ou dependências externas ao repositório. Mudanças futuras nos dois projetos precisam ser conciliadas conscientemente; não há sincronização automática.

## Arquivos e responsabilidades

- `preview-dev3/index.html`: dashboard preservado, novo link lateral para IA e retorno ao modal demonstrativo de usuários.
- `preview-dev3/prototipo.html`: mesmas chaves de localStorage, regras de aprovação e simulação de exportações; novos links de retorno e seleção inicial de aba pelo fragmento da URL.
- `preview-dev3/gerar-ia.html`: briefing, provedor, roteiro editável, aprovação, apresentação e consulta de ambos os JSONs dentro da navegação oficial.
- `preview-dev3/ai-shell.css`: barra escura, fundo claro, verde-limão, Arial, cartões e botões alinhados à identidade existente; navegação adaptada para telas pequenas.
- `preview-dev3/shared-json.js`: consulta explícita ao JSON adaptado; avisos sobre incompatibilidades sem interpretar conteúdo como HTML.
- `src/integrated/server.ts`: servidor local com lista fechada de arquivos públicos e API na mesma origem. Escuta apenas em 127.0.0.1. Não serve o repositório inteiro.
- `src/dev-preview/`: interface, renderizador dos seis layouts e servidor copiados do laboratório. O servidor ganhou somente o endpoint de projeção compartilhada. A interface integrada reutiliza seu JavaScript e CSS, com adaptação de página e estilos.
- `src/schemas`, `src/providers`, `src/services`, `src/mocks` e demos: lógica copiada, com Zod, revisões, snapshot de aprovação, validação dos slides e provedores Mock/Gemini preservados.
- `src/integration/presentation-adapter.ts`: transformação isolada para o schema oficial, sem alterar os schemas de origem ou destino.
- `tests/`: 86 testes originais preservados e testes adicionais de adaptação e HTTP integrado.
- `e2e/integrated.spec.ts`, `playwright.config.ts`, `vitest.config.ts`: testes reais de navegador separados dos testes de serviços.
- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.vscode/tasks.json`: execução independente, dependências, proteção de arquivos locais e tarefas.

## Frontend e backend

Links laterais abrem páginas reais: visão geral, geração e abas do protótipo Dev 3. Usuários e permissões continuam demonstrativos. Os botões originais do dashboard mantêm seus modais.

O navegador usa caminhos `/api/...` na origem atual, sem proxy externo ou CORS:

| Método e caminho | Função |
|---|---|
| GET `/api/state` | Recupera briefing, roteiro e apresentação em memória |
| POST `/api/scripts` | Gera roteiro no provedor escolhido |
| POST `/api/briefing/invalidate` | Invalida o fluxo anterior quando briefing ou modo mudam |
| POST `/api/scripts/:id/edit` | Salva edição, incrementa revisão e invalida aprovação e apresentação |
| POST `/api/scripts/:id/approve` | Aprova a revisão atual |
| POST `/api/scripts/:id/presentation` | Gera slides somente para o snapshot aprovado |
| GET `/api/presentation/shared` | Retorna projeção oficial e avisos, somente após gerar apresentação |

Edições não salvas bloqueiam aprovação e geração na interface. Cancelar mantém o roteiro salvo. Revisões antigas são rejeitadas no backend. Nova edição exige reaprovação. O frontend renderiza texto gerado usando textContent, sem inserir respostas de IA como HTML. O servidor não fornece arquivos de configuração, fontes TypeScript ou credenciais.

## Diferenças entre contratos

`shared/presentation-schema.json` permanece inalterado.

| Protótipo | Contrato oficial / adaptação |
|---|---|
| `schemaVersion: 1.0.0` | Projeção com `schemaVersion: 1.0` |
| `aspectRatio` 16:9 ou 4:3 | Canvas fixo 1920×1080, 16:9; 4:3 é rejeitado explicitamente |
| `id` do slide | `slideId`, preservando o valor |
| Campos próprios dos seis layouts | Blocos de texto e métrica, com IDs determinísticos e papéis estáveis |
| `referenceIds` | `references` do slide; mesmos identificadores demonstrativos |
| `imageId` fictício | Não vira assetId: bloco de imagem omitido e aviso explícito |
| Contexto das métricas | Bloco de texto separado, sem perda silenciosa |
| Colunas | Papéis `left.heading`, `left.body`, `right.heading`, `right.body` |
| Classificação `DEMONSTRATION` | Mantida como texto nos slides; o oficial não possui campo específico |
| Sem themeId | Configuração local explícita `jump-default`, sem alegar kit institucional aprovado |
| Metadados da apresentação e catálogo de referências | Permanecem no JSON original; o schema oficial não tem campos equivalentes |

A projeção é validada nos testes diretamente contra o JSON Schema oficial usando Ajv 2020. Não substitui o JSON original, não é uma conversão reversível e não constitui uma versão persistida. Os identificadores de referência demonstrativa não são fontes institucionais verificadas. A biblioteca Jump simulada não participa da geração.

## Limitações e próximas etapas

Validação local da integração: TypeScript sem erros; 94 testes de serviços/HTTP/contratos aprovados (incluindo os 86 originais); três testes de navegador Chromium aprovados; validador Jump aprovado para seis itens. Nenhuma chamada real de Gemini foi executada.

- Estado de IA único por processo, compartilhado pelas abas desse processo e perdido ao reiniciar; uso local individual. Sem autenticação, isolamento multiusuário ou banco de dados.
- localStorage do Dev 3 permanece inalterado, mas é separado por origem/porta no navegador: dados de 4174 não aparecem automaticamente em 4175. Não foi feita migração ou limpeza.
- Exportações do Dev 3 continuam simulações de jobs; não produzem PDF/PPTX reais. A IA ainda não salva automaticamente apresentações nesse armazenamento demonstrativo.
- Imagens continuam placeholders. É necessário um registro real de assets e de temas para uma integração institucional.
- O contrato oficial precisa evoluir por decisão da equipe para acomodar metadados, catálogo de fontes, contexto dos blocos e classificação tipada. O adaptador atual registra as diferenças.
- Gemini foi verificado somente com provedores e respostas simuladas. Uso real depende do ambiente configurado pelo usuário e dos cliques explícitos na interface.
- O CSP permite scripts e estilos inline para preservar o HTML e os handlers originais do Dev 3. A extração desses handlers pode ser uma etapa posterior.
- A etapa posterior adicionou DeepSeek sem remover Gemini ou Mock; configuração, arquivos e testes estão em [DEEPSEEK.md](DEEPSEEK.md). Autenticação e banco continuam fora do escopo. Nenhum commit ou push foi realizado.
