# Proposta técnica independente — Deck AI

## 1. Resumo executivo e proposta recomendada

Recomenda-se um monólito modular com uma API única, banco relacional, armazenamento de objetos, uma fila persistente e exportadores executados por workers. O JSON versionado da apresentação deve ser a fonte principal; HTML, PDF e PPTX são projeções geradas a partir de uma versão imutável.

Para o piloto, a arquitetura deve privilegiar rastreabilidade, recuperação e previsibilidade, não microserviços. A divisão do Desenvolvedor 3 faz sentido, mas é ampla: plataforma, conteúdo institucional e exportações formam três áreas de risco diferentes. Ela é viável com três desenvolvedores somente se houver um proprietário claro de cada fluxo e se o PPTX tiver uma meta de edição limitada.

Recomendação de MVP:

- um kit institucional aprovado;
- seis layouts 16:9 com esquema fechado de blocos;
- geração com Gemini atrás de um adaptador;
- revisão de roteiro antes da geração;
- conteúdo Jump somente quando aprovado e válido;
- edição manual de texto, imagens e dados nos blocos suportados;
- versões imutáveis, autosave controlado e histórico;
- HTML autônomo, PDF e PPTX gerados por jobs;
- PPTX editável no nível de textos, imagens, formas e tabelas simples, sem prometer equivalência total com HTML.

O prazo de 8–10 semanas é plausível apenas como piloto interno com escopo disciplinado, equipe disponível regularmente, infraestrutura já acessível e aprovação institucional rápida. Um PPTX de alta fidelidade, edição livre de qualquer objeto e um fluxo editorial complexo são incompatíveis com essa meta sem reduzir outras entregas.

## 2. Premissas e limites greenfield

Esta proposta parte exclusivamente do contexto descrito. Não pressupõe código, protótipos, decisões tecnológicas, dados, integrações ou infraestrutura existentes.

Premissas de planejamento:

- três desenvolvedores trabalhando regularmente, com um deles capaz de atuar como responsável técnico do backend/exportação;
- um ambiente de hospedagem gerenciado, banco e armazenamento de objetos disponíveis ou provisionáveis sem projeto de infraestrutura dedicado;
- volume inicial pequeno de organizações, usuários, apresentações e conteúdo;
- um kit Jump e um processo institucional de aprovação simples;
- uma conta/projeto para o provedor de IA e credenciais de exportação disponíveis;
- a equipe aceita congelar o esquema dos seis layouts durante o piloto;
- o piloto não exige colaboração simultânea em tempo real.

Fora do escopo desta proposta: implementação, instalação de dependências, escolha final de fornecedor, operação 24x7, faturamento, edição colaborativa em tempo real, mobile nativo, múltiplos kits complexos, pesquisa semântica avançada e garantia de identidade visual perfeita entre todos os formatos.

## 3. Avaliação da divisão entre três desenvolvedores

A frente do Desenvolvedor 3 é coerente em termos de dependências: autenticação, persistência, conteúdo aprovado, jobs e exportação precisam compartilhar modelos de estado e rastreabilidade. Porém, ela concentra o maior risco operacional do MVP.

Divisão recomendada:

| Responsável | Núcleo | Responsabilidades principais |
|---|---|---|
| Dev 1 | experiência e editor | roteiro, conversa, editor, preview, apresentação, integração com contratos de apresentação |
| Dev 2 | geração e domínio | adaptador Gemini, orquestração de geração, validação do JSON, layouts e regeneração localizada |
| Dev 3 | plataforma e entrega | banco, autenticação, permissões, conteúdo Jump, arquivos, fila, versões, exportadores e downloads |

Cada fluxo deve ter um dono, mas decisões sobre o schema, layouts e contratos precisam ser conjuntas. Dev 3 deve receber ajuda explícita de Dev 1 ou Dev 2 para testes de aceitação visual e para não se tornar gargalo.

