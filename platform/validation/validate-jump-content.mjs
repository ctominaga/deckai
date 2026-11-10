import fs from "node:fs";

const file = process.argv[2] ?? "platform/mock-data/jump-content-public.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const validStatuses = new Set(["draft", "in_review", "approved", "rejected", "expired", "archived"]);

if (!Array.isArray(data.items)) errors.push("items must be an array");

for (const item of data.items ?? []) {
  if (!item.contentId) errors.push("item without contentId");
  if (!item.title?.trim()) errors.push(`${item.contentId}: title is required`);
  if (!item.category?.trim()) errors.push(`${item.contentId}: category is required`);
  if (!validStatuses.has(item.status)) errors.push(`${item.contentId}: invalid status`);
  if (!item.source?.url && !item.source?.assetId) errors.push(`${item.contentId}: source is required`);

  if (item.status === "approved") {
    if (!item.validFrom) errors.push(`${item.contentId}: approved content needs validFrom`);
    if (!item.validUntil) errors.push(`${item.contentId}: approved content needs validUntil`);
    if (!item.approvedBy) errors.push(`${item.contentId}: approved content needs approvedBy`);
  }
}

if (errors.length) {
  console.error(`Jump content validation failed: ${errors.length} error(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Jump content validation passed: ${data.items.length} item(s)`);
