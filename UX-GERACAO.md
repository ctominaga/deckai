# Área Gerar com IA — navegação por etapas

O fluxo anterior exibia formulário, todos os cartões do roteiro e todos os slides ao mesmo tempo. Em janelas estreitas, a barra lateral e o empilhamento tornavam ações comuns difíceis de encontrar.

A interface agora exibe uma etapa por vez: **Briefing → Roteiro → Apresentação**. A navegação permanece visível ao rolar, identifica a etapa atual e bloqueia etapas sem conteúdo. Gerar um roteiro ou uma apresentação com sucesso leva à etapa correspondente. Voltar às anteriores não faz requisições, não altera a revisão e não apaga dados.

O roteiro tem uma lista compacta de seleção e mostra um cartão por vez. O editor mantém título, objetivo, layout e tópicos, com as mesmas ações de salvar/cancelar. Edições pendentes são mantidas ao trocar de slide ou etapa, sinalizadas na interface e continuam bloqueando aprovação/geração. Campos inválidos de um slide oculto são revelados antes de mostrar a validação. Sair/recarregar a página com alterações não salvas solicita a confirmação nativa do navegador.

A apresentação mostra um slide por vez, com seleção direta, Anterior/Próximo e número/título atual. A posição selecionada é preservada ao trocar de etapa. Os seis layouts continuam renderizados a partir dos dados originais, sem imagens estáticas ou regeneração. Os JSONs ficam recolhidos; o JSON original da apresentação e a projeção compartilhada estão em Avançado.

O menu principal recolhe em telas menores, os seletores se reorganizam e os controles de aprovação/geração ficam no rodapé do painel. Há foco visível, botões nativos utilizáveis por teclado, indicação de seleção e mensagens de estado. DeepSeek é a opção inicial do gerador integrado; nenhum provedor é chamado automaticamente.

## Arquivos da etapa

- `preview-dev3/gerar-ia.html`: estrutura e controles das etapas, seletores e painel avançado.
- `preview-dev3/ai-shell.css`: layout, responsividade, foco, contraste e ações persistentes.
- `preview-dev3/workflow.js`: estado exclusivamente visual, seleção e navegação sem chamadas de API.
- `src/dev-preview/app.js`: eventos para comunicar o estado à navegação e pequenos ajustes de foco/validação; serviços e regras de geração permanecem iguais.
- `src/integrated/server.ts`: adiciona o novo JavaScript à lista fechada de arquivos públicos.
- `e2e/integrated.spec.ts`, `e2e/deepseek.spec.ts`: adaptação dos testes existentes à navegação por etapas.
- `e2e/workflow-ux.spec.ts`: preservação das edições, seleção, seis layouts, erros/carregamento e diferentes larguras.
- `README.md`, `DEEPSEEK.md`, `.vscode/tasks.json`: instruções e descrições ajustadas à seleção inicial atual. Comandos e portas das tarefas não mudaram.

## Validação e limites

141 testes automatizados e typecheck aprovados. Sete testes Chromium aprovados, usando Mock e provedores/respostas simulados. Inspeção de capturas em 1440, 1024, 800, 390 e 320 pixels, sem rolagem horizontal; ações comuns ficam próximas ao conteúdo selecionado. O teste existente dos fluxos do Dev 3 permanece aprovado.

Rascunhos de edição são mantidos na memória da página, não persistidos entre recarregamentos. O aviso de saída depende do suporte do navegador. Slides com conteúdo longo ainda exigem rolagem vertical. Não foi implementado editor visual definitivo ou fidelidade de exportação para PowerPoint.

Reinicie **DeckAI — Iniciar sistema integrado** e abra **http://127.0.0.1:4175/** para carregar também a nova rota do JavaScript. Nenhum arquivo de credenciais, provedor, schema compartilhado ou protótipo original foi modificado; não houve chamadas reais de IA, commits ou pushes.
