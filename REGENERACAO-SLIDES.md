# Etapa 11 — Regeneração individual de slides

Implementada em `DeckAI-oficial/`, na branch `feat/integracao-ia-html`. As alterações locais anteriores foram preservadas. Nenhum commit ou push foi realizado. O schema compartilhado, os módulos independentes do Dev 3, `prototipo-ia/` e os arquivos de credenciais não foram modificados.

## Funcionamento

O serviço prepara somente o contexto do slide selecionado: identificador e revisão da apresentação, briefing original, identificação da revisão aprovada do roteiro, planejamento aprovado desse slide, conteúdo atual, referências já vinculadas, instrução opcional e provedor escolhido. Os demais slides e seus planejamentos não são enviados. O DeepSeek recebe uma operação própria, que retorna diretamente um único objeto slide; não há chamada de geração completa nem recriação do roteiro.

Zod valida o objeto retornado contra os seis layouts existentes. O serviço exige ID original, título/layout aprovados, referências e imageId originais. Respostas com outros campos, envelopes de apresentação, IDs alterados, referências inventadas, JSON inválido ou conclusão incompleta são rejeitadas. As classificações DEMONSTRATION e os rótulos de demonstração fictícia são preservados ou reforçados pelo backend. Conteúdo e instrução opcional são tratados como dados não confiáveis nos prompts de sistema. Credenciais permanecem no backend; os logs não incluem prompts, respostas ou corpos de erros do provedor.

O Mock gera um único slide de forma determinística, sem rede. DeepSeek usa o transporte existente, com timeout de 60 segundos incluindo leitura do corpo, uma tentativa e sem fallback. A operação limita contexto e resposta a 24.000 caracteres e solicita até 4096 tokens. A interface informa expressamente que a regeneração individual com Gemini está indisponível; as funcionalidades anteriores do Gemini continuam disponíveis.

## Comparar, aceitar e descartar

O botão **Regenerar slide** usa o slide atualmente selecionado. O modal mostra número/título, provedor, instrução opcional e comparação usando o renderizador existente. Cabeçalho e ações permanecem acessíveis durante a rolagem. Há estados de carregamento e erro e layout em uma coluna no celular.

Solicitar uma versão guarda apenas uma sugestão temporária no servidor. **Aceitar nova versão** aplica o objeto validado exclusivamente na posição do slide escolhido. **Descartar**, inclusive Escape durante o processamento, cancela a sessão local e invalida a solicitação/sugestão no servidor. Uma resposta cancelada ou substituída não fica disponível para aceite.

O aceite mantém ordem, quantidade, metadados, catálogo de referências, IDs, títulos, layouts e conteúdo dos outros slides. Esses slides são reutilizados como os mesmos objetos em memória. O roteiro, sua revisão e seu snapshot de aprovação permanecem intactos. O JSON original continua no mesmo contrato; a revisão é exposta separadamente no envelope HTTP e em `/api/state`. A projeção compartilhada anteriormente exibida é limpa após o aceite e pode ser consultada novamente pelo adaptador existente.

## Revisões e concorrência

- A primeira apresentação válida começa em `presentationRevision: 1`.
- Somente o aceite incrementa essa revisão; gerar ou descartar sugestões não a altera.
- Roteiro e apresentação têm revisões independentes.
- A sugestão vincula apresentação, revisão, geração do fluxo, conteúdo original e UUID da solicitação; expira em dez minutos.
- Apenas a solicitação/sugestão mais recente fica elegível. Uma sequência interna também rejeita respostas antigas mesmo que requisições reutilizem um UUID.
- O aceite verifica os vínculos e substitui o slide sem operações assíncronas entre validação e gravação. Dois aceites concorrentes não sobrescrevem a mesma revisão.
- Edição manual, aceite de reescrita do roteiro, novo briefing ou nova geração completa invalidam solicitações e sugestões antigas.
- Apresentação ausente, revisão antiga, roteiro sem aprovação correspondente e token expirado retornam conflito. Em conflito entre abas, atualize a página antes de tentar novamente.

