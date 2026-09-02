import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Pool, type QueryResultRow } from "pg";
import { embeddedDataDir, getEnv, isEmbeddedDatabaseUrl } from "./env";

type DatabaseResult<T extends QueryResultRow> = { rows: T[]; rowCount?: number | null };

export type DatabaseClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<DatabaseResult<T>>;
};

type DatabaseGlobals = typeof globalThis & {
  routerChatPglite?: Promise<PGlite>;
};

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const { databaseUrl, databaseSsl } = getEnv();
    if (!databaseUrl) throw new Error("DATABASE_URL belum dikonfigurasi.");
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      ssl: databaseSsl ? { rejectUnauthorized: true } : false,
    });
  }
  return pool;
}

function getEmbeddedDatabase(databaseUrl: string): Promise<PGlite> {
  const globals = globalThis as DatabaseGlobals;
  // ponytail: PGlite is single-connection; use PostgreSQL when multiple app instances are needed.
  const dataDir = embeddedDataDir(databaseUrl);
  mkdirSync(dataDir, { recursive: true });
  globals.routerChatPglite ??= PGlite.create(dataDir);
  return globals.routerChatPglite;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<DatabaseResult<T>> {
  const { databaseUrl } = getEnv();
  if (!databaseUrl) throw new Error("DATABASE_URL belum dikonfigurasi.");
  if (isEmbeddedDatabaseUrl(databaseUrl)) {
    return (await getEmbeddedDatabase(databaseUrl)).query<T>(text, values);
  }
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const { databaseUrl } = getEnv();
  if (!databaseUrl) throw new Error("DATABASE_URL belum dikonfigurasi.");
  if (isEmbeddedDatabaseUrl(databaseUrl)) {
    const database = await getEmbeddedDatabase(databaseUrl);
    return database.transaction((transaction) => work({
      query: (text, values = []) => transaction.query(text, values),
    }));
  }

  const client = await getPool().connect();
  const databaseClient: DatabaseClient = {
    query: (text, values = []) => client.query(text, values),
  };
  try {
    await client.query("BEGIN");
    const result = await work(databaseClient);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
