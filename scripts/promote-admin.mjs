import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

const email = process.argv[2]?.trim().toLowerCase();
if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Penggunaan: npm run admin:promote -- admin@example.com");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL wajib diisi.");
  process.exit(1);
}

async function promote(client) {
  const result = await client.query("SELECT id, email, role FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user) throw new Error(`Akun ${email} belum terdaftar. Masuk sekali melalui Google terlebih dahulu.`);
  if (user.role === "admin") return false;
  await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
  await client.query(
    "INSERT INTO audit_logs (id, user_id, action, metadata) VALUES ($1, $2, 'admin.role_promoted', $3)",
    [randomUUID(), user.id, { source: "provisioning-cli", email }],
  );
  return true;
}

async function runPglite() {
  const dataDir = path.resolve(process.cwd(), connectionString.slice("pglite://".length));
  mkdirSync(dataDir, { recursive: true });
  const database = await PGlite.create(dataDir);
  try {
    return await database.transaction((transaction) => promote(transaction));
  } finally {
    await database.close();
  }
}

async function runPostgres() {
  const client = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const changed = await promote(client);
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

try {
  const changed = connectionString.startsWith("pglite://") ? await runPglite() : await runPostgres();
  console.log(changed ? `${email} berhasil dipromosikan menjadi admin.` : `${email} sudah memiliki role admin.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Provisioning admin gagal.");
  process.exit(1);
}
