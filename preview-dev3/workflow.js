// Presentation-only navigation. Never sends requests or changes workflow data.
const stageButtons = [...document.querySelectorAll("[data-stage]")];
const stages = ["briefing", "script", "presentation"];
let activeStage = "briefing";
let scriptIndex = 0;
let presentationIndex = 0;
let state = { script: null, draft: null, presentation: null, busy: false, dirty: false };
const guidance = document.querySelector("#workflow-guidance");
const scriptNav = document.querySelector("#script-slide-nav");
const presentationNav = document.querySelector("#presentation-slide-nav");
// Group each existing label/control without replacing inputs or their values.
for (const label of document.querySelectorAll("#briefing-form > label")) {
  const control = label.nextElementSibling;
  const field = document.createElement("div");
  field.className = control.tagName === "TEXTAREA" ? "briefing-field briefing-field-wide" : "briefing-field";
  label.before(field);
  field.append(label, control);
}

function showStage(name, focus = true) {
  if ((name === "script" && !state.script) || (name === "presentation" && !state.presentation)) return;
  activeStage = name;
  for (const stage of stages) {
    const panel = document.querySelector(`#stage-${stage}`);
    panel.hidden = stage !== name;
    const button = document.querySelector(`#tab-${stage}`);
    if (stage === name) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  if (focus) {
    const heading = document.querySelector(`#stage-${name} h2`);
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    document.querySelector(".workflow-steps").scrollIntoView({ block: "start", behavior: "instant" });
  }
}
stageButtons.forEach(button => button.addEventListener("click", () => showStage(button.dataset.stage)));

function selectSlide(kind, index) {
  const isScript = kind === "script";
  const container = document.querySelector(isScript ? "#script-content" : "#presentation-content");
  const cards = [...container.querySelectorAll(isScript ? ".planned-slide" : ".slide-card")];
  if (!cards.length) return;
  index = Math.max(0, Math.min(index, cards.length - 1));
  if (isScript) scriptIndex = index; else presentationIndex = index;
  cards.forEach((card, position) => { card.hidden = position !== index; });
  const nav = isScript ? scriptNav : presentationNav;
  nav.querySelectorAll("button").forEach((button, position) => {
    if (position === index) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  if (!isScript) {
    document.querySelector("#current-slide-label").textContent = `Slide ${index + 1} de ${cards.length} · ${state.presentation.slides[index].title}`;
    document.querySelector("#previous-slide").disabled = index === 0;
    document.querySelector("#next-slide").disabled = index === cards.length - 1;
  }
}
function buildSelector(nav, slides, kind) {
  // Rebuild only when titles change, keeping keyboard focus during navigation.
  const signature = JSON.stringify(slides.map(s => s.title));
  if (nav.dataset.signature === signature) return;
  nav.dataset.signature = signature;
  nav.replaceChildren();
  slides.forEach((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${String(index + 1).padStart(2, "0")} · ${slide.title}`;
    button.addEventListener("click", () => selectSlide(kind, index));
    nav.append(button);
  });
}
document.querySelector("#previous-slide").addEventListener("click", () => selectSlide("presentation", presentationIndex - 1));
document.querySelector("#next-slide").addEventListener("click", () => selectSlide("presentation", presentationIndex + 1));
document.addEventListener("deckai:invalid-field", event => {
  showStage("script");
  if (event.detail !== undefined) selectSlide("script", Number(event.detail));
});
document.addEventListener("deckai:workflow", event => {
  const previous = state;
  state = event.detail;
  const newScript = state.script && state.script.id !== previous.script?.id;
  const newPresentation = state.presentation && state.presentation !== previous.presentation;
  if (newScript) scriptIndex = 0;
  if (newPresentation && state.presentation.id !== previous.presentation?.id) presentationIndex = 0;
  document.querySelector("#tab-script").disabled = !state.script;
  document.querySelector("#tab-presentation").disabled = !state.presentation;
  document.querySelector("#ai-workflow").setAttribute("aria-busy", String(state.busy));
  guidance.textContent = state.busy ? "Processando sua solicitação. Aguarde; não é necessário clicar novamente."
    : state.draft ? (state.dirty ? "Alterações não salvas. Elas são mantidas ao trocar de slide ou etapa. Salve ou cancele antes de aprovar ou gerar." : "Edição em andamento. Salve as alterações ou cancele para liberar a aprovação e a geração.")
    : state.presentation ? "Apresentação pronta. Explore os slides ou volte ao roteiro."
    : state.script?.status === "approved" ? "Revisão aprovada. Você já pode gerar a apresentação."
    : state.script ? "Revise o roteiro e aprove a revisão atual para liberar a geração."
    : "Preencha o briefing para começar. Alterar seus campos invalida o roteiro anterior.";
  buildSelector(scriptNav, (state.draft ?? state.script)?.plannedSlides ?? [], "script");
  buildSelector(presentationNav, state.presentation?.slides ?? [], "presentation");
  selectSlide("script", scriptIndex);
  selectSlide("presentation", presentationIndex);
  if (newPresentation) showStage("presentation");
  else if (newScript) showStage("script");
  else if (!state.script) showStage("briefing", false);
  else if (!state.presentation && activeStage === "presentation") showStage("script");
});
window.addEventListener("beforeunload", event => {
  if (state.dirty) { event.preventDefault(); event.returnValue = ""; }
});
const menuButton = document.querySelector("#toggle-site-nav");
menuButton.addEventListener("click", () => {
  const expanded = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(expanded));
  document.querySelector(".official-side").dataset.expanded = String(expanded);
});
