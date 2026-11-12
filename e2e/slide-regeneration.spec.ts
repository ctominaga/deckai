import { test, expect, type Page } from "@playwright/test";

const state = async (page: Page) => (await page.request.get(new URL("/api/state", page.url()).href)).json();
async function generate(page: Page, simulated = false) {
  await page.goto(`${simulated ? "http://127.0.0.1:4185" : ""}/gerar-ia.html`);
  await page.locator("#tab-briefing").click();
  await page.locator("#provider").selectOption(simulated ? "deepseek" : "mock");
  await page.locator("#generate-script-button").click();
  await expect(page.locator("#approve-button")).toBeEnabled();
  await page.locator("#approve-button").click();
  await page.locator("#generate-presentation-button").click();
  await expect(page.locator("#tab-presentation")).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#regenerate-slide-button")).toBeEnabled();
}
async function openSuggestion(page: Page) {
  await page.locator("#regenerate-slide-button").click();
  await page.locator("#regeneration-instruction").fill("Use uma explicação mais direta e preserve os tópicos aprovados.");
  await page.locator("#regeneration-generate").click();
  await expect(page.locator("#regeneration-accept")).toBeEnabled();
}

test("compares and discards the selected slide without modifying content or revision", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await generate(page);
  await page.locator("#next-slide").click();
  const before = await state(page);
  await openSuggestion(page);
  await expect(page.locator("#regeneration-heading")).toContainText(`slide 2 · ${before.presentation.slides[1].title}`);
  await expect(page.locator("#regeneration-original")).toContainText(before.presentation.slides[1].body);
  await expect(page.locator("#regeneration-suggestion")).toContainText("Nova versão demonstrativa");
  expect(await state(page)).toEqual(before);
  await page.locator("#regeneration-discard").click();
  await expect(page.locator("#regeneration-dialog")).not.toBeVisible();
  expect(await state(page)).toEqual(before);
  await expect(page.locator("#current-slide-label")).toContainText("Slide 2 de 6");
  await page.locator("#previous-slide").click();
  await expect(page.locator("#current-slide-label")).toContainText("Slide 1 de 6");
  expect(errors).toEqual([]);
});

test("accepts each of the six layouts preserving all other slides, approval, navigation and JSON", async ({ page }) => {
  await generate(page);
  for (let index = 0; index < 6; index++) {
    await page.locator("#presentation-slide-nav button").nth(index).click();
    const before = await state(page);
    await openSuggestion(page);
    await page.locator("#regeneration-accept").click();
    await expect(page.locator("#regeneration-dialog")).not.toBeVisible();
    const after = await state(page);
    expect(after.presentationRevision).toBe(before.presentationRevision + 1);
    expect(after.script).toEqual(before.script);
    expect(after.presentation.references).toEqual(before.presentation.references);
    expect(after.presentation.slides).toHaveLength(6);
    after.presentation.slides.forEach((slide: { id: string; title: string; layout: string }, i: number) => {
      const original = before.presentation.slides[i];
      expect(slide).toMatchObject({ id: original.id, title: original.title, layout: original.layout });
      if (i !== index) expect(slide).toEqual(original);
      else expect(slide).not.toEqual(original);
    });
    await expect(page.locator("#current-slide-label")).toContainText(`Slide ${index + 1} de 6`);
    expect(JSON.parse((await page.locator("#presentation-json").textContent())!)).toEqual(after.presentation);
    await expect(page.locator("#script-status")).toHaveText("Aprovado");
  }
  await page.reload();
  await expect(page.locator("#presentation-provider")).toContainText("Revisão 7");
});

test("invalidates the visible shared projection only after applying the new version", async ({ page }) => {
  await generate(page);
  await page.locator(".advanced-json > summary").click();
  await page.locator("#shared-json-button").click();
  await expect(page.locator("#shared-json-output")).toBeVisible();
  const before = await page.locator("#shared-json-output").textContent();
  await openSuggestion(page);
  await page.locator("#regeneration-discard").click();
  expect(await page.locator("#shared-json-output").textContent()).toBe(before);
  await openSuggestion(page);
  await page.locator("#regeneration-accept").click();
  await expect(page.locator("#shared-json-output")).not.toBeVisible();
  await page.locator("#shared-json-button").click();
  await expect(page.locator("#shared-json-output")).toBeVisible();
  expect(await page.locator("#shared-json-output").textContent()).not.toBe(before);
});

