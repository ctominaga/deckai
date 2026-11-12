const form = document.querySelector("#briefing-form");
const providerSelect = document.querySelector("#provider");
const modeBadge = document.querySelector("#mode-badge");
const scriptJsonDetails = document.querySelector("#script-json-details");
const scriptJson = document.querySelector("#script-json");
const generateScriptButton = document.querySelector("#generate-script-button");
const approveButton = document.querySelector("#approve-button");
const generatePresentationButton = document.querySelector(
  "#generate-presentation-button",
);
const scriptStatus = document.querySelector("#script-status");
const scriptContent = document.querySelector("#script-content");
const presentationContent = document.querySelector("#presentation-content");
const presentationProviderLabel = document.querySelector("#presentation-provider");
const jsonDetails = document.querySelector("#json-details");
const presentationJson = document.querySelector("#presentation-json");
const statusMessage = document.querySelector("#status-message");
const errorMessage = document.querySelector("#error-message");

let currentScript = null;
let draftScript = null;
let currentPresentation = null;
let currentPresentationRevision = null;
let currentPresentationProvider = null;
let regenerationSession = null;
let currentProvider = "mock";
let scriptEdited = false;
let editingSlides = new Set();
let editingTitle = false;
let operationBusy = false;
let workflowVersion = 0;
let invalidationPromise = Promise.resolve();
let rewriteSession = null;

const providerLabels = { mock: "Mock", gemini: "Gemini", deepseek: "DeepSeek" };
const providerLabel = (provider) => providerLabels[provider] ?? "Provedor desconhecido";
function updateModeBadge() {
  modeBadge.textContent = providerSelect.value === "mock"
    ? "Modo mock · simulação"
    : `${providerLabel(providerSelect.value)} · IA real`;
}

providerSelect.addEventListener("change", updateModeBadge);
updateModeBadge();

function invalidateChangedBriefing() {
  if (operationBusy) return;
  ++workflowVersion;
  if (!currentScript) return;
  const scriptId = currentScript.id;
  resetScriptDisplay();
  clearMessages();
  statusMessage.textContent = "Briefing ou modo alterado. Gere um novo roteiro e aprove novamente.";
  invalidationPromise = requestJson("/api/briefing/invalidate", {
    method: "POST", body: JSON.stringify({ scriptId }),
  }).catch((error) => showError(error instanceof Error ? error.message : "Falha ao invalidar o roteiro anterior."));
}
form.addEventListener("input", invalidateChangedBriefing);
form.addEventListener("change", invalidateChangedBriefing);

const layoutLabels = {
  cover: "Capa",
  text_image: "Texto + imagem",
  two_columns: "Duas colunas",
  metrics: "Indicadores",
  case: "Case",
  closing: "Encerramento",
};

function updateActions() {
  const regenerateButton = document.querySelector("#regenerate-slide-button");
  if (regenerateButton) regenerateButton.disabled = operationBusy || draftScript !== null || !currentPresentation || !currentPresentationRevision || currentScript?.status !== "approved";
  for (const control of form.elements) control.disabled = operationBusy;
  for (const control of scriptContent.querySelectorAll('[data-edit-field], [data-ai-target]')) control.disabled = operationBusy;
  approveButton.disabled = operationBusy || draftScript !== null || currentScript?.status !== "draft";
  generatePresentationButton.disabled = operationBusy || draftScript !== null || currentScript?.status !== "approved" || currentPresentation !== null;
  const saveButton = scriptContent.querySelector('[data-script-action="save"]');
  if (saveButton) saveButton.disabled = operationBusy || !hasScriptChanges();
  for (const button of scriptContent.querySelectorAll('[data-script-action="edit-title"], [data-script-action="edit-slide"], [data-script-action="add-topic"], [data-script-action="remove-topic"], [data-script-action="cancel"]')) {
    button.disabled = operationBusy;
  }
  document.dispatchEvent(new CustomEvent("deckai:workflow", { detail: {
    script: currentScript, draft: draftScript, presentation: currentPresentation,
    busy: operationBusy, dirty: hasScriptChanges(),
  } }));
}

function setBusy(button, busy, busyLabel) {
  operationBusy = busy;
  if (busy) {
    button.dataset.originalLabel = button.firstElementChild.textContent;
    button.firstElementChild.textContent = busyLabel;
    button.setAttribute("aria-busy", "true");
    updateActions();
    return;
  }

  button.firstElementChild.textContent =
    button.dataset.originalLabel ?? button.firstElementChild.textContent;
  button.removeAttribute("aria-busy");
  updateActions();
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  statusMessage.textContent = "";
}

function clearMessages() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
  statusMessage.textContent = "";
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Não foi possível concluir a operação.");
  }
  return body;
}

function addText(parent, tagName, className, value) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function hasScriptChanges() {
  if (!draftScript || !currentScript) return false;
  return draftScript.title !== currentScript.title ||
    JSON.stringify(draftScript.plannedSlides) !== JSON.stringify(currentScript.plannedSlides);
}

