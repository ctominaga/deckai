# Deck AI

Protótipo e planejamento inicial do Deck AI, uma ferramenta para criar apresentações com IA usando conteúdo institucional rastreável.

## Estado atual

O projeto está na fase de fundação local. Já existem:

- proposta técnica;
- contratos compartilhados;
- schema JSON de apresentação;
- modelo de dados da plataforma;
- dados simulados;
- armazenamento local de apresentações e versões;
- armazenamento local de conteúdo Jump;
- armazenamento local de jobs;
- permissões locais;
- validação de conteúdo Jump;
- prévia visual;
- protótipo funcional local.

Além dos módulos visuais em `localStorage`, já existe uma primeira API persistente de desenvolvimento. Ela oferece login, permissões, apresentações versionadas e aprovação de conteúdo Jump. O arquivo JSON usado localmente facilita os testes, mas ainda será substituído por PostgreSQL antes da produção.

## Executar a API persistente

Na raiz do repositório:

```powershell
node platform/api/server.mjs
```

A API fica disponível em `http://127.0.0.1:8788`. Consulte `platform/api/README.md` para criar o primeiro gestor e autenticar.

Para executar os testes sem depender do comando `npm` no PowerShell:

```powershell
node --test platform/api/*.test.mjs
```

## Abrir a prévia

Na pasta `preview-dev3`, execute:

```powershell
python -m http.server 5173
```

Depois acesse:

```text
http://localhost:5173
```

O protótipo funcional fica em:

```text
http://localhost:5173/prototipo.html
```

## O que testar no protótipo

1. Criar uma apresentação.
2. Salvar uma versão local.
3. Cadastrar conteúdo Jump com fonte.
4. Enviar o conteúdo para revisão.
5. Aprovar o conteúdo.
6. Criar um job de exportação.
7. Repetir o mesmo job e observar a regra de idempotência.

## Estrutura principal

```text
shared/                  contratos entre os desenvolvedores
platform/                plataforma, conteúdo Jump e exportações
platform/local-store/    protótipos locais sem backend
platform/mock-data/      dados de demonstração
platform/validation/     validações locais
platform/api/            API persistente de desenvolvimento
preview-dev3/            prévia visual e protótipo funcional
```

## Próxima etapa recomendada

Validar com os três desenvolvedores:

1. schema JSON;
2. estados do conteúdo Jump;
3. permissões;
4. contrato de criação de apresentação;
5. contrato de exportação.

Depois disso, conectar as telas à nova API e migrar a persistência de desenvolvimento para PostgreSQL.

## Status de 16/11/2026

### Concluído

- contratos compartilhados e schema JSON;
- modelo de dados inicial;
- protótipos locais de apresentações, versões, conteúdo Jump, permissões, jobs, auditoria e backup;
- validação de conteúdo Jump;
- validação de respostas da IA;
- API local simulada;
- página local de teste da API;
- visualizador local de apresentações, versões e slides;
- editor local com novas versões e duplicação;
- adaptador inicial para DeepSeek;
- configuração segura por variável de ambiente;
- commits sincronizados na branch `main`.
- API persistente de desenvolvimento com autenticação e sessões;
- permissões aplicadas pelo backend;
- CRUD inicial de apresentações com histórico e conflito de versão;
- fluxo Jump de rascunho, revisão, aprovação, rejeição e arquivamento;
- filtro para fornecer à IA somente conteúdo aprovado e válido;
- trilha básica de auditoria;
- testes automatizados da autenticação, versionamento e política Jump.

### Em andamento

- conectar o adaptador DeepSeek aos endpoints de IA;
- conectar o visualizador ao JSON completo de layouts;
- integrar o editor aos blocos completos do JSON;
- integrar a API local com o protótipo visual;
- definir o formato final dos contratos com o Desenvolvedor 2;
- testar geração real com a chave local;
- substituir a persistência JSON de desenvolvimento por PostgreSQL;

### Pendentes

- banco PostgreSQL de produção;
- tela de login conectada à autenticação já disponível na API;
- storage privado;
- fila e workers de produção;
- integração real com Gemini;
- exportações reais em PDF e PPTX;
- área administrativa completa;
- testes integrados e de segurança.

### Próximos passos

1. selecionar o provedor por configuração (`mock`, `deepseek` ou `gemini`);
2. conectar DeepSeek ao endpoint de roteiro;
3. validar uma resposta real contra o schema;
4. conectar geração real ao protótipo;
5. registrar custo, tokens, duração e erros.

## Segurança

Arquivos de cliente e materiais confidenciais não devem ser enviados ao repositório. O `.gitignore` bloqueia formatos comuns como PPTX, PDF, DOCX e XLSX.
