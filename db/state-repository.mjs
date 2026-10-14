import { getPool } from "./client.mjs";

export async function readState(source = process.env) {
  const pool = getPool(source);
  if (!pool) return { configured: false, hasData: false, teams: [], components: [], releases: [] };

  const [teams, components, releases] = await Promise.all([
    pool.query("select data from teams order by updated_at asc"),
    pool.query("select data from components order by updated_at asc"),
    pool.query("select data from releases order by updated_at asc"),
  ]);

  return {
    configured: true,
    hasData: teams.rowCount > 0 || components.rowCount > 0 || releases.rowCount > 0,
    teams: teams.rows.map((row) => row.data),
    components: components.rows.map((row) => row.data),
    releases: releases.rows.map((row) => row.data),
  };
}

export async function writeState(state, source = process.env) {
  const pool = getPool(source);
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured");
    error.status = 503;
    throw error;
  }

  const teams = ensureArray(state?.teams, "teams");
  const components = ensureArray(state?.components, "components");
  const releases = ensureArray(state?.releases, "releases");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await replaceRows(client, "teams", teams);
    await replaceRows(client, "components", components);
    await replaceRows(client, "releases", releases);
    await replacePlanVersions(client, releases);
    await replaceChangeEvents(client, releases);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return { configured: true, saved: true, counts: { teams: teams.length, components: components.length, releases: releases.length } };
}

function ensureArray(value, name) {
  if (!Array.isArray(value)) {
    const error = new Error(`${name} must be an array`);
    error.status = 400;
    throw error;
  }
  return value;
}

async function replaceRows(client, table, rows) {
  await client.query(`delete from ${table}`);
  for (const row of rows) {
    if (!row || typeof row.id !== "string") {
      const error = new Error(`${table} row must contain a string id`);
      error.status = 400;
      throw error;
    }
    await client.query(`insert into ${table} (id, data, updated_at) values ($1, $2::jsonb, now())`, [row.id, JSON.stringify(row)]);
  }
}

async function replacePlanVersions(client, releases) {
  await client.query("delete from plan_versions");
  for (const release of releases) {
    for (const version of release.planVersions ?? []) {
      await client.query(
        "insert into plan_versions (id, release_id, sequence, graph_revision, status, data, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7)",
        [version.id, release.id, version.sequence, version.graphRevision, version.status, JSON.stringify(version), version.createdAt],
      );
    }
  }
}

async function replaceChangeEvents(client, releases) {
  await client.query("delete from change_events");
  for (const release of releases) {
    for (const event of release.changeEvents ?? []) {
      await client.query(
        "insert into change_events (id, release_id, data, occurred_at, updated_at) values ($1, $2, $3::jsonb, $4, now())",
        [event.id, release.id, JSON.stringify(event), event.occurredAt],
      );
    }
  }
}
