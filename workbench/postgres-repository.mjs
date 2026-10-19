import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDatabaseConfig } from "../db/client.mjs";
import { WorkbenchError } from "./domain.mjs";

const { Pool } = pg;

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    featureCount: Number(row.feature_count ?? 0),
  };
}

function mapFeature(row) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    summary: row.summary,
    reviewState: row.requirements_review_state,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function notFound(name) {
  throw new WorkbenchError(`${name} was not found.`, 404, "NOT_FOUND");
}

async function impactPhase2Baselines(client, featureId) {
  const artifacts = await client.query(
    `SELECT DISTINCT ON (b.phase) b.id FROM workbench_feature_artifact_baselines b
     WHERE b.feature_id=$1
       AND COALESCE((SELECT e.validity FROM workbench_feature_artifact_validity_events e WHERE e.baseline_id=b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1), b.validity) <> 'Impacted'
     ORDER BY b.phase, b.baseline_number DESC`,
    [featureId],
  );
  for (const baseline of artifacts.rows) await client.query(
    "INSERT INTO workbench_feature_artifact_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Impacted','Requirements changed, so this downstream baseline requires evaluation.')",
    [randomUUID(), baseline.id],
  );
  const readiness = await client.query(
    `SELECT b.id FROM workbench_delivery_readiness_baselines b
     WHERE b.feature_id=$1
       AND COALESCE((SELECT e.validity FROM workbench_delivery_readiness_validity_events e WHERE e.baseline_id=b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1), b.validity) <> 'Impacted'
     ORDER BY b.baseline_number DESC LIMIT 1`,
    [featureId],
  );
  if (readiness.rows[0]) await client.query(
    "INSERT INTO workbench_delivery_readiness_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Impacted','Requirements changed after Delivery Readiness approval.')",
    [randomUUID(), readiness.rows[0].id],
  );
}

export class PostgresWorkbenchRepository {
  constructor(source) {
    const config = getDatabaseConfig(source);
    this.configured = config.configured;
    this.pool = config.configured ? new Pool({ connectionString: config.connectionString, max: 10 }) : null;
  }

  requirePool() {
    if (!this.pool) throw new WorkbenchError("PostgreSQL is not configured for the Software Delivery Workbench.", 503, "DATABASE_NOT_CONFIGURED");
    return this.pool;
  }

  async close() {
    await this.pool?.end();
    this.pool = null;
  }

  async listProducts() {
    const result = await this.requirePool().query(`
      SELECT p.*, count(f.id)::integer AS feature_count
      FROM workbench_products p
      LEFT JOIN workbench_features f ON f.product_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id`);
    return result.rows.map(mapProduct);
  }

  async getProduct(productId) {
    const productResult = await this.requirePool().query("SELECT * FROM workbench_products WHERE id = $1", [productId]);
    if (!productResult.rows[0]) notFound("Product");
    const features = await this.requirePool().query("SELECT * FROM workbench_features WHERE product_id = $1 ORDER BY updated_at DESC, id", [productId]);
    return { ...mapProduct(productResult.rows[0]), features: features.rows.map(mapFeature) };
  }

  async getFeatureWorkspace(featureId) {
    return this.#readWorkspace(this.requirePool(), featureId);
  }