Alternativa, se a equipe tiver pouca experiência com exportação: Dev 3 fica com plataforma, conteúdo e jobs; Dev 2 assume o pipeline de renderização e exportadores; Dev 1 mantém interface. O custo é reduzir o escopo de geração ou de administração de conteúdo para criar capacidade de validação visual. Essa alternativa aumenta a chance de um PPTX utilizável, mas diminui a velocidade de funcionalidades de IA.

## 4. Arquitetura sugerida

### 4.1 Componentes

- **API monolítica modular:** autenticação, apresentações, conteúdo, jobs, exportações e administração como módulos separados no mesmo processo.
- **Banco relacional:** PostgreSQL para entidades, versões, permissões, auditoria, estados e referências.
- **Object storage privado:** imagens originais, imagens derivadas, documentos-fonte, artefatos HTML/PDF/PPTX e manifests.
- **Fila persistente:** jobs com `idempotency_key`, lease/timeout, tentativas, backoff e dead-letter lógico.
- **Workers:** geração, processamento de mídia, exportação e validações de artefatos.
- **Renderizador canônico:** um renderer de layout para HTML/preview; exportadores consomem o mesmo modelo sem permitir que cada formato tenha regras divergentes.
- **Observabilidade:** logs estruturados, métricas de jobs e correlação por `request_id`, `presentation_id` e `job_id`.

### 4.2 Persistência e arquivos

O banco guarda metadados, conteúdo textual estruturado, hashes, permissões e estados. Arquivos grandes ficam no object storage. Todo artefato recebe `content_hash`, `media_type`, tamanho, versão e política de retenção.

O download deve usar URL temporária assinada, autorizada no servidor e com expiração curta. O bucket não deve ser público. Para artefatos sensíveis, registrar quem solicitou, qual versão foi baixada e quando.

### 4.3 Autenticação e autorização

Para o MVP, recomenda-se um provedor OIDC gerenciado, com login corporativo quando disponível e recuperação de conta delegada ao provedor. A aplicação mantém identidade local, organização, papéis e auditoria.

Modelo mínimo de autorização:

- `owner`: administra a organização e membros;
- `editor`: cria, edita, gera e exporta apresentações;
- `reviewer`: administra conteúdo Jump e aprova/rejeita;
- `viewer`: visualiza e baixa conforme política;
- `admin`: suporte operacional limitado, com auditoria.

As permissões devem ser verificadas no servidor por organização e recurso. A interface nunca é a autoridade final.

## 5. Tecnologias, alternativas e complexidade

Recomendação de MVP:

- TypeScript em API e workers, por compartilhar tipos com a interface;
- PostgreSQL, por transações, JSONB, índices e integridade referencial;
- object storage compatível com S3, privado;
- fila baseada em PostgreSQL ou Redis gerenciado. PostgreSQL reduz componentes; Redis pode oferecer melhor throughput, mas adiciona operação;
- OIDC gerenciado, evitando construir autenticação;
- Gemini por adaptador versionado, com validação de schema e registro de modelo/prompt;
- HTML/SVG/CSS como representação de renderização;
- PDF por Chromium headless ou serviço equivalente, validando fontes e paginação;
- PPTX por biblioteca com suporte a formas/textos/imagens, ou por um pipeline híbrido. A prova técnica deve decidir a biblioteca final;
- armazenamento e observabilidade gerenciados no provedor de hospedagem.

Alternativas:

- **Microserviços:** melhor isolamento futuro, porém aumentam deploys, contratos, logs, filas e custo operacional; não recomendados para o piloto.
- **Banco documental:** simplifica o JSON, mas enfraquece relacionamentos, auditoria e consultas administrativas; PostgreSQL com JSONB é mais equilibrado.
- **Fila externa dedicada:** melhor escala e recursos de entrega, mas custo e operação maiores; reservar para crescimento.
- **Editor baseado em canvas:** flexível, porém torna exportação e acessibilidade mais difíceis. Para o MVP, usar blocos e layouts fechados.
- **PPTX convertido de PDF/imagem:** maior fidelidade visual potencial, mas praticamente não editável; só aceitável como fallback explicitamente identificado.