test("shows provider errors, loading and the Gemini limitation on mobile without changing the presentation", async ({ page }) => {
  await generate(page); const before = await state(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator("#regenerate-slide-button").click();
  await expect(page.locator('#regeneration-provider option[value="gemini"]')).toBeDisabled();
  await expect(page.locator('#regeneration-provider option[value="gemini"]')).toContainText("indisponível");
  let release!: () => void;
  await page.route("**/api/presentations/*/regenerate-slide", async route => {
    await new Promise<void>(resolve => release = resolve);
    await route.fulfill({ status: 503, json: { error: "DeepSeek temporariamente indisponível (HTTP 503)." } });
  });
  await page.locator("#regeneration-generate").click();
  await expect(page.locator("#regeneration-generate")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#regeneration-accept")).toBeDisabled();
  await expect.poll(() => typeof release).toBe("function"); release();
  await expect(page.locator("#regeneration-feedback")).toContainText("503");
  await expect(page.locator("#regeneration-generate")).toBeEnabled();
  expect(await state(page)).toEqual(before);
  expect(await page.locator("#regeneration-dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/regeneration-mobile-error.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#regeneration-dialog")).not.toBeVisible();
});

test("ignores a canceled delayed response after a newer preview arrives", async ({ page }) => {
  await generate(page); const before = await state(page);
  let count = 0; let release!: () => void;
  await page.route("**/api/presentations/*/regenerate-slide", async route => {
    const first = ++count === 1;
    const request = route.request().postDataJSON();
    if (first) await new Promise<void>(resolve => release = resolve);
    await route.fulfill({ json: { requestId: request.requestId, presentationId: before.presentation.id, revision: before.presentationRevision,
      original: before.presentation.slides[0], slide: { ...before.presentation.slides[0], subtitle: first ? "Resposta atrasada" : "Versão recente" } } }).catch(() => {});
  });
  await page.locator("#regenerate-slide-button").click();
  await page.locator("#regeneration-generate").click();
  await expect.poll(() => count).toBe(1);
  await page.locator("#regeneration-discard").click();
  await openSuggestion(page);
  await expect(page.locator("#regeneration-suggestion")).toContainText("Versão recente");
  release();
  await expect(page.locator("#regeneration-suggestion")).not.toContainText("Resposta atrasada");
  expect(await state(page)).toEqual(before);
  await page.locator("#regeneration-discard").click();
});

test("rejects stale acceptance after another tab applies a new version", async ({ page }) => {
  await generate(page); await openSuggestion(page);
  const before = await state(page);
  const route = `/api/presentations/${before.presentation.id}`;
  const suggestion = await (await page.request.post(route + "/regenerate-slide", { data: { revision: 1, slideId: before.presentation.slides[1].id, provider: "mock" } })).json();
  expect((await page.request.post(route + "/regeneration-accept", { data: { requestId: suggestion.requestId } })).status()).toBe(200);
  const current = await state(page);
  await page.locator("#regeneration-accept").click();
  await expect(page.locator("#regeneration-feedback")).toContainText("revisão");
  await expect(page.locator("#regeneration-accept")).toBeDisabled();
  expect(await state(page)).toEqual(current);
  await page.locator("#regeneration-discard").click();
});

test("regenerates via simulated DeepSeek and fits the comparison on desktop and mobile", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await generate(page, true);
  await page.locator("#presentation-slide-nav button").nth(4).click();
  const before = await state(page);
  await openSuggestion(page);
  await expect(page.locator("#regeneration-provider")).toHaveValue("deepseek");
  await expect(page.locator("#regeneration-suggestion")).toContainText("Nova versão demonstrativa");
  expect(await state(page)).toEqual(before);
  await page.screenshot({ path: "test-results/regeneration-deepseek-desktop.png" });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.locator("#regeneration-dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/regeneration-mobile-preview.png" });
  await page.locator("#regeneration-accept").click();
  await expect(page.locator("#regeneration-dialog")).not.toBeVisible();
  await expect(page.locator("#current-slide-label")).toContainText("Slide 5 de 6");
  const after = await state(page);
  expect(after.presentationRevision).toBe(2);
  expect(after.script).toEqual(before.script);
  expect(after.provider).toBe("deepseek");
  expect(errors).toEqual([]);
});
