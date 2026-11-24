# Prova HTML offline — fase 0

Esta prova lê [`../examples/presentation.example.json`](../examples/presentation.example.json) e gera um arquivo HTML autônomo em dois locais: `proof/dist/deck.html`, para uso offline, e `preview-dev3/editor-dev2.html`, para acesso pela prévia do projeto. O JSON é o modelo usado pela prévia, pelas miniaturas, pela apresentação e pela impressão. Os quatro SVGs neutros são incorporados como `data:` URIs. A fixture e o contrato ainda são **provisórios**.

## Gerar e abrir

Na raiz do projeto, com Python 3.9 ou superior, use o launcher disponível neste Windows:

```powershell
py -3 proof/build.py
Invoke-Item .\proof\dist\deck.html
```

Em ambientes onde `python` aponta para uma instalação real, o build também aceita:

```powershell
python proof/build.py
```

O build falha se faltar algum dos seis layouts, se houver IDs repetidos, bloco incompatível com o slot, imagem ausente ou referência de recurso remoto. `proof/dist/deck.html` pode ser copiado sozinho e aberto por `file:` sem servidor. Abra com a rede desconectada para conferir o uso offline.

Para abrir a mesma prova a partir do site local, execute `python -m http.server 5173` na pasta `preview-dev3` e acesse `http://localhost:5173/editor-dev2.html`. O build atualiza os dois arquivos com o mesmo conteúdo; gere novamente após mudar o JSON, o CSS, o JavaScript ou os SVGs. A versão da fixture (`0.1.0-draft`) difere do schema compartilhado (`1.0`), portanto esta página ainda não lê nem salva as apresentações do Dev 3.

## O que experimentar

- Selecione slides pelas miniaturas ou pelas setas sob a prévia. As miniaturas aceitam setas, `Home` e `End` quando têm foco.
- Clique em textos ou indicadores na prévia para editar. A alteração atualiza o modelo em memória e a miniatura correspondente.
- A edição aceita apenas texto simples. Se o texto passar da área visível ou sobrepor outro bloco, a exportação é interrompida e a tela indica os slides que precisam de ajuste.
- Use **Apresentar** para abrir em tela cheia. Navegue com `←`, `→`, `Page Up`, `Page Down`, `Home`, `End` ou espaço; `Esc` fecha.
- Use **Exportar HTML** para baixar um novo arquivo autônomo com as edições locais embutidas.
- A impressão do navegador usa uma página 16:9 por slide como prova de correspondência para a futura exportação PDF.

O teste de navegador é opcional e exige Node.js, Playwright e Chromium instalados:

```powershell
node proof/verify.cjs
```

Ele confere as seis telas, recursos offline, edição local, reabertura do HTML exportado, teclas da apresentação, largura móvel e seis páginas ao imprimir. Não é necessário para gerar `deck.html`.

## Limites da prova

- Não há chamada à API, autenticação, fila, geração por IA, revisão de roteiro, regeneração contextual nem salvamento automático. As edições ficam apenas nesta aba até **Exportar HTML**.
- Não há inclusão, remoção, duplicação, reordenação de slides ou troca de imagens nesta fase.
- Não há exportador PDF ou PPTX implementado. Imprimir pelo navegador é uma prova de layout, não a entrega do Dev 3.
- Os textos, números, SVGs e cores são sintéticos e **não** representam conteúdo ou identidade visual aprovados da Jump.
- As fontes são famílias do sistema (`Arial`/`Helvetica`); a aparência exata pode variar conforme o computador. Nenhum arquivo de fonte externo é necessário.
