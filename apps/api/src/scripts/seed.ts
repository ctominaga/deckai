import { randomUUID } from "node:crypto";
import { initialPresentationContent } from "@deckai/contracts";
import { audit } from "../audit.js";
import { createDatabase } from "../database.js";
import { runMigrations } from "../migrations.js";
import { contentHash, hashPassword } from "../security.js";

if (process.env.NODE_ENV === "production") throw new Error("O seed de desenvolvimento não pode rodar em produção.");
const database = createDatabase();
try {
  await runMigrations(database);
  const count = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  if (Number(count.rows[0]?.count) > 0) { console.log("Seed ignorado: já existem usuários."); process.exitCode = 0; }
  else {
    await database.transaction(async (tx) => {
      const organizationId = randomUUID(), userId = randomUUID(), themeId = randomUUID(), presentationId = randomUUID(), versionId = randomUUID(), mutationId = randomUUID();
      const content = initialPresentationContent(themeId);
      content.slides[0]!.blocks = [
        { id: randomUUID(), type: "text", role: "title", text: "Deck AI começa por uma história clara" },
        { id: randomUUID(), type: "text", role: "subtitle", text: "Uma apresentação persistida, editável e versionada." }
      ];
      await tx.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Jump Label','jump-label')", [organizationId]);
      await tx.query("INSERT INTO users (id,organization_id,name,email,password_hash,role) VALUES ($1,$2,'Gestor local','dev@deckai.local',$3,'owner')", [userId, organizationId, await hashPassword("DeckAI-dev-2026")]);
      await tx.query("INSERT INTO themes (id,organization_id,name,tokens,is_default) VALUES ($1,$2,'Jump padrão',$3::jsonb,true)", [themeId, organizationId, JSON.stringify({ color: { background: "#f3f1e9", ink: "#171717", accent: "#d7ff45" } })]);
      await tx.query("INSERT INTO presentations (id,organization_id,title,created_by) VALUES ($1,$2,'Apresentação de boas-vindas',$3)", [presentationId, organizationId, userId]);
      await tx.query("INSERT INTO presentation_versions (id,organization_id,presentation_id,version_number,schema_version,state,content_json,content_hash,client_mutation_id,created_by) VALUES ($1,$2,$3,1,'1.0','checkpoint',$4::jsonb,$5,$6,$7)", [versionId, organizationId, presentationId, JSON.stringify(content), contentHash(content), mutationId, userId]);
      await tx.query("UPDATE presentations SET current_version_id=$1 WHERE id=$2", [versionId, presentationId]);
      await tx.query("INSERT INTO presentation_drafts (presentation_id,organization_id,base_version_id,revision,content_json,last_mutation_id,updated_by) VALUES ($1,$2,$3,1,$4::jsonb,$5,$6)", [presentationId, organizationId, versionId, JSON.stringify(content), mutationId, userId]);
      await tx.query("UPDATE installation_state SET bootstrapped=true WHERE id=1");
      await audit(tx, { organizationId, actorId: userId, action: "development.seed", entityType: "organization", entityId: organizationId });
    });
    console.log("Seed criado. Login: dev@deckai.local / DeckAI-dev-2026");
  }
} finally { await database.close(); }