Custos relevantes incluem uso de IA por tokens, armazenamento de versões/artefatos, execuções de Chromium, tráfego de downloads, logs e eventual serviço OIDC. O orçamento deve ter limites por organização e retenção de artefatos.

## 6. Modelo de dados e contratos

### 6.1 Apresentação e versão

```json
{
  "presentationId": "pres_123",
  "organizationId": "org_1",
  "title": "Proposta institucional",
  "status": "draft",
  "currentVersionId": "ver_7",
  "createdBy": "usr_1",
  "createdAt": "2026-10-28T12:00:00Z",
  "updatedAt": "2026-10-28T12:30:00Z"
}
```

```json
{
  "versionId": "ver_7",
  "presentationId": "pres_123",
  "versionNumber": 7,
  "schemaVersion": "1.0",
  "source": "user_edit",
  "baseVersionId": "ver_6",
  "content": {
    "canvas": { "width": 1920, "height": 1080, "ratio": "16:9" },
    "themeId": "jump-default",
    "slides": [
      {
        "slideId": "slide_1",
        "layout": "cover",
        "blocks": [
          { "id": "b1", "type": "text", "role": "title", "text": "Título" },
          { "id": "b2", "type": "image", "assetId": "asset_9", "fit": "cover" }
        ],
        "references": ["ref_44"]
      }
    ]
  },
  "validation": { "status": "valid", "errors": [], "warnings": [] },
  "contentHash": "sha256:...",
  "createdBy": "usr_1",
  "createdAt": "2026-10-28T12:30:00Z"
}
```

Uma versão é imutável. Salvamentos criam nova versão ou um rascunho explicitamente mutável que só se torna versão ao confirmar. Para o MVP, recomenda-se criar versões em checkpoints e manter autosave como rascunho temporário.

### 6.2 Conteúdo Jump, origem e validade

```json
{
  "contentId": "jump_42",
  "organizationId": "org_1",
  "title": "Descrição da solução",
  "category": "produto",
  "tags": ["institucional", "solucao"],
  "body": { "text": "Texto aprovado...", "claims": ["claim_1"] },
  "status": "approved",
  "validFrom": "2026-01-01",
  "validUntil": "2027-01-01",
  "source": { "type": "document", "label": "Manual institucional", "uri": "asset_10" },
  "owner": "usr_2",
  "review": { "approvedBy": "usr_3", "approvedAt": "2026-01-02T10:00:00Z", "reviewNote": "" },
  "version": 3,
  "createdAt": "2025-12-20T10:00:00Z"
}
```

Cada afirmação factual deve poder apontar para uma ou mais referências:

```json
{
  "referenceId": "ref_44",
  "contentId": "jump_42",
  "claimId": "claim_1",
  "sourceType": "document",
  "sourceAssetId": "asset_10",
  "locator": { "page": 3, "section": "Resultados" },
  "quoteOrExcerpt": "Trecho curto de suporte",
  "capturedAt": "2026-01-02T09:00:00Z"
}
```

Estados recomendados para conteúdo: `draft`, `in_review`, `approved`, `rejected`, `expired`, `archived`. `approved` só é utilizável se a data atual estiver dentro da validade, a versão estiver ativa e não houver conflito aberto. Conteúdo vencido ou contraditório deve ser excluído do contexto factual ou explicitamente sinalizado; nunca deve ser tratado como fato aprovado.

### 6.3 Permissões

```json
{
  "organizationId": "org_1",
  "subjectId": "usr_1",
  "resourceType": "presentation",
  "resourceId": "pres_123",
  "role": "editor",
  "grantedBy": "usr_admin",
  "createdAt": "2026-10-28T12:00:00Z"
}
```

Papéis herdados da organização devem ser combinados com permissões específicas somente quando necessário. Negação explícita e conflitos de papéis precisam de regra definida antes da implementação.

### 6.4 Exportação e jobs

```json
{
  "exportId": "exp_8",
  "presentationId": "pres_123",
  "versionId": "ver_7",
  "format": "pptx",
  "options": { "editableLevel": "structured" },
  "status": "queued",
  "idempotencyKey": "pres_123:ver_7:pptx:structured",
  "requestedBy": "usr_1",
  "jobId": "job_91",
  "artifact": null,
  "createdAt": "2026-10-28T12:35:00Z"
}
```