  async runCommand(commandId, operation, requestHash, task) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [commandId]);
      const receipt = await client.query("SELECT operation, request_hash, response_status, response_body FROM workbench_command_receipts WHERE command_id = $1", [commandId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].operation !== operation || receipt.rows[0].request_hash !== requestHash) {
          throw new WorkbenchError("The idempotency key was already used for a different command payload.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        await client.query("COMMIT");
        return { replayed: true, status: receipt.rows[0].response_status, body: receipt.rows[0].response_body };
      }
      const tx = this.#transaction(client);
      const result = await task(tx);
      const status = result.status ?? 200;
      const body = result.body ?? result;
      await client.query(
        "INSERT INTO workbench_command_receipts (command_id, operation, request_hash, response_status, response_body) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [commandId, operation, requestHash, status, JSON.stringify(body)],
      );
      await client.query("COMMIT");
      return { replayed: false, status, body };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.code === "23505") throw new WorkbenchError("A resource with the same identity already exists.", 409, "DUPLICATE_RESOURCE");
      throw error;
    } finally {
      client.release();
    }
  }

  #transaction(client) {
    return {
      createProduct: async ({ id = randomUUID(), name, description }) => {
        const result = await client.query(
          "INSERT INTO workbench_products (id, name, description) VALUES ($1, $2, $3) RETURNING *",
          [id, name, description],
        );
        return mapProduct(result.rows[0]);
      },
      lockProduct: async (id) => {
        const result = await client.query("SELECT * FROM workbench_products WHERE id = $1 FOR UPDATE", [id]);
        if (!result.rows[0]) notFound("Product");
        return mapProduct(result.rows[0]);
      },
      createFeature: async ({ id = randomUUID(), productId, name, summary }) => {
        const result = await client.query(
          "INSERT INTO workbench_features (id, product_id, name, summary) VALUES ($1, $2, $3, $4) RETURNING *",
          [id, productId, name, summary],
        );
        await client.query("UPDATE workbench_products SET version = version + 1, updated_at = now() WHERE id = $1", [productId]);
        return mapFeature(result.rows[0]);
      },
      lockFeature: async (id) => {
        const result = await client.query("SELECT * FROM workbench_features WHERE id = $1 FOR UPDATE", [id]);
        if (!result.rows[0]) notFound("Feature");
        return mapFeature(result.rows[0]);
      },
      addSource: async ({ id = randomUUID(), featureId, content, provenance }) => {
        const result = await client.query(
          "INSERT INTO workbench_requirement_sources (id, feature_id, content, provenance) VALUES ($1, $2, $3, $4) RETURNING *",
          [id, featureId, content, provenance],
        );
        return { id: result.rows[0].id, featureId: result.rows[0].feature_id, content: result.rows[0].content, provenance: result.rows[0].provenance, createdAt: result.rows[0].created_at };
      },
      getSource: async (id, featureId) => {
        const result = await client.query("SELECT * FROM workbench_requirement_sources WHERE id = $1 AND feature_id = $2", [id, featureId]);
        if (!result.rows[0]) notFound("Requirement source");
        return result.rows[0];
      },
      createCandidate: async ({ id = randomUUID(), featureId, sourceId, externalKey, title, text }) => {
        const result = await client.query(
          `INSERT INTO workbench_requirement_candidates
           (id, feature_id, source_id, external_key, title, requirement_text)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [id, featureId, sourceId, externalKey, title, text],
        );
        return mapCandidate(result.rows[0]);
      },
      lockCandidate: async (id, featureId) => {
        const result = await client.query("SELECT * FROM workbench_requirement_candidates WHERE id = $1 AND feature_id = $2 FOR UPDATE", [id, featureId]);
        if (!result.rows[0]) notFound("Requirement candidate");
        return mapCandidate(result.rows[0]);
      },
      updateCandidate: async ({ id, externalKey, title, text, rationale }) => {
        const result = await client.query(
          `UPDATE workbench_requirement_candidates
           SET external_key = $2, title = $3, requirement_text = $4,
               decision_rationale = COALESCE($5, decision_rationale), version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, externalKey, title, text, rationale ?? null],
        );
        return mapCandidate(result.rows[0]);
      },
      rejectCandidate: async ({ id, rationale }) => {
        const result = await client.query(
          `UPDATE workbench_requirement_candidates
           SET status = 'Rejected', decision_rationale = $2, version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, rationale],
        );
        return mapCandidate(result.rows[0]);
      },
      acceptCandidate: async ({ candidate, referenceKeys, conflicts }) => {
        const requirementId = randomUUID();
        const revisionId = randomUUID();
        await client.query(
          "INSERT INTO workbench_requirements (id, feature_id, external_key) VALUES ($1, $2, $3)",
          [requirementId, candidate.featureId, candidate.externalKey],
        );
        const revisionResult = await client.query(
          `INSERT INTO workbench_requirement_revisions
           (id, requirement_id, external_key, revision_number, title, requirement_text)
           VALUES ($1, $2, $3, 1, $4, $5) RETURNING *`,
          [revisionId, requirementId, candidate.externalKey, candidate.title, candidate.text],
        );
        await replaceLinks(client, revisionId, referenceKeys, conflicts);
        await client.query(
          `UPDATE workbench_requirement_candidates
           SET status = 'Accepted', accepted_requirement_id = $2, decision_rationale = $3,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [candidate.id, requirementId, candidate.decisionRationale],
        );
        return mapRevision(revisionResult.rows[0], candidate.externalKey, referenceKeys, conflicts);
      },
      lockRevision: async (revisionId, featureId) => {
        const result = await client.query(
          `SELECT rr.*, r.feature_id
           FROM workbench_requirement_revisions rr
           JOIN workbench_requirements r ON r.id = rr.requirement_id
           WHERE rr.id = $1 AND r.feature_id = $2 FOR UPDATE OF rr`,
          [revisionId, featureId],
        );
        if (!result.rows[0]) notFound("Requirement revision");
        return mapRevision(result.rows[0], result.rows[0].external_key, [], []);
      },
      editRevision: async ({ revision, title, text, externalKey, referenceKeys, conflicts }) => {
        let revisionResult;
        if (revision.state === "Draft") {
          revisionResult = await client.query(
            `UPDATE workbench_requirement_revisions
             SET external_key = $2, title = $3, requirement_text = $4, version = version + 1
             WHERE id = $1 RETURNING *`,
            [revision.id, externalKey, title, text],
          );
          await client.query("UPDATE workbench_requirements SET external_key = $2 WHERE id = $1", [revision.requirementId, externalKey]);
          await replaceLinks(client, revision.id, referenceKeys, conflicts);
        } else if (revision.state === "Approved") {
          const id = randomUUID();
          await client.query("UPDATE workbench_requirement_revisions SET revision_state = 'Superseded' WHERE id = $1", [revision.id]);
          revisionResult = await client.query(
            `INSERT INTO workbench_requirement_revisions
             (id, requirement_id, external_key, revision_number, title, requirement_text, predecessor_revision_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, revision.requirementId, externalKey, revision.revisionNumber + 1, title, text, revision.id],
          );
          await client.query("UPDATE workbench_requirements SET external_key = $2 WHERE id = $1", [revision.requirementId, externalKey]);
          await replaceLinks(client, id, referenceKeys, conflicts);
          await client.query(
            `INSERT INTO workbench_requirement_baseline_validity_events (id, baseline_id, validity, rationale)
             SELECT $2, b.id, 'Impacted', 'A successor Requirement revision was created after approval.'
             FROM workbench_requirement_baselines b
             WHERE b.feature_id = (SELECT feature_id FROM workbench_requirements WHERE id = $1)
               AND COALESCE((
                 SELECT e.validity FROM workbench_requirement_baseline_validity_events e
                 WHERE e.baseline_id = b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1
               ), b.validity) <> 'Impacted'
             ORDER BY b.baseline_number DESC LIMIT 1`,
            [revision.requirementId, randomUUID()],
          );
        } else {
          throw new WorkbenchError("A superseded requirement revision cannot be edited.", 409, "IMMUTABLE_REVISION");
        }
        return mapRevision(revisionResult.rows[0], externalKey, referenceKeys, conflicts);
      },
      bumpFeatureDraft: async (featureId, currentState) => {
        await impactPhase2Baselines(client, featureId);
        if (currentState === "Approved") {
          await client.query(
            `INSERT INTO workbench_requirement_baseline_validity_events (id, baseline_id, validity, rationale)
             SELECT $2, b.id, 'Impacted', 'Requirements work changed after approval.'
             FROM workbench_requirement_baselines b
             WHERE b.feature_id = $1
               AND COALESCE((
                 SELECT e.validity FROM workbench_requirement_baseline_validity_events e
                 WHERE e.baseline_id = b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1
               ), b.validity) <> 'Impacted'
             ORDER BY b.baseline_number DESC LIMIT 1`,
            [featureId, randomUUID()],
          );
        }
        const nextState = currentState === "Not Started" || currentState === "Approved" || currentState === "Changes Requested" ? "Draft" : currentState;
        const result = await client.query(
          "UPDATE workbench_features SET requirements_review_state = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
          [featureId, nextState],
        );
        return mapFeature(result.rows[0]);
      },
      setReviewState: async ({ featureId, fromState, toState, actorName, rationale }) => {
        const result = await client.query(
          "UPDATE workbench_features SET requirements_review_state = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
          [featureId, toState],
        );
        await client.query(
          `INSERT INTO workbench_review_events (id, feature_id, from_state, to_state, actor_name, rationale)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), featureId, fromState, toState, actorName, rationale],
        );
        return mapFeature(result.rows[0]);
      },
      readSnapshot: async (featureId) => readSnapshot(client, featureId),
      saveValidation: async (featureId, featureVersion, findings) => saveValidation(client, featureId, featureVersion, findings),
      approveBaseline: async ({ feature, validationRunId, actorName, rationale, warningRationale }) => {
        const count = await client.query("SELECT count(*)::integer AS count FROM workbench_requirement_baselines WHERE feature_id = $1", [feature.id]);
        const baselineId = randomUUID();
        const baselineNumber = Number(count.rows[0].count) + 1;
        await client.query(
          `INSERT INTO workbench_requirement_baselines
           (id, feature_id, baseline_number, validity, validation_run_id)
           VALUES ($1, $2, $3, 'Current', $4)`,
          [baselineId, feature.id, baselineNumber, validationRunId],
        );
        const revisions = await client.query(
          `SELECT DISTINCT ON (r.id) rr.id, rr.revision_state
           FROM workbench_requirements r
           JOIN workbench_requirement_revisions rr ON rr.requirement_id = r.id
           WHERE r.feature_id = $1
           ORDER BY r.id, rr.revision_number DESC`,
          [feature.id],
        );
        for (const revision of revisions.rows) {
          if (revision.revision_state !== "Draft") throw new WorkbenchError("Only a complete draft revision set can be approved.", 409, "IMMUTABLE_REVISION");
          await client.query("UPDATE workbench_requirement_revisions SET revision_state = 'Approved' WHERE id = $1", [revision.id]);
          await client.query("INSERT INTO workbench_requirement_baseline_items (baseline_id, revision_id) VALUES ($1, $2)", [baselineId, revision.id]);
        }
        const approvalId = randomUUID();
        await client.query(
          `INSERT INTO workbench_requirement_baseline_validity_events (id, baseline_id, validity, rationale)
           VALUES ($1, $2, 'Current', 'The Requirements phase was approved with this frozen revision set.')`,
          [randomUUID(), baselineId],
        );
        await client.query(
          `INSERT INTO workbench_requirement_approvals
           (id, baseline_id, actor_name, rationale, warning_rationale)
           VALUES ($1, $2, $3, $4, $5)`,
          [approvalId, baselineId, actorName, rationale, warningRationale || null],
        );
        const updatedFeature = await client.query(
          "UPDATE workbench_features SET requirements_review_state = 'Approved', version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
          [feature.id],
        );
        await client.query(
          `INSERT INTO workbench_review_events (id, feature_id, from_state, to_state, actor_name, rationale)
           VALUES ($1, $2, $3, 'Approved', $4, $5)`,
          [randomUUID(), feature.id, feature.reviewState, actorName, rationale],
        );
        return { id: baselineId, baselineNumber, validity: "Current", approvalId, feature: mapFeature(updatedFeature.rows[0]) };
      },
    };
  }

  async #readWorkspace(client, featureId) {
    const featureResult = await client.query(
      `SELECT f.*, p.name AS product_name, p.version AS product_version
       FROM workbench_features f JOIN workbench_products p ON p.id = f.product_id
       WHERE f.id = $1`,
      [featureId],
    );
    if (!featureResult.rows[0]) notFound("Feature");
    const feature = mapFeature(featureResult.rows[0]);
    const [sources, candidates, snapshot, validation, baselines] = await Promise.all([
      client.query("SELECT * FROM workbench_requirement_sources WHERE feature_id = $1 ORDER BY created_at, id", [featureId]),
      client.query("SELECT * FROM workbench_requirement_candidates WHERE feature_id = $1 ORDER BY created_at, id", [featureId]),
      readSnapshot(client, featureId),
      client.query(
        `SELECT vr.id, vr.feature_version, vr.validator_version, vr.created_at,
                COALESCE(json_agg(json_build_object('id', vf.id, 'severity', vf.severity, 'code', vf.code, 'message', vf.message, 'requirementRevisionId', vf.requirement_revision_id) ORDER BY vf.id) FILTER (WHERE vf.id IS NOT NULL), '[]') AS findings
         FROM workbench_validation_runs vr
         LEFT JOIN workbench_validation_findings vf ON vf.validation_run_id = vr.id
         WHERE vr.feature_id = $1
         GROUP BY vr.id ORDER BY vr.created_at DESC LIMIT 1`,
        [featureId],
      ),
      client.query(
        `SELECT b.id, b.baseline_number, COALESCE(validity.validity, b.validity) AS validity, b.created_at,
                a.id AS approval_id, a.actor_name, a.rationale, a.warning_rationale, a.created_at AS approved_at,
                count(bi.revision_id)::integer AS revision_count
         FROM workbench_requirement_baselines b
         JOIN workbench_requirement_approvals a ON a.baseline_id = b.id
         LEFT JOIN workbench_requirement_baseline_items bi ON bi.baseline_id = b.id
         LEFT JOIN LATERAL (
           SELECT e.validity FROM workbench_requirement_baseline_validity_events e
           WHERE e.baseline_id = b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1
         ) validity ON true
         WHERE b.feature_id = $1
         GROUP BY b.id, a.id, validity.validity ORDER BY b.baseline_number DESC`,
        [featureId],
      ),
    ]);
    return {
      product: { id: feature.productId, name: featureResult.rows[0].product_name, version: featureResult.rows[0].product_version },
      feature,
      sources: sources.rows.map((row) => ({ id: row.id, featureId: row.feature_id, content: row.content, provenance: row.provenance, createdAt: row.created_at })),
      candidates: candidates.rows.map(mapCandidate),
      requirements: snapshot.requirements,
      latestValidation: validation.rows[0] ? {
        id: validation.rows[0].id,
        featureVersion: validation.rows[0].feature_version,
        validatorVersion: validation.rows[0].validator_version,
        createdAt: validation.rows[0].created_at,
        findings: validation.rows[0].findings,
      } : null,
      baselines: baselines.rows.map((row) => ({
        id: row.id,
        baselineNumber: row.baseline_number,
        validity: row.validity,
        createdAt: row.created_at,
        revisionCount: row.revision_count,
        approval: { id: row.approval_id, actorName: row.actor_name, rationale: row.rationale, warningRationale: row.warning_rationale, createdAt: row.approved_at },
      })),
    };
  }
}

