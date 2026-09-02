import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL wajib diisi.");
  process.exit(1);
}

const sql = await readFile(path.join(process.cwd(), "database", "schema.sql"), "utf8");
if (connectionString.startsWith("pglite://")) {
  const dataDir = path.resolve(process.cwd(), connectionString.slice("pglite://".length));
  mkdirSync(dataDir, { recursive: true });
  const client = await PGlite.create(dataDir);
  try {
    await client.exec(sql);
    console.log(`Migrasi database lokal selesai: ${dataDir}`);
  } finally {
    await client.close();
  }
} else {
  const client = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  });
  try {
    await client.connect();
    await client.query(sql);
    console.log("Migrasi PostgreSQL selesai.");
  } finally {
    await client.end();
  }
}