function makeEditorField(parent, labelText, value, field, slideIndex, topicIndex) {
  const label = document.createElement("label");
  label.className = "editor-field";
  label.append(document.createTextNode(labelText));
  const isLongText = field === "objective" || field === "keyPoint";
  const input = document.createElement(isLongText ? "textarea" : "input");
  input.value = value;
  input.required = true;
  input.dataset.editField = field;
  if (slideIndex !== undefined) input.dataset.slideIndex = String(slideIndex);
  if (topicIndex !== undefined) input.dataset.topicIndex = String(topicIndex);
  label.append(input);
  parent.append(label);
  addRewriteButton(parent, field, slideIndex, topicIndex, labelText);
}

function addRewriteButton(parent, field, slideIndex, topicIndex, label) {
  const target = field === "scriptTitle" ? { field } : {
    field, slideId: currentScript.plannedSlides[slideIndex].id,
    ...(field === "keyPoint" ? { topicIndex } : {}),
  };
  const button = addText(parent, "button", "small-button ai-edit-button", "Editar com IA");
  button.type = "button";
  button.dataset.aiTarget = JSON.stringify(target);
  button.setAttribute("aria-label", `Editar com IA: ${label}`);
}

const rewriteDialog = document.createElement("dialog");
rewriteDialog.id = "rewrite-dialog";
rewriteDialog.className = "rewrite-dialog";
rewriteDialog.setAttribute("aria-labelledby", "rewrite-heading");
document.body.append(rewriteDialog);

function closeRewrite() {
  if (!rewriteSession) return;
  const previous = rewriteSession;
  rewriteSession = null;
  previous.controller?.abort();
  rewriteDialog.close();
  if (previous.suggestion) {
    void requestJson(`/api/scripts/${encodeURIComponent(previous.scriptId)}/rewrite-discard`, {
      method: "POST", body: JSON.stringify({ suggestionId: previous.suggestion.suggestionId }),
    }).catch(() => {});
  }
}
rewriteDialog.addEventListener("cancel", event => {
  event.preventDefault();
  if (!operationBusy) closeRewrite();
});

