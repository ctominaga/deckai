import { test, expect, type Page } from "@playwright/test";

async function generate(page: Page, provider = "mock", simulated = false) {
  await page.goto(`${simulated ? "http://127.0.0.1:4185" : ""}/gerar-ia.html`);
  await page.locator("#tab-briefing").click();
  await page.locator("#provider").selectOption(provider);
  await page.locator("#generate-script-button").click();
  await expect(page.locator("#tab-script")).toHaveAttribute("aria-current", "step");
}
const state = async (page: Page) => (await page.request.get(new URL("/api/state", page.url()).href)).json();
const aiButton = (page: Page, field: string) => page.locator(`[data-ai-target*='"field":"${field}"']`).filter({ visible: true }).first();

for (const [field, operation] of [["scriptTitle", "expand"], ["title", "summarize"], ["objective", "tone"], ["keyPoint", "custom"]]) {
  test(`compares, discards and accepts only ${field} using ${operation}`, async ({ page }) => {
    await generate(page);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.locator("#approve-button").click();
    await page.locator("#generate-presentation-button").click();
    await expect(page.locator("#tab-presentation")).toHaveAttribute("aria-current", "step");
    await page.locator("#tab-script").click();
    const before = await state(page);
    const target = JSON.parse((await aiButton(page, field).getAttribute("data-ai-target"))!);
    await aiButton(page, field).click();
    await page.locator("#rewrite-operation").selectOption(operation);
    if (operation === "tone") await page.locator("#rewrite-tone").fill("formal");
    if (operation === "custom") await page.locator("#rewrite-instruction").fill("Use uma frase simples");
    await page.locator("#rewrite-generate").click();
    await expect(page.locator("#rewrite-accept")).toBeEnabled();
    expect(await state(page)).toEqual(before);
    await page.locator("#rewrite-discard").click();
    await expect(page.locator("#rewrite-dialog")).not.toBeVisible();
    expect(await state(page)).toEqual(before);
    await aiButton(page, field).click();
    await page.locator("#rewrite-operation").selectOption(operation);
    if (operation === "tone") await page.locator("#rewrite-tone").fill("formal");
    if (operation === "custom") await page.locator("#rewrite-instruction").fill("Use uma frase simples");
    await page.locator("#rewrite-generate").click();
    await expect(page.locator("#rewrite-accept")).toBeEnabled();
    const text = await page.locator("#rewrite-suggestion").textContent();
    await page.locator("#rewrite-accept").click();
    await expect(page.locator("#rewrite-dialog")).not.toBeVisible();
    const expected = structuredClone(before.script);
    if (field === "scriptTitle") expected.title = text;
    else {
      const slide = expected.plannedSlides.find((s: { id: string }) => s.id === target.slideId);
      if (field === "keyPoint") slide.keyPoints[target.topicIndex] = text;
      else slide[field] = text;
    }
    expected.revision++; expected.status = "draft";
    const after = await state(page);
    expect(after.script).toEqual(expected);
    expect(after.presentation).toBeNull();
    await expect(page.locator("#script-status")).toHaveText("Rascunho");
    await expect(page.locator("#generate-presentation-button")).toBeDisabled();
    await expect(page.locator("#tab-presentation")).toBeDisabled();
    await page.locator("#approve-button").click();
    await expect(page.locator("#generate-presentation-button")).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("preserves unsaved manual edits and requires saving before AI editing", async ({ page }) => {
  await generate(page);
  await page.locator(".planned-slide:visible").getByRole("button", { name: "Editar", exact: true }).click();
  const title = page.locator('[data-edit-field="title"][data-slide-index="0"]');
  await title.fill("Rascunho manual preservado");
  const requests: string[] = []; page.on("request", request => { if (request.method() === "POST") requests.push(request.url()); });
  await aiButton(page, "objective").click();
  await expect(page.locator("#error-message")).toContainText("rascunho foi preservado");
  await expect(title).toHaveValue("Rascunho manual preservado");
  await expect(page.locator("#rewrite-dialog")).not.toBeVisible();
  expect(requests).toEqual([]);
  await page.locator("#script-slide-nav button").nth(1).click();
  await page.locator("#tab-briefing").click();
  await page.locator("#tab-script").click();
  await page.locator("#script-slide-nav button").first().click();
  await expect(title).toHaveValue("Rascunho manual preservado");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(page.locator(".script-summary")).toContainText("Revisão 2");
  await aiButton(page, "objective").click();
  await page.locator("#rewrite-operation").selectOption("expand");
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-accept")).toBeEnabled();
  await page.locator("#rewrite-accept").click();
  await expect(page.locator(".script-summary")).toContainText("Revisão 3");
  expect((await state(page)).script.plannedSlides[0].title).toBe("Rascunho manual preservado");
});

test("ignores a canceled delayed response after a newer suggestion arrives", async ({ page }) => {
  await generate(page);
  const original = (await state(page)).script.title;
  let count = 0; let release!: () => void;
  await page.route("**/api/scripts/*/rewrite", async route => {
    count++;
    const first = count === 1;
    if (first) await new Promise<void>(resolve => release = resolve);
    await route.fulfill({ json: { suggestionId: first ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002", revision: 1, original, text: first ? "Resposta antiga" : "Resposta recente" } }).catch(() => {});
  });
  await aiButton(page, "scriptTitle").click();
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-generate")).toBeDisabled();
  await expect.poll(() => count).toBe(1);
  await page.locator("#rewrite-discard").click();
  await aiButton(page, "scriptTitle").click();
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-suggestion")).toHaveText("Resposta recente");
  release();
  await expect(page.locator("#rewrite-suggestion")).toHaveText("Resposta recente");
  expect((await state(page)).script.title).toBe(original);
  await page.locator("#rewrite-discard").click();
});

test("reports revision conflicts without overwriting newer server edits", async ({ page }) => {
  await generate(page);
  await aiButton(page, "scriptTitle").click();
  await page.locator("#rewrite-operation").selectOption("expand");
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-accept")).toBeEnabled();
  const before = (await state(page)).script;
  const response = await page.request.post(`/api/scripts/${before.id}/edit`, { data: { revision: before.revision, title: "Outra aba atualizou", plannedSlides: before.plannedSlides } });
  expect(response.status()).toBe(200);
  await page.locator("#rewrite-accept").click();
  await expect(page.locator("#rewrite-feedback")).toContainText("revisão mudou");
  await expect(page.locator("#rewrite-accept")).toBeDisabled();
  expect((await state(page)).script.title).toBe("Outra aba atualizou");
  await page.locator("#rewrite-discard").click();
});

test("shows API errors, validates instructions and fits a mobile viewport", async ({ page }) => {
  await generate(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await aiButton(page, "scriptTitle").click();
  await page.locator("#rewrite-operation").selectOption("custom");
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-feedback")).toContainText("Informe a instrução");
  await page.locator("#rewrite-instruction").fill("Reescreva com clareza");
  await page.route("**/api/scripts/*/rewrite", route => route.fulfill({ status: 503, json: { error: "DeepSeek temporariamente indisponível (HTTP 503)." } }));
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-feedback")).toContainText("503");
  await expect(page.locator("#rewrite-accept")).toBeDisabled();
  await expect(page.locator("#rewrite-generate")).toBeEnabled();
  expect(await page.locator("#rewrite-dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/rewrite-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#rewrite-dialog")).not.toBeVisible();
});

test("rewrites with the simulated DeepSeek transport and keeps generation provider", async ({ page }) => {
  await generate(page, "deepseek", true);
  await aiButton(page, "title").click();
  await page.locator("#rewrite-operation").selectOption("expand");
  await page.locator("#rewrite-generate").click();
  await expect(page.locator("#rewrite-suggestion")).toContainText("Sugestão simulada");
  await page.screenshot({ path: "test-results/rewrite-deepseek-desktop.png" });
  await page.locator("#rewrite-accept").click();
  await expect(page.locator(".script-summary")).toContainText("Revisão 2");
  expect((await state(page)).provider).toBe("deepseek");
});
