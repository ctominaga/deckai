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

Os módulos locais ainda não são backend de produção. Eles usam dados simulados e `localStorage`.

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
preview-dev3/            prévia visual e protótipo funcional
```

## Próxima etapa recomendada

Validar com os três desenvolvedores:

1. schema JSON;
2. estados do conteúdo Jump;
3. permissões;
4. contrato de criação de apresentação;
5. contrato de exportação.

Depois disso, substituir o `localStorage` por uma API e um banco reais.

## Status de 16/11/2026

### Concluído

- contratos compartilhados e schema JSON;
- modelo de dados inicial;
- protótipos locais de apresentações, versões, conteúdo Jump, permissões, jobs, auditoria e backup;
- validação de conteúdo Jump;
- validação de respostas da IA;
- API local simulada;
- página local de teste da API;
- adaptador inicial para DeepSeek;
- configuração segura por variável de ambiente;
- commits sincronizados na branch `main`.

### Em andamento

- conectar o adaptador DeepSeek aos endpoints de IA;
- integrar a API local com o protótipo visual;
- definir o formato final dos contratos com o Desenvolvedor 2;
- testar geração real com a chave local;

### Pendentes

- banco de dados real;
- autenticação real;
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