scriptContent.addEventListener("click", event => {
  const button = event.target.closest("[data-ai-target]");
  if (!button || operationBusy || !currentScript) return;
  if (draftScript !== null) {
    showError("Seu rascunho foi preservado. Salve as alterações manuais ou cancele a edição antes de solicitar uma sugestão de IA.");
    return;
  }
  closeRewrite();
  clearMessages();
  const target = JSON.parse(button.dataset.aiTarget);
  const slide = currentScript.plannedSlides.find(s => s.id === target.slideId);
  const original = target.field === "scriptTitle" ? currentScript.title
    : target.field === "keyPoint" ? slide.keyPoints[target.topicIndex] : slide[target.field];
  const session = { target, original, scriptId: currentScript.id, revision: currentScript.revision, suggestion: null, controller: null };
  rewriteSession = session;
  rewriteDialog.replaceChildren();
  addText(rewriteDialog, "h3", "", button.getAttribute("aria-label")).id = "rewrite-heading";
  addText(rewriteDialog, "p", "rewrite-help", `Sugestão com ${currentProvider === "mock" ? "Mock · simulação" : "DeepSeek"}. O roteiro só muda ao aceitar. Conteúdo demonstrativo deve permanecer fictício.`);
  const operationLabel = addText(rewriteDialog, "label", "editor-field", "Operação");
  const operation = document.createElement("select");
  operation.id = "rewrite-operation";
  for (const [value, label] of [["summarize", "Resumir"], ["expand", "Expandir"], ["tone", "Mudar o tom"], ["custom", "Instrução personalizada"]]) {
    const option = addText(operation, "option", "", label); option.value = value;
  }
  operationLabel.append(operation);
  const toneLabel = addText(rewriteDialog, "label", "editor-field", "Tom desejado");
  const tone = document.createElement("input"); tone.id = "rewrite-tone"; tone.maxLength = 100; toneLabel.append(tone); toneLabel.hidden = true;
  const instructionLabel = addText(rewriteDialog, "label", "editor-field", "Instrução personalizada (opcional)");
  const instruction = document.createElement("textarea"); instruction.id = "rewrite-instruction"; instruction.maxLength = 1000; instructionLabel.append(instruction);
  const comparison = document.createElement("div"); comparison.className = "rewrite-comparison";
  const before = document.createElement("section"); addText(before, "h4", "", "Texto original"); addText(before, "p", "rewrite-text", original).id = "rewrite-original";
  const after = document.createElement("section"); addText(after, "h4", "", "Texto sugerido");
  const suggested = addText(after, "p", "rewrite-text", "Solicite uma sugestão para comparar."); suggested.id = "rewrite-suggestion";
  comparison.append(before, after); rewriteDialog.append(comparison);
  const feedback = addText(rewriteDialog, "p", "rewrite-feedback", ""); feedback.id = "rewrite-feedback"; feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "edit-actions";
  const generate = addText(actions, "button", "small-button is-primary", "Solicitar sugestão"); generate.type = "button"; generate.id = "rewrite-generate";
  const accept = addText(actions, "button", "small-button is-primary", "Aceitar sugestão"); accept.type = "button"; accept.id = "rewrite-accept"; accept.disabled = true;
  const discard = addText(actions, "button", "small-button", "Descartar"); discard.type = "button"; discard.id = "rewrite-discard";
  rewriteDialog.append(actions);
  const clearSuggestion = () => {
    // Changing the requested operation invalidates the visible suggestion.
    if (session.suggestion) {
      void requestJson(`/api/scripts/${encodeURIComponent(session.scriptId)}/rewrite-discard`, {
        method: "POST", body: JSON.stringify({ suggestionId: session.suggestion.suggestionId }),
      }).catch(() => {});
    }
    session.suggestion = null; accept.disabled = true;
    suggested.textContent = "Solicite uma sugestão para comparar.";
  };
  operation.addEventListener("change", () => {
    toneLabel.hidden = operation.value !== "tone";
    instructionLabel.firstChild.textContent = operation.value === "custom" ? "Instrução personalizada (obrigatória)" : "Instrução personalizada (opcional)";
    clearSuggestion();
  });
  instruction.addEventListener("input", clearSuggestion);
  tone.addEventListener("input", clearSuggestion);
  discard.addEventListener("click", () => { if (!operationBusy) closeRewrite(); });
  generate.addEventListener("click", async () => {
    if (rewriteSession !== session || generate.disabled) return;
    if ((operation.value === "custom" && !instruction.value.trim()) || (operation.value === "tone" && !tone.value.trim())) {
      feedback.textContent = operation.value === "tone" ? "Informe o tom desejado." : "Informe a instrução personalizada.";
      return;
    }
    clearSuggestion();
    session.controller = new AbortController();
    const timeout = setTimeout(() => session.controller.abort(), 70_000);
    generate.disabled = true; accept.disabled = true;
    operation.disabled = instruction.disabled = tone.disabled = true;
    generate.setAttribute("aria-busy", "true");
    feedback.textContent = "Solicitando sugestão. O roteiro permanece salvo sem alterações.";
    try {
      const result = await requestJson(`/api/scripts/${encodeURIComponent(session.scriptId)}/rewrite`, {
        method: "POST", signal: session.controller.signal,
        body: JSON.stringify({ revision: session.revision, target, operation: operation.value, instruction: instruction.value, tone: tone.value }),
      });
      if (rewriteSession !== session || draftScript !== null || currentScript?.id !== session.scriptId || currentScript.revision !== session.revision) return;
      if (result.original !== original || result.revision !== session.revision) throw new Error("A sugestão ficou desatualizada. Solicite outra sugestão.");
      session.suggestion = result;
      suggested.textContent = result.text;
      accept.disabled = false;
      feedback.textContent = "Revise a sugestão e escolha aceitar ou descartar.";
    } catch (error) {
      if (rewriteSession === session) feedback.textContent = error.name === "AbortError" ? "A solicitação excedeu o tempo limite. Tente novamente." : error.message;
    } finally {
      clearTimeout(timeout);
      if (rewriteSession === session) {
        generate.disabled = false;
        operation.disabled = instruction.disabled = tone.disabled = false;
        generate.removeAttribute("aria-busy");
      }
    }
  });
  accept.addEventListener("click", async () => {
    if (rewriteSession !== session || !session.suggestion || operationBusy || draftScript !== null) return;
    if (currentScript?.id !== session.scriptId || currentScript.revision !== session.revision) { closeRewrite(); showError("A revisão mudou. Solicite outra sugestão."); return; }
    operationBusy = true;
    accept.disabled = generate.disabled = discard.disabled = true;
    operation.disabled = instruction.disabled = tone.disabled = true;
    updateActions();
    feedback.textContent = "Validando e salvando o campo selecionado…";
    try {
      const result = await requestJson(`/api/scripts/${encodeURIComponent(session.scriptId)}/rewrite-accept`, {
        method: "POST", body: JSON.stringify({ suggestionId: session.suggestion.suggestionId }),
      });
      session.suggestion = null;
      currentPresentation = null;
      presentationContent.className = "empty-state compact-empty";
      presentationContent.replaceChildren();
      addText(presentationContent, "p", "", "Aprove a nova revisão para gerar a apresentação.");
      presentationProviderLabel.textContent = "Slides ainda não gerados";
      jsonDetails.hidden = true; presentationJson.textContent = "";
      currentProvider = result.provider;
      renderScript(result.script, result.scriptEdited);
      statusMessage.textContent = "Sugestão aceita somente no campo selecionado. Aprove a nova revisão antes de gerar os slides.";
    } catch (error) {
      feedback.textContent = error.message;
      // A conflict cannot be retried with this token; keep the saved local view intact.
      accept.disabled = true;
      generate.disabled = discard.disabled = false;
      operation.disabled = instruction.disabled = tone.disabled = false;
    } finally { operationBusy = false; updateActions(); }
  });
  rewriteDialog.showModal();
  operation.focus();
});

