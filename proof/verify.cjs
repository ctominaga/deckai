/* Optional browser smoke check. Requires Playwright only for this check. */
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const remote = [];
  const pageErrors = [];
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) remote.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(__dirname, "dist", "deck.html")).href);
  await page.locator(".thumb-button").first().waitFor();
  assert.equal(await page.locator(".thumb-button").count(), 6);
  assert.equal(await page.locator("#print-deck .slide-canvas").count(), 6);
  assert.equal(await page.locator("#slide-stage .layout-cover").count(), 1);
  assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
  await page.screenshot({ path: path.join(os.tmpdir(), "deck-ai-proof-desktop.png"), fullPage: true });
  for (let index = 0; index < 6; index++) {
    await page.locator(`.thumb-button[data-index="${index}"]`).click();
    const clipped = await page.locator("#slide-stage .slide-canvas").evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll("h2, h3, p, .slide-kicker, .metric-value, .metric-label")]
        .filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2;
        })
        .map((item) => item.textContent);
    });
    assert.deepEqual(clipped, [], `Text clipped on slide ${index + 1}`);
    await page.locator("#slide-stage").screenshot({ path: path.join(os.tmpdir(), `deck-ai-proof-slide-${index + 1}.png`) });
  }
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 6);

  await page.locator('.thumb-button[data-index="3"]').click();
  assert.equal(await page.locator("#slide-stage .layout-metrics").count(), 1);
  await page.locator("#slide-stage .slide-title").fill("Indicadores editados");
  assert.match(await page.locator('.thumb-button[data-index="3"]').getAttribute("aria-label"), /Indicadores editados/);

  await page.locator("#present").click();
  assert.equal(await page.locator("#presentation").isVisible(), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#presentation-position").textContent(), "5 / 6");
  await page.keyboard.press("Escape");
  await page.locator("#presentation").waitFor({ state: "hidden" });

  const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await page.locator("#download-html").click({ timeout: 3000 });
  const download = await downloadPromise;
  const exported = path.join(os.tmpdir(), "deck-ai-proof-exported.html");
  await download.saveAs(exported);
  assert.equal(fs.existsSync(exported), true);
  const exportedPage = await browser.newPage();
  const exportedRemote = [];
  const exportedErrors = [];
  exportedPage.on("request", (request) => {
    if (/^https?:/i.test(request.url())) exportedRemote.push(request.url());
  });
  exportedPage.on("pageerror", (error) => exportedErrors.push(error.message));
  await exportedPage.goto(pathToFileURL(exported).href);
  await exportedPage.locator('.thumb-button[data-index="3"]').click();
  assert.equal(await exportedPage.locator("#slide-stage .slide-title").textContent(), "Indicadores editados");
  assert.equal(await exportedPage.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
  assert.deepEqual(exportedRemote, []);
  assert.deepEqual(exportedErrors, []);
  await exportedPage.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.thumb-button[data-index="0"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.screenshot({ path: path.join(os.tmpdir(), "deck-ai-proof-mobile.png"), fullPage: true });
  await page.locator("#slide-stage .slide-title").fill("Texto muito longo ".repeat(150));
  assert.match(await page.locator("#edit-status").textContent(), /não cabe/);
  await page.locator("#download-html").click();
  assert.match(await page.locator("#edit-status").textContent(), /Encurte o texto antes de exportar/);
  assert.deepEqual(remote, []);
  assert.deepEqual(pageErrors, []);
  await browser.close();
  console.log("Browser proof passed: 6 layouts/pages, images, offline, edits/export, presentation keys, mobile width.");
  console.log(`Screenshots: ${path.join(os.tmpdir(), "deck-ai-proof-desktop.png")}; ${path.join(os.tmpdir(), "deck-ai-proof-mobile.png")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
