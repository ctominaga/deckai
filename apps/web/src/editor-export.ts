import type { ExportJob } from "@deckai/contracts";
import { api, session } from "./api.js";

export function showExportDialog(presentationId: string, prepareVersion: () => Promise<string>): void {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.innerHTML = `<form>
    <h2>Exportar apresentação</h2>
    <label class="field">Formato<select name="format"><option value="pdf">PDF</option><option value="pptx">PowerPoint editável</option></select></label>
    <p role="status"></p>
    <div class="dialog-actions"><button type="button" class="button secondary">Fechar</button><button class="button" type="submit">Gerar arquivo</button></div>
  </form>`;
  const form = dialog.querySelector("form")!;
  const select = form.querySelector("select")!;
  const status = form.querySelector<HTMLElement>('[role="status"]')!;
  const close = form.querySelector<HTMLButtonElement>('[type="button"]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const abort = new AbortController();
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => { abort.abort(); dialog.remove(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = select.disabled = true;
    const format = select.value === "pptx" ? "pptx" : "pdf";
    try {
      status.textContent = "Salvando versão…";
      const versionId = await prepareVersion();
      abort.signal.throwIfAborted();
      const { job } = await api<{ job: ExportJob }>(`/api/v1/presentations/${presentationId}/exports/${format}`, {
        method: "POST", body: { versionId, idempotencyKey: crypto.randomUUID() }, signal: abort.signal
      });
      let state = job.status;
      const jobPath = `/api/v1/exports/${job.id}`;
      for (let count = 0; count < 90 && ["queued", "running", "retrying"].includes(state); count++) {
        status.textContent = state === "running" ? "Gerando arquivo…" : state === "retrying" ? "Tentando novamente…" : "Na fila…";
        await new Promise(resolve => setTimeout(resolve, 1000));
        abort.signal.throwIfAborted();
        state = (await api<{ job: ExportJob }>(jobPath, { signal: abort.signal })).job.status;
      }
      if (state !== "succeeded") throw new Error(
        ["queued", "running", "retrying"].includes(state) ? "A exportação continua na fila do servidor." : "A exportação falhou."
      );
      const response = await fetch(jobPath + "/download", { headers: { authorization: `Bearer ${session.token}` }, signal: abort.signal });
      if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `apresentacao.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "Arquivo enviado para download.";
    } catch (error) {
      if (!abort.signal.aborted) status.textContent = error instanceof Error ? error.message : "Falha ao exportar.";
    } finally {
      submit.disabled = select.disabled = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}