function renderScript(script, manuallyEdited = scriptEdited) {
  closeRegeneration();
  closeRewrite();
  currentScript = script;
  scriptEdited = manuallyEdited;
  scriptContent.className = "script-result";
  scriptJsonDetails.hidden = false;
  scriptJson.textContent = JSON.stringify(script, null, 2);
  scriptContent.replaceChildren();
  scriptStatus.textContent =
    script.status === "approved" ? "Aprovado" : "Rascunho";
  scriptStatus.className =
    script.status === "approved"
      ? "state-badge is-approved"
      : "state-badge is-draft";

  const titleRow = document.createElement("div");
  titleRow.className = "script-title-row";
  if (draftScript && editingTitle) {
    makeEditorField(titleRow, "Título geral", draftScript.title, "scriptTitle");
  } else {
    addText(titleRow, "h3", "script-title", draftScript?.title ?? script.title);
    const editTitleButton = addText(titleRow, "button", "small-button", "Editar título");
    editTitleButton.type = "button";
    editTitleButton.dataset.scriptAction = "edit-title";
    addRewriteButton(titleRow, "scriptTitle", undefined, undefined, "Título geral");
  }
  scriptContent.append(titleRow);
  const originLabel = providerLabel(currentProvider);
  const editedLabel = scriptEdited ? " — editado" : "";
  addText(scriptContent, "p", "script-summary", `${script.plannedSlides.length} slides · Gerado com ${originLabel}${editedLabel} · Revisão ${script.revision}`);
  if (draftScript) {
    const editActions = document.createElement("div");
    editActions.className = "edit-actions";
    const saveButton = addText(editActions, "button", "small-button is-primary", "Salvar alterações");
    saveButton.type = "button";
    saveButton.dataset.scriptAction = "save";
    const cancelButton = addText(editActions, "button", "small-button", "Cancelar");
    cancelButton.type = "button";
    cancelButton.dataset.scriptAction = "cancel";
    scriptContent.append(editActions);
  }
  const list = document.createElement("ol");
  list.className = "slide-list";

  script.plannedSlides.forEach((slide, index) => {
    const displayedSlide = draftScript?.plannedSlides[index] ?? slide;
    const item = document.createElement("li");
    item.className = "planned-slide";
    const heading = document.createElement("div");
    heading.className = "planned-head";
    addText(heading, "span", "planned-number", String(index + 1).padStart(2, "0"));
    addText(heading, "span", "planned-title", displayedSlide.title);
    if (!draftScript || !editingSlides.has(index)) addRewriteButton(heading, "title", index, undefined, "Título do slide");
    addText(
      heading,
      "span",
      "layout-tag",
      layoutLabels[displayedSlide.layout] ?? displayedSlide.layout,
    );
    if (!draftScript || !editingSlides.has(index)) {
      const editSlideButton = addText(heading, "button", "small-button", "Editar");
      editSlideButton.type = "button";
      editSlideButton.dataset.scriptAction = "edit-slide";
      editSlideButton.dataset.slideIndex = String(index);
    }
    item.append(heading);
    if (draftScript && editingSlides.has(index)) {
      const editor = document.createElement("div");
      editor.className = "slide-editor";
      makeEditorField(editor, "Título do slide", displayedSlide.title, "title", index);
      makeEditorField(editor, "Objetivo", displayedSlide.objective, "objective", index);
      const layoutLabel = document.createElement("label");
      layoutLabel.className = "editor-field";
      layoutLabel.append(document.createTextNode("Layout"));
      const layoutSelect = document.createElement("select");
      layoutSelect.dataset.editField = "layout";
      layoutSelect.dataset.slideIndex = String(index);
      for (const layout of Object.keys(layoutLabels)) {
        const option = document.createElement("option");
        option.value = layout;
        option.textContent = layoutLabels[layout];
        option.selected = layout === displayedSlide.layout;
        layoutSelect.append(option);
      }
      layoutLabel.append(layoutSelect);
      editor.append(layoutLabel);
      displayedSlide.keyPoints.forEach((point, topicIndex) => {
        const topicRow = document.createElement("div");
        topicRow.className = "topic-editor-row";
        makeEditorField(topicRow, `Tópico ${topicIndex + 1}`, point, "keyPoint", index, topicIndex);
        const removeButton = addText(topicRow, "button", "small-button", "Remover");
        removeButton.type = "button";
        removeButton.dataset.scriptAction = "remove-topic";
        removeButton.dataset.slideIndex = String(index);
        removeButton.dataset.topicIndex = String(topicIndex);
        removeButton.disabled = displayedSlide.keyPoints.length <= 1;
        editor.append(topicRow);
      });
      const addTopicButton = addText(editor, "button", "small-button", "Adicionar tópico");
      addTopicButton.type = "button";
      addTopicButton.dataset.scriptAction = "add-topic";
      addTopicButton.dataset.slideIndex = String(index);
      item.append(editor);
    } else {
      addText(item, "p", "planned-objective", displayedSlide.objective);
      addRewriteButton(item, "objective", index, undefined, "Objetivo");
      const points = document.createElement("ul");
      points.className = "planned-points";
      displayedSlide.keyPoints.forEach((point, topicIndex) => {
        const row = addText(points, "li", "", point);
        addRewriteButton(row, "keyPoint", index, topicIndex, `Tópico ${topicIndex + 1}`);
      });
      item.append(points);
    }
    list.append(item);
  });

  scriptContent.append(list);
  updateActions();
}

function startScriptEditing() {
  closeRewrite();
  if (!draftScript && currentScript) {
    draftScript = JSON.parse(JSON.stringify(currentScript));
  }
}

function updateDraftField(field) {
  closeRewrite();
  if (!draftScript) return;
  const slideIndex = Number(field.dataset.slideIndex);
  if (field.dataset.editField === "scriptTitle") {
    draftScript.title = field.value;
  } else if (Number.isInteger(slideIndex) && draftScript.plannedSlides[slideIndex]) {
    const slide = draftScript.plannedSlides[slideIndex];
    if (field.dataset.editField === "keyPoint") {
      slide.keyPoints[Number(field.dataset.topicIndex)] = field.value;
    } else {
      slide[field.dataset.editField] = field.value;
    }
  }
  updateActions();
}

