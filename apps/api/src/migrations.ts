import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "./database.js";

const hashSql = (sql: string) => createHash("sha256").update(sql).digest("hex");

export async function runMigrations(database: Database, directory = path.resolve("db/migrations")): Promise<string[]> {
  await database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum char(64), applied_at timestamptz NOT NULL DEFAULT now())");
  await database.exec("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)");
  await database.exec("CREATE TABLE IF NOT EXISTS schema_migration_lock (id smallint PRIMARY KEY CHECK (id=1))");
  await database.exec("INSERT INTO schema_migration_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const applied: string[] = [];
  await database.transaction(async (tx) => {
    await tx.query("SELECT id FROM schema_migration_lock WHERE id=1 FOR UPDATE");
    for (const file of files) {
      const sql = (await fs.readFile(path.join(directory, file), "utf8")).replace(/\r\n/g, "\n");
      const checksum = hashSql(sql);
      const existing = await tx.query<{ version: string; checksum: string | null }>("SELECT version,checksum FROM schema_migrations WHERE version = $1", [file]);
      if (existing.rows[0]) {
        const storedChecksum = existing.rows[0].checksum;
        // Older installations recorded the hash of the working-tree line endings.
        if (storedChecksum && storedChecksum !== checksum && storedChecksum !== hashSql(sql.replace(/\n/g, "\r\n"))) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${file}`);
        }
        if (!existing.rows[0].checksum) await tx.query("UPDATE schema_migrations SET checksum=$1 WHERE version=$2", [checksum, file]);
        continue;
      }
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)", [file, checksum]);
      applied.push(file);
    }
  });
  return applied;
}
