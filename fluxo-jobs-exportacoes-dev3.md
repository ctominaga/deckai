# Fluxo de jobs e exportações — Deck AI

Especificação inicial para o MVP. O objetivo é tornar operações demoradas recuperáveis e evitar arquivos duplicados.

## 1. Tipos de job

| Tipo | Função |
|---|---|
| `generate_presentation` | solicitar geração de apresentação à IA |
| `export_html` | gerar pacote HTML offline |
| `export_pdf` | gerar PDF a partir do renderer |
| `export_pptx` | gerar PowerPoint híbrido |
| `process_asset` | validar e preparar imagem/documento |

## 2. Ciclo de vida

```text
queued
  ↓
running
  ├── succeeded
  ├── retrying → running
  ├── failed
  └── cancelled
```

Depois do número máximo de tentativas, o job fica em `dead_letter` para análise ou reprocessamento manual.

## 3. Criação do job

Quando o usuário solicita uma exportação:

1. API verifica a permissão do usuário.
2. API confirma que a versão existe e é válida.
3. API cria uma chave idempotente.
4. Sistema procura job igual já concluído ou em andamento.
5. Se existir, retorna o job existente.
6. Se não existir, cria um job `queued`.

Exemplo de chave:

```text
organizationId:presentationId:versionId:format:optionsHash
```

## 4. Worker

O worker deve:

1. buscar um job disponível;
2. reservar o job por um período de lease;
3. mudar o estado para `running`;
4. baixar somente os assets autorizados;
5. gerar o arquivo em área temporária;
6. validar o arquivo;
7. calcular hash e tamanho;
8. publicar o artefato no storage privado;
9. atualizar a exportação para `succeeded`;
10. liberar o job.

Se o processo morrer, o lease expira e outro worker pode retomar o job.

## 5. Classificação de erros

### Retentável

- timeout temporário;
- indisponibilidade momentânea do storage;
- erro de conexão;
- limite temporário do provedor de IA;
- encerramento inesperado do worker.

### Não retentável automaticamente

- JSON inválido;
- slide sem layout conhecido;
- asset inexistente;
- fonte não encontrada;
- usuário sem permissão;
- arquivo final inválido;
- conteúdo Jump sem aprovação ou vencido.

Formato de erro:

```json
{
  "code": "FONT_UNAVAILABLE",
  "message": "A fonte institucional não está disponível no ambiente de exportação.",
  "retryable": false,
  "details": { "font": "Fonte Institucional" }
}
```

## 6. Retentativas

Configuração inicial sugerida:

```text
tentativa 1: imediata
tentativa 2: após 30 segundos
tentativa 3: após 5 minutos
depois: dead_letter
```

O job deve registrar o erro de cada tentativa. Repetir uma tarefa não pode criar dois artefatos válidos para a mesma chave idempotente.

## 7. Exportação HTML

O HTML do MVP deve ser um pacote `.zip` contendo:

```text
index.html
assets/
  imagens...
fonts/
  fontes permitidas...
styles/
  presentation.css
scripts/
  presentation.js
manifest.json
```

Critérios:

- abrir sem internet;
- não depender de CDN;
- conter imagens localmente;
- conter fontes licenciadas ou fallback documentado;
- permitir navegação entre slides;
- preservar a proporção 16:9;
- informar qualquer recurso não incorporado.

## 8. Exportação PDF

O PDF deve ser criado usando a mesma estrutura de slides usada no HTML.

Validações mínimas:

- uma página por slide;
- proporção 16:9;
- nenhum texto cortado;
- nenhuma imagem ausente;
- fontes carregadas ou fallback registrado;
- número de páginas igual ao número de slides;
- arquivo abre em leitor PDF comum.

## 9. Exportação PPTX

O MVP usará o modelo híbrido:

- títulos e textos principais como texto editável;
- imagens como imagens editáveis;
- indicadores simples como texto e formas;
- layouts complexos ou elementos incompatíveis como imagem;
- notas de origem preservadas quando possível.

O resultado deve:

- abrir sem reparo no PowerPoint;
- ter a quantidade correta de slides;
- manter a proporção 16:9;
- preservar textos principais;
- preservar imagens;
- indicar internamente ou na documentação quais elementos foram achatados.

## 10. Download seguro

Fluxo:

```text
usuário solicita download
        ↓
API verifica organização e permissão
        ↓
API verifica exportação concluída
        ↓
API gera URL assinada com expiração curta
        ↓
usuário baixa o artefato
        ↓
evento de auditoria é registrado
```

O storage não deve ser público. A URL não deve ser permanente nem reutilizável indefinidamente.

## 11. Cancelamento e recuperação

- job `queued` pode ser cancelado diretamente;
- job `running` recebe sinal de cancelamento e deve parar quando possível;
- job interrompido por queda é retomado após expiração do lease;
- job `dead_letter` pode ser reprocessado criando uma nova tentativa controlada;
- exportação antiga não deve ser apagada automaticamente durante o MVP.

## 12. Observabilidade

Registrar por job:

- `jobId`;
- `traceId`;
- tipo;
- versão da apresentação;
- tentativa;
- duração;
- tamanho do artefato;
- resultado;
- código de erro;
- custo estimado de IA, quando aplicável.

Métricas mínimas:

- jobs concluídos e falhos;
- tempo médio e p95 por formato;
- quantidade de retentativas;
- jobs em dead letter;
- tamanho médio dos arquivos;
- taxa de erro por layout.

## 13. Critérios de aceite

- duas solicitações iguais não criam dois resultados finais;
- um worker interrompido não deixa o job preso para sempre;
- erro temporário é retentado;
- erro determinístico é exibido com mensagem clara;
- artefato concluído tem hash e metadados;
- download sem permissão é bloqueado;
- HTML funciona sem internet;
- PDF e PPTX têm a quantidade correta de slides;
- falhas aparecem no histórico da exportação.