scriptContent.addEventListener("input", (event) => {
  const field = event.target.closest("[data-edit-field]");
  if (field) updateDraftField(field);
});
scriptContent.addEventListener("change", (event) => {
  const field = event.target.closest("[data-edit-field]");
  if (field) updateDraftField(field);
});

scriptContent.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-script-action]");
  if (!button || operationBusy) return;
  const action = button.dataset.scriptAction;
  const slideIndex = Number(button.dataset.slideIndex);

  if (action === "edit-title") {
    startScriptEditing();
    editingTitle = true;
    renderScript(currentScript);
    scriptContent.querySelector('[data-edit-field="scriptTitle"]')?.focus();
    return;
  }
  if (action === "edit-slide") {
    startScriptEditing();
    editingSlides.add(slideIndex);
    renderScript(currentScript);
    scriptContent.querySelector(`[data-edit-field="title"][data-slide-index="${slideIndex}"]`)?.focus();
    return;
  }
  if (action === "add-topic" && draftScript?.plannedSlides[slideIndex]) {
    draftScript.plannedSlides[slideIndex].keyPoints.push("");
    renderScript(currentScript);
    const topicIndex = draftScript.plannedSlides[slideIndex].keyPoints.length - 1;
    const newTopic = scriptContent.querySelector(`[data-slide-index="${slideIndex}"][data-topic-index="${topicIndex}"]`);
    newTopic?.focus();
    return;
  }
  if (action === "remove-topic" && draftScript?.plannedSlides[slideIndex]) {
    const slide = draftScript.plannedSlides[slideIndex];
    if (slide.keyPoints.length > 1) {
      slide.keyPoints.splice(Number(button.dataset.topicIndex), 1);
      renderScript(currentScript);
    }
    return;
  }
  if (action === "cancel") {
    draftScript = null;
    editingSlides = new Set();
    editingTitle = false;
    clearMessages();
    renderScript(currentScript);
    return;
  }
  if (action !== "save" || !draftScript || !currentScript) return;

  const fields = [...scriptContent.querySelectorAll("[data-edit-field]")];
  let valid = true;
  for (const field of fields) {
    field.setCustomValidity(field.required && !field.value.trim() ? "Este campo é obrigatório." : "");
    if (!field.checkValidity()) valid = false;
  }
  if (!valid) {
    const invalidField = fields.find((field) => !field.checkValidity());
    document.dispatchEvent(new CustomEvent("deckai:invalid-field", { detail: invalidField?.dataset.slideIndex }));
    invalidField?.reportValidity();
    return;
  }

  const saveButton = button;
  operationBusy = true;
  saveButton.textContent = "Salvando…";
  clearMessages();
  statusMessage.textContent = "Validando e salvando a nova revisão do roteiro.";
  updateActions();
  try {
    const result = await requestJson(
      `/api/scripts/${encodeURIComponent(currentScript.id)}/edit`,
      {
        method: "POST",
        body: JSON.stringify({
          revision: currentScript.revision,
          title: draftScript.title,
          plannedSlides: draftScript.plannedSlides,
        }),
      },
    );
    currentProvider = result.provider;
    draftScript = null;
    editingSlides = new Set();
    editingTitle = false;
    currentPresentation = null;
    presentationContent.className = "empty-state compact-empty";
    presentationContent.replaceChildren();
    addText(presentationContent, "div", "empty-icon", "▤");
    addText(presentationContent, "p", "", "A apresentação ainda não foi gerada.");
    addText(presentationContent, "span", "", "Aprove a nova revisão para liberar a geração.");
    presentationProviderLabel.textContent = "Slides ainda não gerados";
    renderScript(result.script, result.scriptEdited);
    statusMessage.textContent = "Alterações salvas como nova revisão. Aprove o roteiro novamente antes de gerar os slides.";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
  } finally {
    operationBusy = false;
    updateActions();
  }
});

function renderSlideBlock(parent, slide, key, heading, value) {
  const block = document.createElement("section");
  block.className = "slide-block";
  // Stable paths identify blocks without adding fields to the JSON contract.
  block.dataset.blockId = `${slide.id}/${key}`;
  if (heading) addText(block, "h4", "", heading);
  addText(block, "p", "", value);
  parent.append(block);
}

function renderSlideContent(content, slide) {
  switch (slide.layout) {
    case "cover":
      renderSlideBlock(content, slide, "subtitle", "", slide.subtitle);
      break;
    case "text_image":
      renderSlideBlock(content, slide, "body", "", slide.body);
      break;
    case "two_columns": {
      const columns = document.createElement("div");
      columns.className = "slide-columns";
      renderSlideBlock(columns, slide, "left", slide.left.heading, slide.left.body);
      renderSlideBlock(columns, slide, "right", slide.right.heading, slide.right.body);
      content.append(columns);
      break;
    }
    case "metrics":
      slide.metrics.forEach((metric, index) => {
        renderSlideBlock(content, slide, `metrics/${index}`, `${metric.label}: ${metric.value}`, metric.context);
      });
      break;
    case "case":
      renderSlideBlock(content, slide, "organization", "Organização fictícia", slide.organization);
      renderSlideBlock(content, slide, "challenge", "Desafio", slide.challenge);
      renderSlideBlock(content, slide, "approach", "Abordagem", slide.approach);
      renderSlideBlock(content, slide, "result", "Resultado demonstrativo", slide.result);
      break;
    case "closing":
      renderSlideBlock(content, slide, "message", "", slide.message);
      renderSlideBlock(content, slide, "callToAction", "Chamada para ação", slide.callToAction);
      break;
  }
}