function mapCandidate(row) {
  return {
    id: row.id,
    featureId: row.feature_id,
    sourceId: row.source_id,
    externalKey: row.external_key,
    title: row.title,
    text: row.requirement_text,
    status: row.status,
    decisionRationale: row.decision_rationale ?? "",
    acceptedRequirementId: row.accepted_requirement_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRevision(row, externalKey, referenceKeys, conflicts) {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    externalKey,
    revisionNumber: row.revision_number,
    title: row.title,
    text: row.requirement_text,
    state: row.revision_state,
    predecessorRevisionId: row.predecessor_revision_id,
    version: row.version,
    referenceKeys,
    conflicts,
    createdAt: row.created_at,
  };
}

async function replaceLinks(client, revisionId, referenceKeys, conflicts) {
  await client.query("DELETE FROM workbench_requirement_revision_references WHERE revision_id = $1", [revisionId]);
  await client.query("DELETE FROM workbench_requirement_revision_conflicts WHERE revision_id = $1", [revisionId]);
  for (const target of [...new Set(referenceKeys)]) {
    await client.query("INSERT INTO workbench_requirement_revision_references (revision_id, target_external_key) VALUES ($1, $2)", [revisionId, target]);
  }
  for (const conflict of conflicts) {
    await client.query(
      `INSERT INTO workbench_requirement_revision_conflicts (revision_id, target_external_key, resolved)
       VALUES ($1, $2, $3)
       ON CONFLICT (revision_id, target_external_key) DO UPDATE SET resolved = EXCLUDED.resolved`,
      [revisionId, conflict.targetExternalKey, conflict.resolved],
    );
  }
}

async function readSnapshot(client, featureId) {
  const revisions = await client.query(
    `SELECT DISTINCT ON (r.id) rr.*
     FROM workbench_requirements r
     JOIN workbench_requirement_revisions rr ON rr.requirement_id = r.id
     WHERE r.feature_id = $1
     ORDER BY r.id, rr.revision_number DESC`,
    [featureId],
  );
  const ids = revisions.rows.map((row) => row.id);
  const [references, conflicts, candidates] = await Promise.all([
    ids.length ? client.query("SELECT * FROM workbench_requirement_revision_references WHERE revision_id = ANY($1::uuid[])", [ids]) : { rows: [] },
    ids.length ? client.query("SELECT * FROM workbench_requirement_revision_conflicts WHERE revision_id = ANY($1::uuid[])", [ids]) : { rows: [] },
    client.query("SELECT id, status FROM workbench_requirement_candidates WHERE feature_id = $1", [featureId]),
  ]);
  return {
    requirements: revisions.rows.map((row) => mapRevision(
      row,
      row.external_key,
      references.rows.filter((item) => item.revision_id === row.id).map((item) => item.target_external_key),
      conflicts.rows.filter((item) => item.revision_id === row.id).map((item) => ({ targetExternalKey: item.target_external_key, resolved: item.resolved })),
    )),
    candidates: candidates.rows.map((row) => ({ id: row.id, status: row.status })),
  };
}

async function saveValidation(client, featureId, featureVersion, findings) {
  const id = randomUUID();
  const created = await client.query(
    `INSERT INTO workbench_validation_runs (id, feature_id, feature_version, validator_version)
     VALUES ($1, $2, $3, 'phase1-deterministic-v1') RETURNING *`,
    [id, featureId, featureVersion],
  );
  for (const item of findings) {
    await client.query(
      `INSERT INTO workbench_validation_findings
       (id, validation_run_id, severity, code, message, requirement_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), id, item.severity, item.code, item.message, item.requirementRevisionId],
    );
  }
  return {
    id,
    featureVersion,
    validatorVersion: "phase1-deterministic-v1",
    createdAt: created.rows[0].created_at,
    findings,
  };
}
