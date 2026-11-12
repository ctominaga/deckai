const sharedButton = document.querySelector("#shared-json-button");
const sharedStatus = document.querySelector("#shared-json-status");
const sharedOutput = document.querySelector("#shared-json-output");
let sharedVersion = 0;
sharedButton.addEventListener("click", async () => {
  const version = sharedVersion;
  sharedButton.disabled = true;
  sharedOutput.hidden = true;
  try {
    const response = await fetch("/api/presentation/shared");
    const body = await response.json();
    if (version !== sharedVersion) return;
    if (!response.ok) throw new Error(body.error);
    sharedStatus.textContent = body.warnings.join("\n");
    sharedOutput.textContent = JSON.stringify(body.presentation, null, 2);
    sharedOutput.hidden = false;
  } catch (error) {
    if (version === sharedVersion) sharedStatus.textContent = error instanceof Error ? error.message : "Falha na adaptação.";
  } finally {
    sharedButton.disabled = false;
  }
});
// Never keep an exported projection visible after an edit or a new briefing.
function clearSharedJson() {
  ++sharedVersion;
  sharedOutput.hidden = true;
  sharedOutput.textContent = "";
  sharedStatus.textContent = "";
}
for (const event of ["input", "change", "submit"]) document.querySelector("#briefing-form").addEventListener(event, clearSharedJson);
document.querySelector("#script-content").addEventListener("click", clearSharedJson);
document.addEventListener("deckai:presentation-updated", clearSharedJson);