function renderPresentation(presentation, provider, manuallyEdited = scriptEdited, revision = 1) {
  closeRegeneration();
  currentPresentation = presentation;
  currentPresentationRevision = revision;
  currentPresentationProvider = provider;
  presentationContent.className = "presentation-result";
  presentationContent.replaceChildren();
  jsonDetails.hidden = false;
  presentationJson.textContent = JSON.stringify(presentation, null, 2);
  presentationProviderLabel.textContent = `Slides gerados com ${providerLabel(provider)}${manuallyEdited ? " · roteiro editado" : ""} · Revisão ${revision}`;

  addText(presentationContent, "h3", "presentation-title", presentation.title);
  addText(presentationContent, "p", "demonstration-label", "Demonstração fictícia. Números, organizações e cases não representam fatos ou resultados reais da Jump.");
  const grid = document.createElement("div");
  grid.className = "presentation-grid";

  presentation.slides.forEach((slide, index) => {
    const card = document.createElement("article");
    card.className = "slide-card";
    card.dataset.slideId = slide.id;
    const visual = document.createElement("div");
    visual.className = "slide-visual";
    addText(
      visual,
      "span",
      "layout-tag",
      layoutLabels[slide.layout] ?? slide.layout,
    );
    if (slide.imageId) {
      addText(visual, "span", "visual-placeholder", "▧ Imagem a definir");
    }
    if (slide.dataClassification === "DEMONSTRATION") {
      addText(visual, "span", "demonstration-label", "DEMONSTRAÇÃO FICTÍCIA");
    }
    const content = document.createElement("div");
    content.className = "slide-card-content";
    addText(content, "h3", "", `${String(index + 1).padStart(2, "0")} · ${slide.title}`);
    renderSlideContent(content, slide);
    card.append(visual, content);
    grid.append(card);
  });

  presentationContent.append(grid);
  updateActions();
}

function resetScriptDisplay() {
  closeRegeneration();
  currentPresentationRevision = null;
  closeRewrite();
  currentScript = null;
  draftScript = null;
  currentPresentation = null;
  scriptEdited = false;
  editingSlides = new Set();
  editingTitle = false;
  presentationProviderLabel.textContent = "Slides ainda não gerados";
  scriptStatus.textContent = "Aguardando briefing";
  scriptStatus.className = "state-badge";
  scriptContent.className = "empty-state";
  scriptContent.replaceChildren();
  addText(scriptContent, "div", "empty-icon", "✳");
  addText(scriptContent, "p", "", "Seu roteiro aparecerá aqui.");
  addText(
    scriptContent,
    "span",
    "",
    "Preencha o briefing e gere uma proposta para começar.",
  );
  presentationContent.className = "empty-state compact-empty";
  presentationContent.replaceChildren();
  addText(presentationContent, "div", "empty-icon", "▤");
  addText(presentationContent, "p", "", "A apresentação ainda não foi gerada.");
  addText(
    presentationContent,
    "span",
    "",
    "Aprove o roteiro para liberar a geração.",
  );
  approveButton.disabled = true;
  generatePresentationButton.disabled = true;
  jsonDetails.hidden = true;
  presentationJson.textContent = "";
  scriptJsonDetails.hidden = true;
  scriptJson.textContent = "";
  updateActions();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (operationBusy) return;
  ++workflowVersion;
  const formData = new FormData(form);
  const provider = formData.get("provider");
  clearMessages();
  resetScriptDisplay();
  setBusy(generateScriptButton, true, "Gerando roteiro…");
  statusMessage.textContent = provider !== "mock"
    ? `Enviando briefing ao ${providerLabel(provider)} e validando o roteiro. Aguarde…`
    : "Validando briefing e criando proposta simulada.";

  const briefing = {
    provider,
    prompt: formData.get("prompt"),
    objective: formData.get("objective"),
    audience: formData.get("audience"),
    tone: formData.get("tone"),
    language: formData.get("language"),
    slideCount: Number(formData.get("slideCount")),
  };

  try {
    await invalidationPromise;
    const result = await requestJson("/api/scripts", {
      method: "POST",
      body: JSON.stringify(briefing),
    });
    currentProvider = result.provider;
    renderScript(result.script, result.scriptEdited);
    statusMessage.textContent =
      `Roteiro ${currentProvider === "mock" ? "simulado" : `do ${providerLabel(currentProvider)}`} pronto e validado com Zod. Revise antes de aprovar.`;
  } catch (error) {
    showError(error instanceof Error ? error.message : "Erro ao gerar roteiro.");
  } finally {
    setBusy(generateScriptButton, false, "");
  }
});

