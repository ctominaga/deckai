import type { PresentationContent } from "@deckai/contracts";
import { renderSlideHtml, type RenderAssets } from "@deckai/renderer";
import { api, ApiClientError, imageRequest } from "./api.js";

type ImageAsset = { id: string; name: string; sizeBytes: number };
const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler a imagem.")); reader.readAsDataURL(blob);
});
export async function loadImages(content: PresentationContent, existing: RenderAssets = {}): Promise<RenderAssets> {
  const ids = [...new Set(content.slides.flatMap(slide => slide.blocks.flatMap(block => block.type === "image" && block.assetId ? [block.assetId] : [])))];
  const result: RenderAssets = {};
  // Fetch in small batches so presentations with many images do not flood the API.
  for (let offset = 0; offset < ids.length; offset += 4) await Promise.all(ids.slice(offset, offset + 4).map(async id => {
    if (existing[id]) { result[id] = existing[id]; return; }
    const response = await imageRequest(`/api/v1/assets/images/${id}`).catch((error: unknown) => {
      if (error instanceof ApiClientError && error.status === 404) return undefined;
      throw error;
    });
    if (!response) return;
    const blob = await response.blob();
    const dataUrl = await blobDataUrl(blob);
    const bitmap = await createImageBitmap(blob);
    result[id] = { dataUrl, width: bitmap.width, height: bitmap.height }; bitmap.close();
  }));
  return result;
}

export function chooseImage(onSelect: (asset: ImageAsset, image: RenderAssets[string]) => void): void {
  const dialog = document.createElement("dialog"); dialog.className = "dialog image-dialog";
  dialog.innerHTML = `<h2>Selecionar imagem</h2><p>Envie PNG ou JPEG de até 5 MB ou reutilize uma imagem da organização.</p><label class="field">Enviar imagem<input id="imageFile" type="file" accept="image/png,image/jpeg"></label><div id="imageStatus" role="status"></div><div class="asset-library" id="assetLibrary"></div><div class="dialog-actions"><button type="button" class="button secondary" id="closeImages">Fechar</button></div>`;
  const status = dialog.querySelector<HTMLElement>("#imageStatus")!;
  const fileInput = dialog.querySelector<HTMLInputElement>("#imageFile")!;
  const close = dialog.querySelector<HTMLButtonElement>("#closeImages")!;
  let busy = false;
  const run = async (work: () => Promise<void>) => {
    if (busy) return; busy = true; fileInput.disabled = close.disabled = true; status.className = ""; status.textContent = "Carregando imagem…";
    try { await work(); dialog.close(); }
    catch (error) { status.className = "error"; status.textContent = error instanceof Error ? error.message : "Falha ao carregar imagem."; }
    finally { busy = false; fileInput.disabled = close.disabled = false; }
  };
  const select = async (asset: ImageAsset, blob?: Blob) => {
    const source = blob ?? await (await imageRequest(`/api/v1/assets/images/${asset.id}`)).blob();
    const dataUrl = await blobDataUrl(source);
    const bitmap = await createImageBitmap(source);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    onSelect(asset, { dataUrl, ...dimensions });
  };
  fileInput.addEventListener("change", () => void run(async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Escolha um PNG ou JPEG de até 5 MB.");
    const bitmap = await createImageBitmap(file);
    const valid = bitmap.width <= 8192 && bitmap.height <= 8192 && bitmap.width * bitmap.height <= 20_000_000; bitmap.close();
    if (!valid) throw new Error("A imagem deve ter até 8192 pixels por lado e 20 megapixels.");
    const response = await imageRequest(`/api/v1/assets/images?name=${encodeURIComponent(file.name.slice(0, 160))}`, file);
    const { asset } = await response.json() as { asset: ImageAsset };
    await select(asset, file);
  }));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  void api<{ items: ImageAsset[] }>("/api/v1/assets/images").then(({ items }) => {
    if (!dialog.isConnected) return;
    const library = dialog.querySelector("#assetLibrary")!;
    if (!items.length) { library.textContent = "Nenhuma imagem enviada ainda."; return; }
    for (const asset of items) {
      const button = document.createElement("button"); button.type = "button"; button.className = "asset-choice";
      button.textContent = asset.name;
      button.addEventListener("click", () => void run(() => select(asset))); library.append(button);
    }
  }).catch(error => { if (!busy) status.textContent = String(error.message); });
}

export function present(content: PresentationContent, assets: RenderAssets, startIndex = 0): void {
  const dialog = document.createElement("dialog"); dialog.className = "presenter";
  dialog.innerHTML = `<div class="presenter-toolbar"><button class="button secondary" id="exitPresentation">Fechar</button><span id="presentationPosition" aria-live="polite"></span><button class="button secondary" id="fullscreen">Tela cheia</button></div><div id="presentationStage" class="presentation-stage"></div><div class="presenter-controls"><button class="button secondary" id="previousSlide">Anterior</button><button class="button secondary" id="nextSlide">Próximo</button></div>`;
  let index = startIndex;
  const previous = dialog.querySelector<HTMLButtonElement>("#previousSlide")!, next = dialog.querySelector<HTMLButtonElement>("#nextSlide")!;
  const draw = () => {
    dialog.querySelector("#presentationStage")!.innerHTML = renderSlideHtml(content.slides[index]!, index, assets);
    dialog.querySelector("#presentationPosition")!.textContent = `${index + 1} / ${content.slides.length}`;
    previous.disabled = index === 0; next.disabled = index === content.slides.length - 1;
  };
  const move = (step: number) => { index = Math.max(0, Math.min(content.slides.length - 1, index + step)); draw(); };
  previous.onclick = () => move(-1); next.onclick = () => move(1);
  dialog.querySelector<HTMLButtonElement>("#exitPresentation")!.onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>("#fullscreen")!.onclick = () => { void (document.fullscreenElement ? document.exitFullscreen() : dialog.requestFullscreen()).catch(() => {}); };
  dialog.addEventListener("keydown", event => {
    if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); move(1); }
    if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); move(-1); }
    if (event.key === "Home") { event.preventDefault(); index = 0; draw(); }
    if (event.key === "End") { event.preventDefault(); index = content.slides.length - 1; draw(); }
  });
  dialog.addEventListener("close", () => { if (document.fullscreenElement === dialog) void document.exitFullscreen().catch(() => {}); dialog.remove(); });
  document.body.append(dialog); draw(); dialog.showModal();
}
