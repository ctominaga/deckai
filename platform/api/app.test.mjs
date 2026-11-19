import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.mjs";
import { JsonDatabase } from "./database.mjs";

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deckai-api-"));
  const database = new JsonDatabase(path.join(directory, "db.json")); database.load();
  const server = createApp(database); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(`${base}${route}`, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: options.body && JSON.stringify(options.body) });
  return { database, request, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("login, versionamento e conflito otimista", async (t) => {
  const app = await fixture(); t.after(app.close);
  let response = await app.request("/api/auth/bootstrap", { method: "POST", body: { name: "Gestor", email: "gestor@jump.local", password: "senha-segura-123" } });
  assert.equal(response.status, 201);
  response = await app.request("/api/auth/login", { method: "POST", body: { email: "gestor@jump.local", password: "senha-segura-123" } });
  const { token } = await response.json(); const auth = { authorization: `Bearer ${token}` };
  const content = { schemaVersion: "1.0", slides: [{ slideId: "slide_1", layout: "cover", blocks: [], references: [] }] };
  response = await app.request("/api/presentations", { method: "POST", headers: auth, body: { title: "Piloto", content } });
  const presentation = await response.json(); assert.equal(response.status, 201);
  response = await app.request(`/api/presentations/${presentation.presentationId}/versions`, { method: "POST", headers: auth, body: { baseVersionId: presentation.currentVersionId, content } });
  assert.equal(response.status, 201);
  response = await app.request(`/api/presentations/${presentation.presentationId}/versions`, { method: "POST", headers: auth, body: { baseVersionId: presentation.currentVersionId, content } });
  assert.equal(response.status, 409);
});

test("somente conteúdo Jump aprovado e válido fica disponível para IA", async (t) => {
  const app = await fixture(); t.after(app.close);
  await app.request("/api/auth/bootstrap", { method: "POST", body: { name: "Gestor", email: "gestor@jump.local", password: "senha-segura-123" } });
  const login = await app.request("/api/auth/login", { method: "POST", body: { email: "gestor@jump.local", password: "senha-segura-123" } });
  const { token } = await login.json(); const auth = { authorization: `Bearer ${token}` };
  let response = await app.request("/api/jump-contents", { method: "POST", headers: auth, body: { title: "Serviço", category: "service", content: "Conteúdo confirmado", source: "Documento institucional", validUntil: "2099-01-01" } });
  const item = await response.json();
  await app.request(`/api/jump-contents/${item.contentId}/submit`, { method: "POST", headers: auth });
  await app.request(`/api/jump-contents/${item.contentId}/approve`, { method: "POST", headers: auth });
  response = await app.request("/api/jump-contents?availability=ai", { headers: auth });
  const result = await response.json(); assert.equal(result.items.length, 1); assert.equal(result.items[0].status, "approved");
});
