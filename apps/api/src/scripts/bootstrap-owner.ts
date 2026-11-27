import { BootstrapSchema } from "@deckai/contracts";
import { buildApp } from "../app.js";
import { createDatabase } from "../database.js";
import { runMigrations } from "../migrations.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const owner = BootstrapSchema.safeParse({
  organizationName: process.env.BOOTSTRAP_ORGANIZATION,
  name: process.env.BOOTSTRAP_OWNER_NAME,
  email: process.env.BOOTSTRAP_OWNER_EMAIL,
  password: process.env.BOOTSTRAP_OWNER_PASSWORD
});
if (!owner.success) throw new Error("BOOTSTRAP_OWNER_CONFIGURATION_INVALID");

// This instance only receives the in-process bootstrap request.
process.env.ALLOW_BOOTSTRAP = "true";
const database = createDatabase();
try {
  await runMigrations(database);
  const app = await buildApp(database);
  try {
    const result = await app.inject({ method: "POST", url: "/api/v1/bootstrap", payload: owner.data });
    if (result.statusCode !== 201) throw new Error(`BOOTSTRAP_OWNER_FAILED:${result.statusCode}`);
    console.log("Conta inicial criada.");
  } finally {
    await app.close();
  }
} finally {
  await database.close();
}
