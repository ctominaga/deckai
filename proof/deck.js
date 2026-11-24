(() => {
  "use strict";

  const deck = JSON.parse(document.getElementById("deck-data").textContent);
  const assets = new Map(deck.assets.map((asset) => [asset.id, asset]));
  const appShell = document.querySelector(".app-shell");
  const list = document.getElementById("slide-list");
  const stage = document.getElementById("slide-stage");
  const printDeck = document.getElementById("print-deck");
  const measureStage = document.getElementById("measure-stage");
  const presentation = document.getElementById("presentation");
  const presentationStage = document.getElementById("presentation-stage");
  const editStatus = document.getElementById("edit-status");
  const layoutLabels = {
    cover: "Capa",
    textImage: "Texto com imagem",
    twoColumns: "Duas colunas",
    metrics: "Indicadores",
    case: "Case",
    closing: "Encerramento"
  };
  const slotLabels = {
    title: "título",
    subtitle: "subtítulo",
    body: "texto",
    leftHeading: "título da coluna esquerda",
    leftBody: "texto da coluna esquerda",
    rightHeading: "título da coluna direita",
    rightBody: "texto da coluna direita",
    challenge: "desafio",
    solution: "solução",
    outcome: "resultado",
    metrics: "indicador"
  };
  let selected = 0;
  let focusBeforePresentation = null;
  let closingPresentation = false;
  let fullscreenRequest = Promise.resolve();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function slot(slide, name) {
    return slide.blocks.find((block) => block.slot === name);
  }

  function textNode(block, tag, className, editable, field = "text") {
    const node = el(tag, className, block.value[field]);
    node.dataset.blockId = block.id;
    node.dataset.field = field;
    if (editable) {
      node.contentEditable = "plaintext-only";
      node.spellcheck = true;
      node.setAttribute("aria-label", `Editar ${slotLabels[block.slot] || "texto"}`);
    }
    return node;
  }

  function picture(slide, className) {
    const block = slot(slide, "image");
    const asset = assets.get(block.value.assetId);
    const wrap = el("div", className);
    const img = el("img");
    img.src = asset.dataUri;
    img.alt = block.value.alt;
    img.decoding = "sync";
    wrap.append(img);
    return wrap;
  }

  function renderCover(slide, canvas, editable) {
    const copy = el("div", "cover-copy");
    copy.append(
      textNode(slot(slide, "title"), "h2", "slide-title", editable),
      textNode(slot(slide, "subtitle"), "p", "cover-subtitle", editable)
    );
    canvas.append(copy, picture(slide, "cover-visual"));
  }

  function renderTextImage(slide, canvas, editable) {
    const copy = el("div", "text-image-copy");
    copy.append(
      textNode(slot(slide, "title"), "h2", "slide-title", editable),
      textNode(slot(slide, "body"), "p", "slide-body", editable)
    );
    canvas.append(copy, picture(slide, "text-image-visual"));
  }

  function column(slide, headingSlot, bodySlot, editable) {
    const card = el("div", "column-card");
    card.append(
      textNode(slot(slide, headingSlot), "h3", "", editable),
      textNode(slot(slide, bodySlot), "p", "slide-body", editable)
    );
    return card;
  }

  function renderTwoColumns(slide, canvas, editable) {
    const columns = el("div", "columns-grid");
    columns.append(
      column(slide, "leftHeading", "leftBody", editable),
      column(slide, "rightHeading", "rightBody", editable)
    );
    canvas.append(textNode(slot(slide, "title"), "h2", "slide-title", editable), columns);
  }

  function renderMetrics(slide, canvas, editable) {
    const grid = el("div", "metric-grid");
    const metrics = slide.blocks.filter((item) => item.slot === "metrics");
    grid.style.setProperty("--metric-count", String(metrics.length));
    for (const block of metrics) {
      const card = el("div", "metric-card");
      card.append(
        textNode(block, "div", "metric-value", editable, "value"),
        textNode(block, "div", "metric-label", editable, "label")
      );
      grid.append(card);
    }
    canvas.append(
      textNode(slot(slide, "title"), "h2", "slide-title", editable),
      textNode(slot(slide, "subtitle"), "p", "metrics-subtitle", editable),
      grid
    );
  }

  function caseStep(slide, name, number, label, editable) {
    const step = el("div", "case-step");
    const copy = el("div");
    copy.append(el("div", "case-step-label", label), textNode(slot(slide, name), "p", "slide-body", editable));
    step.append(el("div", "case-step-number", number), copy);
    return step;
  }

  function renderCase(slide, canvas, editable) {
    const grid = el("div", "case-grid");
    const steps = el("div", "case-steps");
    steps.append(
      caseStep(slide, "challenge", "01", "Desafio", editable),
      caseStep(slide, "solution", "02", "Abordagem", editable),
      caseStep(slide, "outcome", "03", "Resultado", editable)
    );
    grid.append(steps, picture(slide, "case-visual"));
    canvas.append(textNode(slot(slide, "title"), "h2", "slide-title", editable), grid);
  }

  function renderClosing(slide, canvas, editable) {
    const copy = el("div", "closing-copy");
    copy.append(
      textNode(slot(slide, "title"), "h2", "slide-title", editable),
      textNode(slot(slide, "body"), "p", "closing-body", editable),
      el("span", "closing-line")
    );
    canvas.append(copy, picture(slide, "closing-visual"));
  }

  const renderers = {
    cover: renderCover,
    textImage: renderTextImage,
    twoColumns: renderTwoColumns,
    metrics: renderMetrics,
    case: renderCase,
    closing: renderClosing
  };

  function renderSlide(slide, index, editable) {
    const canvas = el("article", `slide-canvas layout-${slide.layout}`);
    canvas.setAttribute("aria-label", `Slide ${index + 1}: ${slot(slide, "title").value.text}`);
    renderers[slide.layout](slide, canvas, editable);
    canvas.append(el("span", "provisional-stamp", "Conteúdo provisório · Deck AI"));
    return canvas;
  }

  function slideTitle(slide) {
    return slot(slide, "title").value.text.trim() || "Sem título";
  }

  function sizeThumbnails() {
    for (const viewport of list.querySelectorAll(".thumbnail-viewport")) {
      viewport.style.setProperty("--thumb-scale", String(viewport.getBoundingClientRect().width / 960));
    }
  }

  function thumbnail(slide, index) {
    const button = el("button", "thumb-button");
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `Selecionar slide ${index + 1}: ${slideTitle(slide)}`);
    button.setAttribute("aria-current", index === selected ? "true" : "false");
    const viewport = el("div", "thumbnail-viewport");
    viewport.setAttribute("aria-hidden", "true");
    viewport.append(renderSlide(slide, index, false));
    const title = el("div", "thumbnail-title");
    title.append(el("span", "thumbnail-number", String(index + 1).padStart(2, "0")), el("span", "", slideTitle(slide)));
    button.append(viewport, title);
    button.addEventListener("click", () => selectSlide(index));
    return button;
  }

  function renderThumbnails() {
    list.replaceChildren(...deck.slides.map((slide, index) => thumbnail(slide, index)));
    sizeThumbnails();
  }

  function updateThumbnail(index) {
    const button = list.querySelector(`[data-index="${index}"]`);
    if (!button) return;
    const viewport = button.querySelector(".thumbnail-viewport");
    viewport.replaceChildren(renderSlide(deck.slides[index], index, false));
    button.querySelector(".thumbnail-title > span:last-child").textContent = slideTitle(deck.slides[index]);
    button.setAttribute("aria-label", `Selecionar slide ${index + 1}: ${slideTitle(deck.slides[index])}`);
    sizeThumbnails();
  }

  function renderEditor() {
    const slide = deck.slides[selected];
    stage.replaceChildren(renderSlide(slide, selected, true));
    document.getElementById("slide-number").textContent = String(selected + 1);
    document.getElementById("slide-total").textContent = String(deck.slides.length);
    document.getElementById("slide-position").textContent = `${selected + 1} de ${deck.slides.length}`;
    document.getElementById("layout-label").textContent = layoutLabels[slide.layout];
    document.getElementById("previous").disabled = selected === 0;
    document.getElementById("next").disabled = selected === deck.slides.length - 1;
    for (const button of list.querySelectorAll(".thumb-button")) {
      button.setAttribute("aria-current", Number(button.dataset.index) === selected ? "true" : "false");
    }
  }

  function renderPresentation() {
    presentationStage.replaceChildren(renderSlide(deck.slides[selected], selected, false));
    document.getElementById("presentation-position").textContent = `${selected + 1} / ${deck.slides.length}`;
    document.getElementById("presentation-previous").disabled = selected === 0;
    document.getElementById("presentation-next").disabled = selected === deck.slides.length - 1;
  }

  function renderPrintDeck() {
    printDeck.replaceChildren(...deck.slides.map((slide, index) => {
      const page = el("div", "print-page");
      page.append(renderSlide(slide, index, false));
      return page;
    }));
  }

  function updatePrintSlide(index) {
    const page = printDeck.children[index];
    if (page) page.replaceChildren(renderSlide(deck.slides[index], index, false));
  }

  function selectSlide(index) {
    if (index < 0 || index >= deck.slides.length) return;
    selected = index;
    renderEditor();
    if (!presentation.hidden) renderPresentation();
  }

  function slideHasOverflow(slide, index) {
    const canvas = renderSlide(slide, index, false);
    measureStage.replaceChildren(canvas);
    const bounds = canvas.getBoundingClientRect();
    const blocks = [...canvas.querySelectorAll("[data-block-id]")];
    const rects = blocks.map((block) => block.getBoundingClientRect());
    const outside = blocks.some((block, item) => {
      const rect = rects[item];
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
        rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
    });
    if (outside) return true;
    return rects.some((first, i) => rects.slice(i + 1).some((second) => {
      const horizontal = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const vertical = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      return horizontal > 2 && vertical > 2;
    }));
  }

  function overflowSlides() {
    return deck.slides.flatMap((slide, index) => slideHasOverflow(slide, index) ? [index + 1] : []);
  }

  function safeColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
  }

  function safeFont(value) {
    return typeof value === "string" && /^[a-zA-Z0-9, '\"-]+$/.test(value) ? value : "Arial, sans-serif";
  }

  function applyTheme() {
    const colors = deck.theme.colors || {};
    const type = deck.theme.typography || {};
    const root = document.documentElement.style;
    root.setProperty("--deck-bg", safeColor(colors.background, "#f8f6f2"));
    root.setProperty("--deck-surface", safeColor(colors.surface, "#ffffff"));
    root.setProperty("--deck-ink", safeColor(colors.ink, "#172d38"));
    root.setProperty("--deck-accent", safeColor(colors.accent, "#276f68"));
    root.setProperty("--deck-muted", safeColor(colors.muted, "#63767a"));
    root.setProperty("--deck-heading-font", safeFont(type.headingFontFamily));
    root.setProperty("--deck-body-font", safeFont(type.bodyFontFamily));
  }

  function openPresentation() {
    focusBeforePresentation = document.activeElement;
    presentation.hidden = false;
    appShell.inert = true;
    appShell.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";
    renderPresentation();
    document.getElementById("close-presentation").focus();
    if (document.documentElement.requestFullscreen) {
      fullscreenRequest = document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  async function closePresentation() {
    if (presentation.hidden || closingPresentation) return;
    closingPresentation = true;
    await fullscreenRequest;
    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch (_) { /* fixed overlay still closes */ }
    }
    presentation.hidden = true;
    appShell.inert = false;
    appShell.removeAttribute("aria-hidden");
    document.body.style.overflow = "";
    if (focusBeforePresentation && focusBeforePresentation.focus) focusBeforePresentation.focus();
    closingPresentation = false;
  }

  function safeJson(data) {
    return JSON.stringify(data).replaceAll("&", "\\u0026").replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  }

  function downloadHtml() {
    const overflow = overflowSlides();
    if (overflow.length) {
      editStatus.classList.add("error");
      editStatus.textContent = `Há texto fora da área visível nos slides ${overflow.join(", ")}. Encurte o texto antes de exportar.`;
      editStatus.focus();
      return;
    }
    editStatus.classList.remove("error");
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector("#slide-list").replaceChildren();
    copy.querySelector("#slide-stage").replaceChildren();
    copy.querySelector("#presentation-stage").replaceChildren();
    copy.querySelector("#print-deck").replaceChildren();
    copy.querySelector("#measure-stage").replaceChildren();
    copy.querySelector("#presentation").hidden = true;
    copy.querySelector(".app-shell").removeAttribute("inert");
    copy.querySelector(".app-shell").removeAttribute("aria-hidden");
    copy.querySelector("#deck-data").textContent = safeJson(deck);
    const blob = new Blob(["<!doctype html>\n", copy.outerHTML], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = el("a");
    anchor.href = url;
    anchor.download = "deck-ai-prova-offline.html";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    editStatus.textContent = "HTML autônomo baixado com o conteúdo atual desta aba.";
  }

  stage.addEventListener("input", (event) => {
    const target = event.target.closest("[data-block-id]");
    if (!target || !target.isContentEditable) return;
    const block = deck.slides[selected].blocks.find((item) => item.id === target.dataset.blockId);
    if (!block) return;
    block.value[target.dataset.field] = target.innerText.replace(/\r/g, "");
    updateThumbnail(selected);
    updatePrintSlide(selected);
    if (slideHasOverflow(deck.slides[selected], selected)) {
      editStatus.classList.add("error");
      editStatus.textContent = "O texto editado não cabe na área visível do slide. Encurte-o antes de exportar.";
    } else {
      editStatus.classList.remove("error");
      editStatus.textContent = "Alterações locais nesta aba. Exporte o HTML para guardar esta versão; não há salvamento por API.";
    }
  });

  stage.addEventListener("paste", (event) => {
    const target = event.target.closest("[data-block-id]");
    if (!target || !target.isContentEditable) return;
    event.preventDefault();
    const plainText = event.clipboardData.getData("text/plain");
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(plainText);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });

  stage.addEventListener("focusout", (event) => {
    const target = event.target.closest("[data-block-id]");
    if (!target || !target.isContentEditable) return;
    const block = deck.slides[selected].blocks.find((item) => item.id === target.dataset.blockId);
    if (block) target.replaceChildren(document.createTextNode(block.value[target.dataset.field]));
  });

  list.addEventListener("keydown", (event) => {
    const button = event.target.closest(".thumb-button");
    if (!button) return;
    const current = Number(button.dataset.index);
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(current + 1, deck.slides.length - 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = deck.slides.length - 1;
    else return;
    event.preventDefault();
    selectSlide(next);
    list.querySelector(`[data-index="${next}"]`).focus();
  });

  document.addEventListener("keydown", (event) => {
    if (presentation.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePresentation();
      return;
    }
    if (event.key === "Tab") {
      const controls = [
        document.getElementById("close-presentation"),
        document.getElementById("presentation-previous"),
        document.getElementById("presentation-next")
      ].filter((control) => !control.disabled);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "PageDown" || (event.key === " " && event.target.tagName !== "BUTTON")) {
      event.preventDefault();
      selectSlide(Math.min(selected + 1, deck.slides.length - 1));
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      selectSlide(Math.max(selected - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      selectSlide(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectSlide(deck.slides.length - 1);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !presentation.hidden) closePresentation();
  });

  document.getElementById("deck-title").textContent = deck.title;
  document.getElementById("slide-count").textContent = String(deck.slides.length);
  document.getElementById("previous").addEventListener("click", () => selectSlide(selected - 1));
  document.getElementById("next").addEventListener("click", () => selectSlide(selected + 1));
  document.getElementById("present").addEventListener("click", openPresentation);
  document.getElementById("close-presentation").addEventListener("click", closePresentation);
  document.getElementById("presentation-previous").addEventListener("click", () => selectSlide(selected - 1));
  document.getElementById("presentation-next").addEventListener("click", () => selectSlide(selected + 1));
  document.getElementById("download-html").addEventListener("click", downloadHtml);
  if (window.ResizeObserver) new ResizeObserver(sizeThumbnails).observe(list);
  else window.addEventListener("resize", sizeThumbnails);
  applyTheme();
  renderThumbnails();
  renderEditor();
  renderPrintDeck();
})();