As rotas são `POST /api/presentations/:id/regenerate-slide`, `/regeneration-accept` e `/regeneration-discard`. A primeira recebe `revision`, `slideId`, `provider`, `instruction` opcional e `requestId` UUID opcional. As ações recebem somente `requestId`; não aceitam conteúdo do slide enviado pelo navegador. O UUID é usado para confirmar ou cancelar, inclusive antes da chegada da resposta.

## Testar no navegador

1. Na raiz de `DeckAI-oficial/`, execute `npm.cmd run dev:integrated`.
2. Abra `http://127.0.0.1:4175/gerar-ia.html` e selecione **Mock** no briefing.
3. Gere o roteiro, revise, aprove e gere a apresentação.
4. Escolha um slide pela lista ou pelos botões Anterior/Próximo.
5. Clique em **Regenerar slide**, mantenha **Mock**, informe uma instrução opcional e solicite a nova versão.
6. Compare e descarte; confira que conteúdo/revisão permaneceram iguais. Repita e aceite; confira a nova revisão, o slide selecionado e os demais slides.
7. Consulte o JSON completo e o contrato compartilhado na seção avançada. Recarregar a página recupera a revisão atual enquanto o mesmo processo estiver ativo.

Para uso real, selecione DeepSeek no modal com a configuração de backend já existente. Abrir o modal ou trocar seu provedor não faz chamadas de IA. Nenhuma configuração de credenciais foi alterada nesta etapa.

## Verificação

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:browser
```

Resultado em 12/11/2026: **217 testes automatizados, 23 testes Chromium e typecheck aprovados**. A suíte anterior de 176 testes e os 16 cenários Chromium anteriores foram preservados. Foram acrescentados 41 testes automatizados e sete cenários de navegador.

Os testes cobrem DeepSeek com transporte injetado, Mock determinístico, seis layouts, fidelidade de IDs/títulos/layouts, preservação estrutural e de identidade dos outros slides, referências/imagens, aceite/descarte, revisão, expiração, concorrência, respostas atrasadas, substituição completa, erros HTTP, timeout, saída inválida e compatibilidade Ajv com o schema compartilhado. Os testes de edição manual e reescrita anteriores continuam passando. As capturas de desktop e celular ficam em `test-results/regeneration-*.png`, pasta ignorada pelo Git, e foram conferidas visualmente.

Todos os testes evitam chamadas reais a DeepSeek/Gemini e não carregam `.env.local`. O servidor de navegador normal usa provedores reais desativados; o servidor isolado na porta 4185 usa apenas fábricas e transporte simulados.

## Arquivos desta etapa

Criados:

- `src/schemas/slide-regeneration.schema.ts`
- `src/services/slide-regeneration.service.ts`
- `tests/slide-regeneration.test.ts`
- `e2e/slide-regeneration.spec.ts`
- `REGENERACAO-SLIDES.md`

Modificados sobre o estado local encontrado:

- `src/providers/ai-generation-provider.ts`
- `src/providers/deepseek-generation.provider.ts`
- `src/providers/mock-ai-generation.provider.ts`
- `src/services/generation-diagnostics.ts`
- `src/dev-preview/server.ts`
- `src/dev-preview/app.js`
- `src/dev-preview/styles.css`
- `preview-dev3/workflow.js`
- `preview-dev3/shared-json.js`
- `tests/dev-preview.test.ts`
- `tests/support/simulated-integrated-server.ts`
- `README.md`

## Limitações

O estado e as sugestões são locais ao processo, sem banco ou isolamento por usuário. Reiniciar o servidor perde esses dados. Há somente uma sugestão elegível por vez no fluxo; novas solicitações substituem as anteriores. Descartar invalida o resultado, mas uma chamada já enviada ao provedor pode continuar sendo processada no backend até terminar ou expirar. A regeneração individual com Gemini não foi implementada.

A fidelidade estrutural é validada automaticamente; a fidelidade semântica aos objetivos e tópicos e a qualidade da redação exigem revisão humana na comparação. Não houve avaliação real de qualidade, latência, saldo ou disponibilidade dos provedores. Imagens, editor visual definitivo e exportação PDF permanecem fora desta etapa.
