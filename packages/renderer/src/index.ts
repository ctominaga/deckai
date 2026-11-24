import type { Block, PresentationContent, Slide } from "@deckai/contracts";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

function blockHtml(block: Block): string {
  if (block.type === "text") return `<div class="block text role-${escapeHtml(block.role)}">${escapeHtml(block.text)}</div>`;
  if (block.type === "metric") return `<div class="block metric"><strong>${escapeHtml(block.value)}${block.unit ? `<small>${escapeHtml(block.unit)}</small>` : ""}</strong><span>${escapeHtml(block.label)}</span></div>`;
  return `<div class="block image" role="img" aria-label="${escapeHtml(block.alt)}"><span>Imagem ainda não selecionada</span></div>`;
}

export function renderSlideHtml(slide: Slide, index = 0): string {
  return `<section class="slide layout-${escapeHtml(slide.layout)}" data-slide-id="${escapeHtml(slide.slideId)}" aria-label="Slide ${index + 1}">${slide.blocks.map(blockHtml).join("")}</section>`;
}

export const presentationStyles = `
.slide{container-type:inline-size;position:relative;overflow:hidden;aspect-ratio:16/9;width:min(100%,1280px);margin:auto;background:var(--paper);padding:clamp(18px,5.4cqw,76px);display:flex;flex-direction:column;justify-content:center;gap:clamp(6px,1.25cqw,18px);box-shadow:0 10px 30px #0002}
.text{max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere}.role-title{font-size:clamp(22px,4.9cqw,66px);line-height:1;font-weight:750;letter-spacing:-.045em}.role-subtitle,.role-body,.role-caption,.role-cta{font-size:clamp(12px,1.8cqw,25px);line-height:1.3;margin-top:0;color:var(--muted)}
.layout-cover{background:var(--ink);color:#fff}.layout-cover .role-title{font-size:clamp(24px,5.7cqw,74px);max-width:82%}.layout-cover .role-subtitle{font-size:clamp(12px,1.9cqw,25px);color:var(--accent)}.layout-cover .role-body,.layout-cover .role-caption{font-size:clamp(9px,1.08cqw,15px);line-height:1.28;max-width:76%;color:#aaa}
.layout-text_image{display:grid;grid-template-columns:1.05fr .95fr;grid-auto-rows:min-content;align-content:center;gap:clamp(6px,1.4cqw,18px) 6%}.layout-text_image .image{grid-column:2;grid-row:1/span 8;height:100%;min-height:60%}.layout-text_image .text{grid-column:1}
.layout-text_image:not(:has(.image)){grid-template-columns:1fr 1fr;column-gap:8%}.layout-text_image:not(:has(.image)) .role-title{grid-column:1/-1;max-width:76%}.layout-text_image:not(:has(.image)) .role-body,.layout-text_image:not(:has(.image)) .role-caption{grid-column:auto;max-width:100%;align-self:start}
.layout-two_columns{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:row;align-content:center;gap:clamp(8px,1.8cqw,24px) 7%}.layout-two_columns .role-title{grid-column:1/-1}.layout-two_columns .role-body{max-width:100%;margin-top:0;border-top:2px solid currentColor;padding-top:clamp(6px,1.2cqw,16px)}
.layout-metrics{display:grid;grid-template-columns:repeat(2,1fr);align-content:center;gap:clamp(7px,1.6cqw,20px)}.layout-metrics .role-title{grid-column:1/-1}.layout-metrics .metric{margin:0}
.layout-case{justify-content:flex-start}.layout-case .role-title{padding-bottom:clamp(8px,1.8cqw,24px);border-bottom:clamp(2px,.32cqw,4px) solid var(--accent)}.layout-case .role-body{max-width:72%}
.layout-closing{background:var(--accent);align-items:center;text-align:center}.layout-closing .text{max-width:76%}.layout-closing .role-cta{color:var(--ink);border:2px solid var(--ink);padding:12px 18px}
.metric{border-top:clamp(1px,.24cqw,3px) solid currentColor;padding-top:clamp(5px,1.1cqw,14px);display:inline-grid;min-width:0;margin:clamp(3px,.8cqw,10px)}.metric strong{font-size:clamp(18px,3.75cqw,48px)}.metric small{font-size:clamp(9px,1.55cqw,20px);margin-left:4px}.metric span{font-size:clamp(10px,1.25cqw,16px);color:var(--muted)}.image{min-height:35%;border:2px dashed #aaa;display:grid;place-items:center;color:var(--muted)}
`;

export function renderPresentationDocument(content: PresentationContent, title = "Deck AI"): string {
  const slides = content.slides.map(renderSlideHtml).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  :root{--ink:#171717;--paper:#f3f1e9;--accent:#d7ff45;--muted:#77766f}*{box-sizing:border-box}body{margin:0;background:#dddcd5;color:var(--ink);font-family:Arial,sans-serif}.deck{display:grid;gap:24px;padding:24px}${presentationStyles}@media print{body{background:#fff}.deck{padding:0;gap:0}.slide{width:100vw;height:100vh;box-shadow:none;break-after:page}}
  </style></head><body><main class="deck">${slides}</main></body></html>`;
}