```json
{
  "jobId": "job_91",
  "type": "export_pptx",
  "status": "retrying",
  "attempt": 2,
  "maxAttempts": 3,
  "availableAt": "2026-10-28T12:36:00Z",
  "lockedUntil": null,
  "error": { "code": "FONT_UNAVAILABLE", "message": "Fonte não encontrada", "retryable": false },
  "traceId": "trace_abc",
  "createdAt": "2026-10-28T12:35:00Z",
  "updatedAt": "2026-10-28T12:35:20Z"
}
```

Estados de job: `queued`, `running`, `retrying`, `succeeded`, `failed`, `cancelled`, `dead_letter`. O worker deve renovar lease, registrar progresso quando útil e tornar o efeito idempotente antes de publicar o resultado.

### 6.5 API inicial

Exemplos de contratos, a validar conjuntamente:

- `POST /presentations` cria apresentação e versão inicial;
- `GET /presentations/{id}` retorna metadados e versão atual autorizada;
- `POST /presentations/{id}/versions` cria versão a partir de JSON validado;
- `GET /presentations/{id}/versions` lista histórico;
- `POST /jump-content` cria conteúdo em `draft`;
- `POST /jump-content/{id}/submit-review` envia para revisão;
- `POST /jump-content/{id}/approve` aprova com validade obrigatória;
- `GET /jump-content?status=approved&validAt=...` retorna somente itens elegíveis;
- `POST /exports` cria ou reutiliza exportação idempotente;
- `GET /exports/{id}` consulta estado;
- `POST /exports/{id}/download` emite URL assinada se o estado for `succeeded` e o usuário estiver autorizado.

Erros devem usar formato consistente:

```json
{
  "error": {
    "code": "VERSION_SCHEMA_INVALID",
    "message": "A versão contém blocos incompatíveis com o schema.",
    "details": [{ "path": "slides[0].blocks[1]", "reason": "assetId obrigatório" }],
    "requestId": "req_123",
    "retryable": false
  }
}
```

## 7. Layouts e fonte de verdade

Os seis layouts devem ser contratos de composição, não telas livres:

1. `cover`: título, subtítulo opcional, imagem opcional;
2. `text_image`: texto estruturado e imagem;
3. `two_columns`: dois grupos de conteúdo com limites definidos;
4. `metrics`: até quatro indicadores com rótulo, valor, unidade e referência;
5. `case`: contexto, desafio, abordagem, resultado e fonte;
6. `closing`: mensagem final, chamada para ação e identidade visual.

Todos devem ter limites de texto, comportamento de overflow, áreas seguras, proporções, tokens de tipografia e fallback de imagem. A IA só pode produzir blocos permitidos pelo schema. Dados e claims devem carregar referências no próprio JSON, para que o renderer e a revisão mostrem rastreabilidade.

## 8. Fluxos principais e tratamento de erros

### Conteúdo Jump

1. Usuário autorizado cria rascunho e anexa fonte.
2. Sistema calcula hash, extrai metadados e registra autoria/origem.
3. Usuário envia para revisão; conteúdo fica bloqueado para alteração estrutural ou retorna a `draft` ao editar.
4. Reviewer aprova com validade e observação, ou rejeita com motivo.
5. Consulta da IA filtra por organização, `approved`, janela de validade e ausência de conflito.
6. Uso gera referências vinculadas à versão da apresentação.

Falhas de extração devem manter o documento em revisão com erro acionável. Alteração de conteúdo aprovado cria nova versão, sem sobrescrever a evidência usada anteriormente.

### Geração e consulta pela IA

O backend compõe contexto somente com conteúdo elegível, envia ao adaptador Gemini instruções de não inventar fatos e exige JSON validável. A resposta deve passar por validação estrutural e por uma checagem de claims sem referência. Se houver ausência, vencimento ou contradição, retornar estado explícito (`needs_confirmation`, `omit_claim` ou `source_conflict`) para a interface.

