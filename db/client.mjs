import pg from "pg";

const { Pool } = pg;

let pool;

export function getDatabaseConfig(source = process.env) {
  const connectionString = source.DATABASE_URL?.trim();
  return {
    connectionString,
    configured: Boolean(connectionString),
  };
}

export function getPool(source = process.env) {
  const config = getDatabaseConfig(source);
  if (!config.configured) return undefined;
  pool ??= new Pool({ connectionString: config.connectionString });
  return pool;
}

export async function checkDatabase(source = process.env) {
  const config = getDatabaseConfig(source);
  if (!config.configured) return { configured: false, reachable: false };
  const database = getPool(source);
  if (!database) return { configured: true, reachable: false };
  const result = await database.query("select current_database() as database, now() as checked_at");
  return { configured: true, reachable: true, database: result.rows[0]?.database, checkedAt: result.rows[0]?.checked_at };
}