approveButton.addEventListener("click", async () => {
  if (operationBusy || !currentScript || draftScript !== null) return;
  clearMessages();
  setBusy(approveButton, true, "Aprovando…");
  try {
    const result = await requestJson(
      `/api/scripts/${encodeURIComponent(currentScript.id)}/approve`,
      { method: "POST", body: JSON.stringify({ revision: currentScript.revision }) },
    );
    currentProvider = result.provider;
    renderScript(result.script, result.scriptEdited);
    statusMessage.textContent =
      "Roteiro aprovado. Clique em Gerar apresentação para desenvolver os slides.";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Erro ao aprovar roteiro.");
  } finally {
    setBusy(approveButton, false, "");
    approveButton.firstElementChild.textContent = "Aprovar roteiro";
    approveButton.disabled = currentScript?.status !== "draft";
    approveButton.removeAttribute("aria-busy");
  }
});

generatePresentationButton.addEventListener("click", async () => {
  if (operationBusy || draftScript !== null || !currentScript || currentScript.status !== "approved") return;
  clearMessages();
  setBusy(generatePresentationButton, true, "Gerando apresentação…");
  statusMessage.textContent = currentProvider !== "mock"
    ? `${providerLabel(currentProvider)} está desenvolvendo os slides do roteiro aprovado. Aguarde…`
    : "Gerando slides simulados com Mock…";
  try {
    const result = await requestJson(
      `/api/scripts/${encodeURIComponent(currentScript.id)}/presentation`,
      { method: "POST", body: JSON.stringify({ revision: currentScript.revision }) },
    );
    renderPresentation(result.presentation, result.provider, result.scriptEdited, result.presentationRevision);
    statusMessage.textContent =
      `Slides gerados com ${providerLabel(result.provider)} e validados com Zod e com o roteiro aprovado.`;
  } catch (error) {
    showError(
      error instanceof Error ? error.message : "Erro ao gerar apresentação.",
    );
  } finally {
    setBusy(generatePresentationButton, false, "");
    generatePresentationButton.firstElementChild.textContent =
      "Gerar apresentação";
    generatePresentationButton.disabled =
      draftScript !== null || currentScript?.status !== "approved" || currentPresentation !== null;
    generatePresentationButton.removeAttribute("aria-busy");
  }
});

const regenerationDialog = document.createElement("dialog");
regenerationDialog.id = "regeneration-dialog";
regenerationDialog.className = "rewrite-dialog regeneration-dialog";
regenerationDialog.setAttribute("aria-labelledby", "regeneration-heading");
document.body.append(regenerationDialog);
const regenerateSlideButton = addText(document.querySelector(".presentation-panel .panel-heading"), "button", "small-button", "Regenerar slide");
regenerateSlideButton.id = "regenerate-slide-button";
regenerateSlideButton.type = "button";
regenerateSlideButton.disabled = true;

function discardRegenerationRequest(session) {
  if (!session.requestId) return;
  void requestJson(`/api/presentations/${encodeURIComponent(session.presentation.id)}/regeneration-discard`, {
    method: "POST", body: JSON.stringify({ requestId: session.requestId }),
  }).catch(() => {});
}
function closeRegeneration() {
  if (!regenerationSession) return;
  const session = regenerationSession;
  regenerationSession = null;
  session.controller?.abort();
  discardRegenerationRequest(session);
  regenerationDialog.close();
}
regenerationDialog.addEventListener("cancel", event => {
  event.preventDefault();
  if (!operationBusy) closeRegeneration();
});