Falha de schema pode ser corrigida por uma tentativa de reparo controlada; após limite definido, o job falha sem salvar uma versão publicada.

### Salvamento e versões

O cliente envia `baseVersionId` e `clientMutationId`. O servidor rejeita conflito de base ou cria uma versão derivada, conforme decisão conjunta. A operação deve ser idempotente por `clientMutationId` e não deve perder a versão anterior.

### Exportação

1. Usuário solicita formato para uma versão específica.
2. API autoriza, valida a versão e cria/reutiliza job por chave idempotente.
3. Worker baixa assets privados, renderiza em ambiente controlado, valida o artefato e calcula hash.
4. Artefato é publicado atomicamente no storage; exportação fica `succeeded`.
5. Download emite URL curta e auditável.

Erro determinístico, como layout inválido ou fonte ausente, não deve ser repetido automaticamente. Erro transitório de storage ou processo pode ter backoff exponencial. Após o limite, enviar para `dead_letter` e permitir reprocessamento manual seguro.

## 9. Exportações: alternativas e provas técnicas

HTML deve ser o formato canônico de preview e apresentação. “Autônomo” precisa significar: um arquivo ou pacote definido, sem chamadas de rede, contendo imagens embutidas ou referenciadas localmente, fontes incorporadas/licenciadas ou fallback declarado, CSS/JS incluídos, sem dependência de CDN, abrindo em navegador compatível e funcionando sem rede. A equipe deve decidir se entrega um `.html` único ou `.zip` offline; o segundo é mais realista para fontes e assets.

PDF por Chromium preserva melhor o layout HTML, mas pode divergir em quebra de página, fontes, SVG e animações. Fixar viewport, fontes e versão do navegador reduz variação.

PPTX tem três opções:

- **Nativo estruturado:** recriar textos, imagens, formas e tabelas como objetos PowerPoint. Melhor edição, maior custo e diferenças de posicionamento;
- **PPTX baseado em imagem por slide:** fidelidade visual alta, edição quase nula;
- **Híbrido:** textos e elementos simples editáveis, gráficos complexos como imagem. É a recomendação para o MVP.

O nível de edição deve ser declarado no contrato: título, corpo, indicadores, imagens e formas simples editáveis; efeitos, composição avançada e alguns gráficos podem ser achatados. Não prometer que qualquer objeto criado pela IA será livremente editável.

Provas técnicas antes de comprometer o prazo:

- um slide de cada layout para gerar HTML, PDF e PPTX;
- teste com fontes licenciadas, SVG, imagem com recorte e texto longo;
- abertura no PowerPoint e comparação visual por imagem;
- inspeção programática de textos/objetos do PPTX;
- teste do HTML sem rede, com assets e fontes locais;
- reexecução do mesmo job para validar idempotência e hash igual.

Critérios de aceite separados:

- **HTML:** todos os slides, assets locais, sem requisições externas, navegação/apresentação funcionando e layout consistente em navegador-alvo;
- **PDF:** páginas 16:9, conteúdo completo, fontes legíveis, sem cortes/overflow, assets presentes e hash/metadata registrados;
- **PPTX:** abre sem reparo, proporção correta, todos os slides presentes, texto principal pesquisável/editável, imagens visíveis, objetos híbridos identificados e divergência visual dentro de um limiar acordado.

## 10. Fases, backlog e estimativas

Estimativas abaixo são esforço aproximado, não datas garantidas; assumem equipe disponível, decisões rápidas e infraestrutura gerenciada.

