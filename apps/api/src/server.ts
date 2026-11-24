import { buildApp } from "./app.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";

const database = createDatabase();
await runMigrations(database);
const app = await buildApp(database);
const port = Number(process.env.PORT ?? 8788);
await app.listen({ host: "127.0.0.1", port });

const shutdown = async () => { await app.close(); await database.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