regenerateSlideButton.addEventListener("click", () => {
  if (regenerateSlideButton.disabled || !currentPresentation || !currentPresentationRevision) return;
  const selectedId = presentationContent.querySelector(".slide-card:not([hidden])")?.dataset.slideId;
  const index = Math.max(0, currentPresentation.slides.findIndex(slide => slide.id === selectedId));
  const original = currentPresentation.slides[index];
  const session = { presentation: currentPresentation, revision: currentPresentationRevision, requestId: null, suggestion: null, controller: null };
  regenerationSession = session;
  regenerationDialog.replaceChildren();
  addText(regenerationDialog, "h3", "", `Regenerar slide ${index + 1} · ${original.title}`).id = "regeneration-heading";
  addText(regenerationDialog, "p", "rewrite-help", "Compare a nova versão antes de aceitar. Título, layout, referências e roteiro aprovado serão preservados. Conteúdo de demonstração permanece fictício.");
  const providerField = addText(regenerationDialog, "label", "editor-field", "Provedor da regeneração");
  const provider = document.createElement("select"); provider.id = "regeneration-provider";
  for (const [value, label] of [["deepseek", "DeepSeek"], ["mock", "Mock · simulação"], ["gemini", "Gemini · regeneração individual indisponível"]]) {
    const option = addText(provider, "option", "", label); option.value = value; option.disabled = value === "gemini";
  }
  provider.value = currentProvider === "mock" ? "mock" : "deepseek";
  providerField.append(provider);
  const instructionField = addText(regenerationDialog, "label", "editor-field", "Instrução (opcional)");
  const instruction = document.createElement("textarea"); instruction.id = "regeneration-instruction"; instruction.maxLength = 1000; instructionField.append(instruction);
  const comparison = document.createElement("div"); comparison.className = "rewrite-comparison regeneration-comparison";
  const before = document.createElement("section"); before.id = "regeneration-original";
  const after = document.createElement("section"); after.id = "regeneration-suggestion";
  const preview = (container, heading, slide) => {
    container.replaceChildren();
    addText(container, "h4", "", heading);
    addText(container, "p", "demonstration-label", `${layoutLabels[slide.layout]} · Demonstração fictícia`);
    addText(container, "h3", "", slide.title);
    renderSlideContent(container, slide);
  };
  preview(before, "Slide original", original);
  addText(after, "h4", "", "Slide regenerado");
  addText(after, "p", "", "Solicite uma nova versão para comparar.");
  comparison.append(before, after); regenerationDialog.append(comparison);
  const feedback = addText(regenerationDialog, "p", "rewrite-feedback", ""); feedback.id = "regeneration-feedback"; feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "edit-actions";
  const generate = addText(actions, "button", "small-button is-primary", "Solicitar nova versão"); generate.id = "regeneration-generate";
  const accept = addText(actions, "button", "small-button is-primary", "Aceitar nova versão"); accept.id = "regeneration-accept"; accept.disabled = true;
  const discard = addText(actions, "button", "small-button", "Descartar"); discard.id = "regeneration-discard";
  for (const button of [generate, accept, discard]) button.type = "button";
  regenerationDialog.append(actions);
  const clearSuggestion = () => {
    discardRegenerationRequest(session);
    session.requestId = null; session.suggestion = null; accept.disabled = true;
    after.replaceChildren(); addText(after, "h4", "", "Slide regenerado"); addText(after, "p", "", "Solicite uma nova versão para comparar.");
  };
  instruction.addEventListener("input", clearSuggestion);
  provider.addEventListener("change", clearSuggestion);
  discard.addEventListener("click", () => { if (!operationBusy) closeRegeneration(); });
  generate.addEventListener("click", async () => {
    if (regenerationSession !== session || generate.disabled) return;
    clearSuggestion();
    session.requestId = crypto.randomUUID();
    const requestId = session.requestId;
    session.controller = new AbortController();
    const timeout = setTimeout(() => session.controller.abort(), 70_000);
    generate.disabled = instruction.disabled = provider.disabled = true;
    generate.setAttribute("aria-busy", "true");
    feedback.textContent = `Regenerando somente este slide com ${providerLabel(provider.value)}. A apresentação permanece sem alterações.`;
    try {
      const result = await requestJson(`/api/presentations/${encodeURIComponent(session.presentation.id)}/regenerate-slide`, {
        method: "POST", signal: session.controller.signal,
        body: JSON.stringify({ requestId, revision: session.revision, slideId: original.id, instruction: instruction.value, provider: provider.value }),
      });
      if (regenerationSession !== session || session.requestId !== requestId || currentPresentation !== session.presentation || currentPresentationRevision !== session.revision) return;
      if (result.requestId !== requestId || result.presentationId !== session.presentation.id || result.revision !== session.revision || JSON.stringify(result.original) !== JSON.stringify(original)) throw new Error("A resposta ficou desatualizada. Solicite uma nova versão.");
      session.suggestion = result;
      preview(after, "Slide regenerado", result.slide);
      accept.disabled = false;
      feedback.textContent = "Revise o slide regenerado e escolha aceitar ou descartar.";
    } catch (error) {
      discardRegenerationRequest(session);
      if (regenerationSession === session) feedback.textContent = error.name === "AbortError" ? "A solicitação excedeu o tempo limite. Tente novamente." : error.message;
    } finally {
      clearTimeout(timeout);
      if (regenerationSession === session) {
        generate.disabled = instruction.disabled = provider.disabled = false;
        generate.removeAttribute("aria-busy");
      }
    }
  });
  accept.addEventListener("click", async () => {
    if (regenerationSession !== session || !session.suggestion || operationBusy) return;
    operationBusy = true;
    accept.disabled = generate.disabled = discard.disabled = instruction.disabled = provider.disabled = true;
    updateActions();
    feedback.textContent = "Validando a revisão e aplicando somente este slide…";
    try {
      const result = await requestJson(`/api/presentations/${encodeURIComponent(session.presentation.id)}/regeneration-accept`, {
        method: "POST", body: JSON.stringify({ requestId: session.requestId }),
      });
      session.requestId = null;
      renderPresentation(result.presentation, result.provider, scriptEdited, result.presentationRevision);
      document.dispatchEvent(new CustomEvent("deckai:presentation-updated"));
      statusMessage.textContent = `Nova versão aplicada ao slide ${index + 1}. Revisão ${result.presentationRevision}. Os demais slides e o roteiro aprovado foram preservados.`;
    } catch (error) {
      feedback.textContent = error.message;
      session.suggestion = null;
      generate.disabled = discard.disabled = instruction.disabled = provider.disabled = false;
    } finally { operationBusy = false; updateActions(); }
  });
  regenerationDialog.showModal();
  instruction.focus();
});

requestJson("/api/state")
  .then((state) => {
    if (workflowVersion !== 0 || operationBusy || currentScript) return;
    currentProvider = state.provider ?? "mock";
    if (state.briefing) {
      for (const [key, value] of Object.entries(state.briefing)) {
        const control = form.elements.namedItem(key);
        if (control) control.value = String(value);
      }
      providerSelect.value = currentProvider;
      updateModeBadge();
    }
    scriptEdited = state.scriptEdited ?? false;
    if (state.script) renderScript(state.script, scriptEdited);
    if (state.presentation) renderPresentation(state.presentation, state.presentationProvider, scriptEdited, state.presentationRevision);
  })
  .catch((error) => {
    showError(
      error instanceof Error
        ? error.message
        : "Não foi possível consultar o estado do laboratório.",
    );
  });