| Prioridade | Item | Dono | Esforço | Dependências | Aceite |
|---|---|---|---:|---|---|
| P0 | JSON canônico e schema versionado | Dev 2 + todos | 3–5 dias | decisões de layouts | validação rejeita JSON inválido e preserva referências |
| P0 | modelo de apresentação/versões | Dev 3 | 3–4 dias | schema | criar, listar, recuperar e versionar sem perder histórico |
| P0 | autenticação e escopo por organização | Dev 3 | 3–5 dias | provedor OIDC | usuário sem permissão não lê nem baixa recursos |
| P0 | seis layouts e renderer | Dev 1 + Dev 2 | 5–8 dias | schema | cada layout renderiza com overflow definido |
| P0 | adaptador Gemini e validação | Dev 2 | 5–8 dias | schema, conteúdo | saída válida ou erro/solicitação de confirmação explícita |
| P0 | Jump: CRUD, revisão, validade e referências | Dev 3 | 6–9 dias | auth, storage | somente aprovado/válido entra no contexto |
| P0 | storage e upload seguro | Dev 3 | 3–5 dias | auth | arquivos privados e URLs temporárias |
| P0 | jobs, idempotência e retry | Dev 3 | 4–6 dias | banco/storage | reexecução não duplica artefato |
| P0 | prova de exportações | Dev 2 + Dev 3 | 4–7 dias | renderer | decisão documentada e artefatos abrem |
| P0 | exportadores HTML/PDF/PPTX | Dev 3 + apoio Dev 2 | 7–12 dias | prova, layouts | critérios de aceite por formato |
| P1 | administração e auditoria | Dev 3 | 3–5 dias | Jump/auth | ações críticas rastreáveis |
| P1 | editor, revisão de roteiro e regeneração | Dev 1 + Dev 2 | 8–12 dias | API/schema | alteração localizada não modifica slides não alvo |
| P1 | observabilidade, backup e hardening | Dev 3 | 3–5 dias | todos | restauração e falhas básicas verificáveis |

Um caminho realista para 8–10 semanas exige paralelismo e pode precisar cortar: múltiplos kits, upload documental sofisticado, busca semântica, colaboração simultânea e PPTX avançado. O principal comprometedor é descobrir tarde que a fidelidade/edição do PPTX exige outro renderer ou trabalho manual por layout.

## 11. Integrações com os outros desenvolvedores

Dev 1 depende do schema, endpoint de versões, permissões e estados de exportação. Dev 3 depende dos tipos de bloco, regras de asset e eventos de salvamento definidos com Dev 1/2. Dev 2 depende da lista de layouts, formato de referências e resposta de conflito factual.

Decisões bloqueadoras:

- schema final dos blocos e política de evolução;
- quem pode alterar uma versão e como conflitos são tratados;
- definição de “conteúdo aprovado e válido”;
- prompt/contrato do adaptador Gemini e formato de claims;
- renderer canônico e tolerância visual;
- nível de edição PPTX;
- HTML único versus pacote offline;
- limites de tamanho, timeout e retenção de arquivos;
- provedor de identidade e ambiente de hospedagem.

## 12. Testes, observabilidade, segurança, backup e performance

Testes mínimos:

- unitários para transições de estado, validade, autorização, idempotência e schema;
- integração para banco, storage, fila e URLs assinadas;
- contrato entre interface, API, geração e exportação;
- golden files para seis layouts e cada formato;
- testes de abertura de PDF/PPTX e inspeção de objetos;
- testes de conteúdo: vencido, rejeitado, ausente, contraditório e referência quebrada;
- testes de recuperação: worker interrompido, lease expirado, retry e duplicidade;
- teste de segurança para isolamento entre organizações e download sem autorização.

Observabilidade deve incluir duração, taxa de erro e tentativas por tipo de job; uso de IA e custo estimado; tamanho e tempo dos artefatos; falhas de fonte/asset; correlação ponta a ponta; auditoria de aprovação, exportação e download. Não registrar tokens, documentos ou conteúdo sensível em logs sem mascaramento.

Segurança: princípio do menor privilégio, secrets fora do código, criptografia em trânsito e em repouso, validação de MIME e tamanho, antivírus ou análise de arquivos conforme risco, nomes de storage não previsíveis, URLs expiráveis, proteção contra path traversal e sanitização de HTML/SVG.

Backup: backup automático do banco, versionamento/retensão do storage para fontes e artefatos importantes, teste periódico de restauração e definição de RPO/RTO do piloto. A restauração deve preservar hashes e referências.

