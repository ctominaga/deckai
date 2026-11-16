import fs from "node:fs";

const file = process.argv[2] ?? "platform/mock-api/presentation-response.json";
const response = JSON.parse(fs.readFileSync(file, "utf8"));
const allowedLayouts = new Set(["cover", "text_image", "two_columns", "metrics", "case", "closing"]);
const errors = [];
const warnings = [];

if (!response.requestId) errors.push("requestId is required");
if (!response.status) errors.push("status is required");
if (!response.content?.canvas) errors.push("content.canvas is required");
if (response.content?.canvas?.ratio !== "16:9") errors.push("canvas ratio must be 16:9");
if (!Array.isArray(response.content?.slides) || response.content.slides.length === 0) errors.push("at least one slide is required");

for (const slide of response.content?.slides ?? []) {
  if (!slide.slideId) errors.push("slide without slideId");
  if (!allowedLayouts.has(slide.layout)) errors.push(`${slide.slideId}: unsupported layout`);
  if (!Array.isArray(slide.blocks)) errors.push(`${slide.slideId}: blocks must be an array`);
  if (!Array.isArray(slide.references)) errors.push(`${slide.slideId}: references must be an array`);

  for (const block of slide.blocks ?? []) {
    if (!block.id || !block.type) errors.push(`${slide.slideId}: block needs id and type`);
    const hasText = typeof block.text === "string" && block.text.trim().length > 0;
    const factualRole = ["metric", "claim", "case", "customer", "result", "body"].includes(block.role);
    if (hasText && factualRole && slide.references.length === 0) {
      warnings.push(`${slide.slideId}/${block.id}: factual-looking text has no reference`);
    }
  }
}

if (errors.length) {
  console.error(`AI response validation failed: ${errors.length} error(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`AI response validation passed: ${response.content.slides.length} slide(s)`);
if (warnings.length) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings) console.log(`- ${warning}`);
}
