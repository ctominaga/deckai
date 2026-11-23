import { createDatabase } from "../database.js";
import { runMigrations } from "../migrations.js";

const database = createDatabase();
try { const applied = await runMigrations(database); console.log(applied.length ? `Migrations aplicadas: ${applied.join(", ")}` : "Banco já atualizado."); }
finally { await database.close(); }
