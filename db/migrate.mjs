import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import pg from "pg";
import { getDatabaseConfig } from "./client.mjs";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(here, "migrations");

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

export async function migrate(source = process.env) {
  const config = getDatabaseConfig(source);
  if (!config.configured) throw new Error("DATABASE_URL is required to run migrations");
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('relay-workbench-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

    const names = (await readdir(migrationsDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    const migrations = await Promise.all(names.map(async (name) => {
      const sql = await readFile(join(migrationsDirectory, name), "utf8");
      return { name, sql, checksum: checksum(sql) };
    }));
    const byName = new Map(migrations.map((migration) => [migration.name, migration]));
    const appliedResult = await client.query("SELECT name, checksum FROM schema_migrations");
    const applied = new Set();
    for (const row of appliedResult.rows) {
      applied.add(row.name);
      const migration = byName.get(row.name);
      if (!migration) continue;
      if (row.checksum && row.checksum !== migration.checksum) {
        throw new Error(`Applied migration ${row.name} no longer matches its recorded checksum`);
      }
      if (!row.checksum) {
        await client.query("UPDATE schema_migrations SET checksum = $2 WHERE name = $1", [row.name, migration.checksum]);
      }
    }

    const legacyMigration = byName.get("001_vertical_slice.sql");
    if (legacyMigration && !applied.has(legacyMigration.name)) {
      const legacyTables = await client.query(`
        SELECT to_regclass('public.teams') IS NOT NULL
           AND to_regclass('public.components') IS NOT NULL
           AND to_regclass('public.releases') IS NOT NULL
           AND to_regclass('public.change_events') IS NOT NULL AS present`);
      if (legacyTables.rows[0].present) {
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [legacyMigration.name, legacyMigration.checksum],
        );
        applied.add(legacyMigration.name);
        console.log(`Recorded existing ${legacyMigration.name}`);
      }
    }

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      const sql = migration.sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        console.log(`Applied ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('relay-workbench-migrations'))").catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
