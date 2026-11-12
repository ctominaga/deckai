import { test, expect, type Page } from "@playwright/test";

async function generateOutline(page: Page) {
  await page.goto("/gerar-ia.html");
  await page.locator("#tab-briefing").click();
  await page.locator("#provider").selectOption("mock");
  await page.locator("#generate-script-button").click();
  await expect(page.locator("#tab-script")).toHaveAttribute("aria-current", "step");
}
test("keeps unsaved slide edits across slide and stage selection; cancel restores saved content", async ({page}) => {
  await generateOutline(page);
  const posts: string[] = [];
  page.on("request", r => { if (r.method() === "POST") posts.push(r.url()); });
  await expect(page.locator(".planned-slide:visible")).toHaveCount(1);
  await page.locator(".planned-slide:visible").getByRole("button", {name:"Editar",exact:true}).click();
  const title = page.locator('[data-edit-field="title"][data-slide-index="0"]');
  await title.fill("Título pendente preservado");
  await expect(page.locator("#workflow-guidance")).toContainText("Alterações não salvas");
  await expect(page.locator("#approve-button")).toBeDisabled();
  await expect(page.locator("#generate-presentation-button")).toBeDisabled();
  await page.locator("#script-slide-nav button").nth(1).click();
  await expect(title).toBeHidden();
  await page.locator("#tab-briefing").click();
  await expect(page.locator("#briefing-form")).toBeVisible();
  await page.locator("#tab-script").click();
  await page.locator("#script-slide-nav button").first().click();
  await expect(title).toHaveValue("Título pendente preservado");
  expect(posts).toEqual([]);
  await page.getByRole("button",{name:"Cancelar",exact:true}).click();
  await expect(page.locator(".planned-slide:visible .planned-title")).not.toHaveText("Título pendente preservado");
  await expect(page.locator("#approve-button")).toBeEnabled();
});

test("navigates all six layouts, preserves slide position and fits desktop, narrow and mobile windows", async ({page}) => {
  await generateOutline(page);
  await page.locator("#approve-button").click();
  await page.locator("#generate-presentation-button").click();
  await expect(page.locator("#tab-presentation")).toHaveAttribute("aria-current","step");
  await expect(page.locator(".slide-card:visible")).toHaveCount(1);
  await expect(page.locator("#previous-slide")).toBeDisabled();
  const layouts=["Capa","Texto + imagem","Duas colunas","Indicadores","Case","Encerramento"];
  for(let i=0;i<6;i++) {
    await expect(page.locator(".slide-card:visible .layout-tag")).toHaveText(layouts[i]);
    await expect(page.locator("#current-slide-label")).toContainText(`Slide ${i+1} de 6`);
    if(i<5)await page.locator("#next-slide").click();
  }
  await expect(page.locator("#next-slide")).toBeDisabled();
  await page.locator("#previous-slide").click();
  await expect(page.locator("#current-slide-label")).toContainText("Slide 5 de 6");
  await page.locator("#presentation-slide-nav button").nth(2).click();
  await page.locator("#tab-briefing").click();
  await page.locator("#tab-script").click();
  await page.locator("#tab-presentation").click();
  await expect(page.locator("#current-slide-label")).toContainText("Slide 3 de 6");
  for(const width of [1440,1024,800,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.locator("#tab-presentation").click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(page.locator("#next-slide")).toBeInViewport();
    await page.screenshot({path:`test-results/ux-presentation-${width}.png`});
    await page.locator("#tab-script").click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/ux-script-${width}.png`});
  }
});

test("exposes loading and API errors without duplicate requests or automatic generation",async ({page})=>{
  await page.route("**/api/state",r=>r.fulfill({json:{provider:null,script:null,presentation:null}}));
  await page.goto("/gerar-ia.html");
  await expect(page.locator("#provider")).toHaveValue("deepseek");
  await expect(page.locator("#tab-script")).toBeDisabled();
  let count=0;
  let release!:()=>void;
  await page.route("**/api/scripts",async r=>{
    count++;
    await new Promise<void>(resolve=>release=resolve);
    await r.fulfill({status:503,json:{error:"Provedor temporariamente indisponível. Tente novamente."}});
  });
  await page.locator("#generate-script-button").click();
  await expect(page.locator("#generate-script-button")).toBeDisabled();
  await expect(page.locator("#generate-script-button")).toHaveAttribute("aria-busy","true");
  await expect(page.locator("#workflow-guidance")).toContainText("Processando");
  await expect.poll(()=>count).toBe(1);
  release();
  await expect(page.locator("#error-message")).toContainText("Provedor temporariamente indisponível");
  await expect(page.locator("#generate-script-button")).toBeEnabled();
  expect(count).toBe(1);
});