Performance: limites de slides, tamanho de imagem e duração de jobs; compressão e thumbnails; paginação; índices por organização/status/validade; worker separado para exportação; cache somente para conteúdo imutável. O piloto deve medir p95 de leitura, salvamento e exportação antes de otimizar.

## 13. MVP versus depois

### MVP

- uma organização ou isolamento multi-organização básico;
- papéis essenciais;
- um kit Jump;
- seis layouts fechados;
- conteúdo aprovado com validade e referências;
- Gemini via adaptador;
- revisão de roteiro e confirmação de claims;
- edição manual limitada aos blocos;
- versões e histórico;
- HTML offline em pacote definido, PDF e PPTX híbrido;
- fila, retries, downloads seguros e auditoria básica.

### Depois

- colaboração simultânea e comentários;
- busca semântica e ranking sofisticado;
- múltiplos kits com regras independentes;
- extração avançada de documentos e OCR;
- editor livre de canvas;
- PPTX completamente editável e paridade visual estrita;
- aprovação multinível, SLA editorial e workflow por departamento;
- versionamento semântico e comparação visual avançada;
- exportação para outros formatos e apresentações online públicas.

## 14. Plano da primeira semana

### Resultado 1 — JSON de referência

Dia 1: workshop com os três desenvolvedores para definir canvas, entidades, tipos de bloco, claims e referências. Dia 2: escrever exemplo completo de uma apresentação com seis layouts. Dia 3: validar schema, erros e evolução de versão. Dias 4–5: revisar com interface, geração e exportação; congelar uma versão de discussão, não de produto final.

### Resultado 2 — definição dos seis layouts

Para cada layout, registrar wireframe, áreas, tokens, limites, overflow, conteúdo obrigatório/opcional, fallback de imagem, referência factual e comportamento nos três formatos. O aceite é uma tabela de propriedades e um exemplo representativo por layout.

### Resultado 3 — prova de HTML, PDF e PPTX

Usar um exemplo pequeno com texto curto/longo, imagem, indicador, case e referência. Comparar HTML offline, PDF e PPTX híbrido; registrar limitações, tempo de renderização, fontes, objetos editáveis e defeitos. A decisão de escopo do PPTX deve sair dessa prova, antes do backlog de implementação.

### Resultado 4 — backlog consolidado e distribuído

Quebrar cada contrato em tarefas com dono, dependência, aceite e risco. Marcar como bloqueador tudo que impeça dois desenvolvedores de trabalhar em paralelo. Reservar capacidade para integração, correções de exportação e testes; não preencher 100% da semana com funcionalidades.

## 15. Decisões para a reunião conjunta e bloqueios

Decisões que precisam ser tomadas:

1. schema canônico, evolução e política de versões;
2. edição livre versus blocos fechados no MVP;
3. definição de claim, referência e conflito factual;
4. workflow e papéis de aprovação Jump;
5. validade por data, evento ou revisão manual;
6. provedor de autenticação, hospedagem, banco, storage e fila;
7. HTML único ou pacote offline;
8. tolerância visual e nível de edição do PPTX;
9. limites de tamanho, timeout, retenção, custo e volume;
10. política de concorrência e autosave;
11. critérios de aceite dos três formatos;
12. RPO/RTO e responsável por operação do piloto.

Dependências que podem bloquear o trabalho:

- acesso ao provedor de IA e definição de limites/custos;
- identidade visual, fontes e assets autorizados;
- disponibilidade de um reviewer institucional;
- decisão sobre fontes e licenças de exportação;
- ambiente de hospedagem com workers e storage privado;
- disponibilidade de exemplos reais ou dados fictícios aprovados;
- aprovação do escopo de edição PPTX;
- acordo sobre política de fatos sem fonte, conteúdo vencido e contradição.

Conclusão: a frente do Desenvolvedor 3 é adequada como núcleo de plataforma e governança de conteúdo, mas deve ser protegida contra escopo excessivo. O piloto deve congelar contratos cedo, provar as exportações na primeira semana e tratar PPTX híbrido como limite explícito. Assim, a meta de 8–10 semanas pode ser perseguida com risco conhecido, sem apresentar como garantida.
