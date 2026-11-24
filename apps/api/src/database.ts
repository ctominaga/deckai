import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

export interface QueryResult<T> { rows: T[]; }
export interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(work: (database: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PGliteDatabase implements Database {
  // PGlite e Transaction expõem a mesma API de query/exec, mas os tipos da
  // biblioteca não compartilham uma interface pública. O cast fica isolado aqui.
  constructor(private readonly client: PGlite | any, private readonly releaseLock?: () => void) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.client.query(sql, params) as { rows: T[] };
    return { rows: result.rows };
  }
  async exec(sql: string): Promise<void> { await this.client.exec(sql); }
  async transaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
    return this.client.transaction(async (transaction: unknown) => work(new PGliteDatabase(transaction)));
  }
  async close(): Promise<void> { try { await this.client.close(); } finally { this.releaseLock?.(); } }
}

class PgDatabase implements Database {
  constructor(private readonly pool: pg.Pool, private readonly client?: pg.PoolClient) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await (this.client ?? this.pool).query(sql, params);
    return { rows: result.rows as T[] };
  }
  async exec(sql: string): Promise<void> { await (this.client ?? this.pool).query(sql); }
  async transaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PgDatabase(this.pool, client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async close(): Promise<void> { if (!this.client) await this.pool.end(); }
}

export function createDatabase(options: { databaseUrl?: string; dataDir?: string } = {}): Database {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl) return new PgDatabase(new pg.Pool({ connectionString: databaseUrl, max: 10 }));
  const dataDir = options.dataDir ?? process.env.DECKAI_DATA_DIR ?? "private-data/deckai-pg";
  const resolvedDataDir = path.resolve(dataDir);
  fs.mkdirSync(path.dirname(resolvedDataDir), { recursive: true });
  const lockPath = `${resolvedDataDir}.lock`;
  if (fs.existsSync(lockPath)) {
    const owner = Number(fs.readFileSync(lockPath, "utf8"));
    let alive = false;
    try { if (owner > 0) { process.kill(owner, 0); alive = true; } } catch { alive = false; }
    if (alive) throw new Error(`DATABASE_IN_USE:${owner}`);
    fs.rmSync(lockPath, { force: true });
  }
  const lock = fs.openSync(lockPath, "wx");
  fs.writeFileSync(lock, String(process.pid));
  fs.closeSync(lock);
  const stalePostmaster = path.join(resolvedDataDir, "postmaster.pid");
  if (fs.existsSync(stalePostmaster)) fs.rmSync(stalePostmaster, { force: true });
  const releaseLock = () => fs.rmSync(lockPath, { force: true });
  try { return new PGliteDatabase(new PGlite(resolvedDataDir), releaseLock); }
  catch (error) { releaseLock(); throw error; }
}

export function createMemoryDatabase(): Database { return new PGliteDatabase(new PGlite()); }
