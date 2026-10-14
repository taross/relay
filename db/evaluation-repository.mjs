import { getPool } from "./client.mjs";

export async function writeConstraintEvaluations(releaseId, evaluations, source = process.env) {
  const pool = getPool(source);
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured");
    error.status = 503;
    throw error;
  }
  if (!releaseId || typeof releaseId !== "string") {
    const error = new Error("releaseId is required");
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(evaluations)) {
    const error = new Error("evaluations must be an array");
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const evaluation of evaluations) {
      await client.query(
        "insert into constraint_evaluations (release_id, constraint_id, result, severity, data, evaluated_at) values ($1, $2, $3, $4, $5::jsonb, $6)",
        [releaseId, evaluation.constraintId, evaluation.result, evaluation.severity, JSON.stringify(evaluation), evaluation.evaluatedAt ?? new Date().toISOString()],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return { saved: true, count: evaluations.length };
}
