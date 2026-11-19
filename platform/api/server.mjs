import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { JsonDatabase } from "./database.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.DECKAI_DATABASE_PATH ?? path.join(here, "../../private-data/deckai-development.json");
const database = new JsonDatabase(databasePath);
database.load();

const port = Number(process.env.PORT ?? 8788);
createApp(database).listen(port, "127.0.0.1", () => {
  console.log(`Deck AI API: http://127.0.0.1:${port}`);
  console.log(`Persistência de desenvolvimento: ${databasePath}`);
});
