import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDatabaseConfig } from "../db/client.mjs";
import { WorkbenchError } from "./domain.mjs";

const { Pool } = pg;

function missing(name) {
  throw new WorkbenchError(`${name} was not found.`, 404, "NOT_FOUND");
}

function mapFeature(row) {
  return { id: row.id, productId: row.product_id, name: row.name, summary: row.summary, reviewState: row.requirements_review_state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function assertReferences(source, ids, query, values, message) {
  if (!ids.length) return;
  const result = await source.query(query, [...values, [...new Set(ids)]]);
  const found = new Set(result.rows.map((row) => row.id));
  if (ids.some((id) => !found.has(id))) throw new WorkbenchError(message, 409, "INVALID_REFERENCE");
}

export class Phase2PostgresRepository {
  constructor(source) {
    const config = getDatabaseConfig(source);
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

  async getWorkspace(featureId) {
    return this.#readWorkspace(this.requirePool(), featureId);
  }

  async runCommand(commandId, operation, requestHash, task) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [commandId]);
      const receipt = await client.query("SELECT operation, request_hash, response_status, response_body FROM workbench_command_receipts WHERE command_id = $1", [commandId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].operation !== operation || receipt.rows[0].request_hash !== requestHash) throw new WorkbenchError("The idempotency key was already used for a different command payload.", 409, "IDEMPOTENCY_KEY_REUSED");
        await client.query("COMMIT");
        return { replayed: true, status: receipt.rows[0].response_status, body: receipt.rows[0].response_body };
      }
      const result = await task(this.#transaction(client));
      const status = result.status ?? 200;
      const body = result.body ?? result;
      await client.query("INSERT INTO workbench_command_receipts (command_id, operation, request_hash, response_status, response_body) VALUES ($1, $2, $3, $4, $5::jsonb)", [commandId, operation, requestHash, status, JSON.stringify(body)]);
      await client.query("COMMIT");
      return { replayed: false, status, body };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.code === "23505") throw new WorkbenchError("A resource with the same identity already exists.", 409, "DUPLICATE_RESOURCE");
      if (error?.code === "23503") throw new WorkbenchError("A referenced resource does not exist or is outside this Feature.", 409, "INVALID_REFERENCE");
      throw error;
    } finally {
      client.release();
    }
  }

  #transaction(client) {
    return {
      lockFeature: async (featureId) => {
        const result = await client.query("SELECT * FROM workbench_features WHERE id = $1 FOR UPDATE", [featureId]);
        if (!result.rows[0]) missing("Feature");
        return mapFeature(result.rows[0]);
      },
      readWorkspace: (featureId) => this.#readWorkspace(client, featureId),
      saveArtifact: (input) => this.#saveArtifact(client, input),
      saveWorkPackage: (input) => this.#saveWorkPackage(client, input),
      saveDeliverable: (input) => this.#saveDeliverable(client, input),
      saveArtifactValidation: (input) => this.#saveArtifactValidation(client, input),
      setPhaseState: (input) => this.#setPhaseState(client, input),
      approveArtifact: (input) => this.#approveArtifact(client, input),
      saveReadinessValidation: (input) => this.#saveReadinessValidation(client, input),
      approveReadiness: (input) => this.#approveReadiness(client, input),
    };
  }

  async #phaseStates(source, feature) {
    const result = await source.query("SELECT * FROM workbench_feature_phase_states WHERE feature_id = $1", [feature.id]);
    const states = Object.fromEntries(result.rows.map((row) => [row.phase, { reviewState: row.review_state, version: row.version, updatedAt: row.updated_at }]));
    states.Requirements = { reviewState: feature.reviewState, version: feature.version, updatedAt: feature.updatedAt };
    for (const phase of Object.keys(PHASE_CONFIG)) states[phase] ??= { reviewState: "Not Started", version: 1, updatedAt: null };
    states["Delivery Readiness"] ??= { reviewState: "Not Started", version: 1, updatedAt: null };
    return states;
  }

  async #readWorkspace(source, featureId) {
    const featureResult = await source.query("SELECT * FROM workbench_features WHERE id = $1", [featureId]);
    if (!featureResult.rows[0]) missing("Feature");
    const feature = mapFeature(featureResult.rows[0]);
    const productResult = await source.query("SELECT id, name, version FROM workbench_products WHERE id = $1", [feature.productId]);
    const [requirements, specification, design, verificationPlan, workPackages, deliverables, artifactBaselines, readinessBaselines, latestValidations, latestReadinessValidation] = await Promise.all([
      this.#readApprovedRequirements(source, featureId),
      this.#readSpecification(source, featureId),
      this.#readDesign(source, featureId),
      this.#readVerification(source, featureId),
      this.#readWorkPackages(source, featureId),
      this.#readDeliverables(source, featureId),
      this.#readArtifactBaselines(source, featureId),
      this.#readReadinessBaselines(source, featureId),
      this.#readLatestArtifactValidations(source, featureId),
      this.#readLatestReadinessValidation(source, featureId),
    ]);
    return {
      product: { id: productResult.rows[0].id, name: productResult.rows[0].name, version: productResult.rows[0].version },
      feature,
      phaseStates: await this.#phaseStates(source, feature),
      requirements,
      specification,
      design,
      verificationPlan,
      workPackages,
      deliverables,
      artifactBaselines,
      readinessBaselines,
      latestValidations,
      latestReadinessValidation,
    };
  }

  async #readLatestArtifactValidations(source, featureId) {
    const result = await source.query(`
      SELECT DISTINCT ON (phase) * FROM workbench_feature_artifact_validation_runs
      WHERE feature_id = $1 ORDER BY phase, created_at DESC, id DESC`, [featureId]);
    const entries = await Promise.all(result.rows.map(async (row) => {
      const findings = await source.query("SELECT id, severity, code, message, entity_type, entity_id FROM workbench_feature_artifact_validation_findings WHERE validation_run_id = $1 ORDER BY CASE severity WHEN 'Blocker' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, code", [row.id]);
      return [row.phase, { id: row.id, phase: row.phase, featureVersion: row.feature_version, artifactRevisionId: row.revision_id, validatorVersion: row.validator_version, createdAt: row.created_at, findings: findings.rows.map((item) => ({ id: item.id, severity: item.severity, code: item.code, message: item.message, entityType: item.entity_type, entityId: item.entity_id })) }];
    }));
    return Object.fromEntries(entries);
  }

  async #readLatestReadinessValidation(source, featureId) {
    const result = await source.query("SELECT * FROM workbench_delivery_readiness_runs WHERE feature_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [featureId]);
    const row = result.rows[0];
    if (!row) return null;
    const findings = await source.query("SELECT id, severity, code, message, entity_type, entity_id FROM workbench_delivery_readiness_findings WHERE validation_run_id = $1 ORDER BY CASE severity WHEN 'Blocker' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, code", [row.id]);
    return { id: row.id, featureVersion: row.feature_version, validatorVersion: row.validator_version, createdAt: row.created_at, findings: findings.rows.map((item) => ({ id: item.id, severity: item.severity, code: item.code, message: item.message, entityType: item.entity_type, entityId: item.entity_id })) };
  }

  async #readApprovedRequirements(source, featureId) {
    const result = await source.query(`
      SELECT rr.* FROM workbench_requirement_revisions rr
      JOIN workbench_requirements r ON r.id = rr.requirement_id
      WHERE r.feature_id = $1 AND rr.revision_state = 'Approved'
      ORDER BY rr.external_key`, [featureId]);
    return result.rows.map((row) => ({ id: row.id, requirementId: row.requirement_id, externalKey: row.external_key, title: row.title, text: row.requirement_text, state: row.revision_state, version: row.version }));
  }

  async #readSpecification(source, featureId) {
    const result = await source.query("SELECT * FROM workbench_specification_revisions WHERE feature_id = $1 ORDER BY revision_number DESC LIMIT 1", [featureId]);
    const row = result.rows[0];
    if (!row) return null;
    const [criteria, links] = await Promise.all([
      source.query("SELECT id, criterion_key, criterion_text FROM workbench_specification_acceptance_criteria WHERE revision_id = $1 ORDER BY criterion_key", [row.id]),
      source.query("SELECT requirement_revision_id FROM workbench_specification_requirement_links WHERE revision_id = $1", [row.id]),
    ]);
    const mappedCriteria = await Promise.all(criteria.rows.map(async (item) => {
      const requirementLinks = await source.query("SELECT requirement_revision_id FROM workbench_acceptance_criterion_requirement_links WHERE criterion_id=$1", [item.id]);
      return { id: item.id, key: item.criterion_key, text: item.criterion_text, requirementRevisionIds: requirementLinks.rows.map((link) => link.requirement_revision_id) };
    }));
    return { id: row.id, revisionNumber: row.revision_number, title: row.title, behavior: row.behavior, state: row.revision_state, predecessorRevisionId: row.predecessor_revision_id, authorName: row.author_name, version: row.version, criteria: mappedCriteria, requirementRevisionIds: links.rows.map((item) => item.requirement_revision_id), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async #readDesign(source, featureId) {
    const result = await source.query("SELECT * FROM workbench_design_revisions WHERE feature_id = $1 ORDER BY revision_number DESC LIMIT 1", [featureId]);
    const row = result.rows[0];
    if (!row) return null;
    const [specLinks, requirementLinks, criterionLinks] = await Promise.all([
      source.query("SELECT specification_revision_id FROM workbench_design_specification_links WHERE revision_id = $1", [row.id]),
      source.query("SELECT requirement_revision_id FROM workbench_design_requirement_links WHERE revision_id = $1", [row.id]),
      source.query("SELECT criterion_id FROM workbench_design_acceptance_criterion_links WHERE revision_id = $1", [row.id]),
    ]);
    return { id: row.id, revisionNumber: row.revision_number, title: row.title, summary: row.design_summary, state: row.revision_state, predecessorRevisionId: row.predecessor_revision_id, authorName: row.author_name, version: row.version, specificationRevisionIds: specLinks.rows.map((item) => item.specification_revision_id), requirementRevisionIds: requirementLinks.rows.map((item) => item.requirement_revision_id), acceptanceCriterionIds: criterionLinks.rows.map((item) => item.criterion_id), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async #readVerification(source, featureId) {
    const result = await source.query("SELECT * FROM workbench_verification_plan_revisions WHERE feature_id = $1 ORDER BY revision_number DESC LIMIT 1", [featureId]);
    const row = result.rows[0];
    if (!row) return null;
    const cases = await source.query("SELECT * FROM workbench_verification_cases WHERE revision_id = $1 ORDER BY case_key", [row.id]);
    const mappedCases = await Promise.all(cases.rows.map(async (item) => {
      const [specLinks, requirementLinks, criterionLinks] = await Promise.all([
        source.query("SELECT specification_revision_id FROM workbench_verification_specification_links WHERE case_id = $1", [item.id]),
        source.query("SELECT requirement_revision_id FROM workbench_verification_requirement_links WHERE case_id = $1", [item.id]),
        source.query("SELECT criterion_id FROM workbench_verification_acceptance_criterion_links WHERE case_id = $1", [item.id]),
      ]);
      return { id: item.id, key: item.case_key, method: item.method, successCriteria: item.success_criteria, executionCondition: item.execution_condition, responsibleTeam: item.responsible_team, specificationRevisionIds: specLinks.rows.map((link) => link.specification_revision_id), requirementRevisionIds: requirementLinks.rows.map((link) => link.requirement_revision_id), acceptanceCriterionIds: criterionLinks.rows.map((link) => link.criterion_id) };
    }));
    return { id: row.id, revisionNumber: row.revision_number, title: row.title, state: row.revision_state, predecessorRevisionId: row.predecessor_revision_id, authorName: row.author_name, version: row.version, cases: mappedCases, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async #readWorkPackages(source, featureId) {
    const result = await source.query("SELECT * FROM workbench_work_packages WHERE feature_id = $1 ORDER BY package_key", [featureId]);
    return Promise.all(result.rows.map(async (row) => {
      const [predecessors, designs, verification] = await Promise.all([
        source.query("SELECT predecessor_work_package_id FROM workbench_work_package_predecessors WHERE work_package_id = $1", [row.id]),
        source.query("SELECT design_revision_id FROM workbench_work_package_design_links WHERE work_package_id = $1", [row.id]),
        source.query("SELECT verification_revision_id FROM workbench_work_package_verification_links WHERE work_package_id = $1", [row.id]),
      ]);
      return { id: row.id, key: row.package_key, type: row.package_type, description: row.description, owningTeam: row.owning_team ?? "", version: row.version, predecessorIds: predecessors.rows.map((item) => item.predecessor_work_package_id), designRevisionIds: designs.rows.map((item) => item.design_revision_id), verificationRevisionIds: verification.rows.map((item) => item.verification_revision_id), createdAt: row.created_at, updatedAt: row.updated_at };
    }));
  }

  async #readDeliverables(source, featureId) {
    const result = await source.query(`
      SELECT d.id AS deliverable_id, dr.* FROM workbench_feature_deliverables fd
      JOIN workbench_deliverables d ON d.id = fd.deliverable_id
      JOIN LATERAL (SELECT * FROM workbench_deliverable_revisions WHERE deliverable_id = d.id ORDER BY revision_number DESC LIMIT 1) dr ON true
      WHERE fd.feature_id = $1 ORDER BY dr.name`, [featureId]);
    return Promise.all(result.rows.map(async (row) => {
      const [conditions, packages, predecessors, approval] = await Promise.all([
        source.query("SELECT condition_key, condition_text FROM workbench_deliverable_readiness_conditions WHERE revision_id = $1 ORDER BY condition_key", [row.id]),
        source.query("SELECT work_package_id FROM workbench_deliverable_work_packages WHERE deliverable_revision_id = $1", [row.id]),
        source.query(`SELECT pr.deliverable_id AS predecessor_deliverable_id FROM workbench_deliverable_dependencies d
          JOIN workbench_deliverable_revisions pr ON pr.id=d.predecessor_deliverable_revision_id
          WHERE d.deliverable_revision_id=$1`, [row.id]),
        source.query("SELECT * FROM workbench_deliverable_approvals WHERE deliverable_revision_id = $1", [row.id]),
      ]);
      return { id: row.id, deliverableId: row.deliverable_id, revisionNumber: row.revision_number, name: row.name, description: row.description, targetSystem: row.target_system, targetEnvironment: row.target_environment, artifactRevisionLabel: row.artifact_revision_label, targetReleaseTrainId: row.target_release_train_id, state: row.revision_state, predecessorRevisionId: row.predecessor_revision_id, authorName: row.author_name, version: row.version, readinessConditions: conditions.rows.map((item) => ({ key: item.condition_key, text: item.condition_text })), workPackageIds: packages.rows.map((item) => item.work_package_id), predecessorIds: predecessors.rows.map((item) => item.predecessor_deliverable_id), approval: approval.rows[0] ? { id: approval.rows[0].id, actorName: approval.rows[0].actor_name, rationale: approval.rows[0].rationale, createdAt: approval.rows[0].created_at } : null, createdAt: row.created_at, updatedAt: row.updated_at };
    }));
  }

  async #readArtifactBaselines(source, featureId) {
    const result = await source.query(`
      SELECT b.*, a.actor_name, a.rationale AS approval_rationale, a.warning_rationale, a.created_at AS approved_at,
             COALESCE((SELECT e.validity FROM workbench_feature_artifact_validity_events e WHERE e.baseline_id = b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1), b.validity) AS current_validity
      FROM workbench_feature_artifact_baselines b
      JOIN workbench_feature_artifact_approvals a ON a.baseline_id = b.id
      WHERE b.feature_id = $1 ORDER BY b.created_at DESC`, [featureId]);
    return result.rows.map((row) => ({ id: row.id, phase: row.phase, baselineNumber: row.baseline_number, revisionId: row.revision_id, validationRunId: row.validation_run_id, validity: row.current_validity, createdAt: row.created_at, approval: { actorName: row.actor_name, rationale: row.approval_rationale, warningRationale: row.warning_rationale ?? "", createdAt: row.approved_at } }));
  }

  async #readReadinessBaselines(source, featureId) {
    const result = await source.query(`
      SELECT b.*, a.actor_name, a.rationale AS approval_rationale, a.warning_rationale, a.created_at AS approved_at,
             COALESCE((SELECT e.validity FROM workbench_delivery_readiness_validity_events e WHERE e.baseline_id = b.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1), b.validity) AS current_validity
      FROM workbench_delivery_readiness_baselines b
      JOIN workbench_delivery_readiness_approvals a ON a.baseline_id = b.id
      WHERE b.feature_id = $1 ORDER BY b.baseline_number DESC`, [featureId]);
    return result.rows.map((row) => ({ id: row.id, baselineNumber: row.baseline_number, requirementBaselineId: row.requirement_baseline_id, specificationRevisionId: row.specification_revision_id, designRevisionId: row.design_revision_id, verificationRevisionId: row.verification_revision_id, validationRunId: row.validation_run_id, validity: row.current_validity, createdAt: row.created_at, approval: { actorName: row.actor_name, rationale: row.approval_rationale, warningRationale: row.warning_rationale ?? "", createdAt: row.approved_at } }));
  }

  async #ensurePhaseState(client, featureId, phase) {
    await client.query("INSERT INTO workbench_feature_phase_states (feature_id, phase) VALUES ($1, $2) ON CONFLICT (feature_id, phase) DO NOTHING", [featureId, phase]);
    const result = await client.query("SELECT * FROM workbench_feature_phase_states WHERE feature_id = $1 AND phase = $2 FOR UPDATE", [featureId, phase]);
    return result.rows[0];
  }

  async #impactArtifactBaselines(client, featureId, changedPhase, rationale) {
    const order = ["Specification", "Solution Design", "Verification Planning"];
    const phases = order.slice(order.indexOf(changedPhase));
    const baselines = await client.query(
      `SELECT DISTINCT ON (phase) id, phase FROM workbench_feature_artifact_baselines
       WHERE feature_id = $1 AND phase = ANY($2::text[])
       ORDER BY phase, baseline_number DESC`,
      [featureId, phases],
    );
    for (const baseline of baselines.rows) {
      const latest = await client.query("SELECT validity FROM workbench_feature_artifact_validity_events WHERE baseline_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [baseline.id]);
      if (latest.rows[0]?.validity !== "Impacted") await client.query("INSERT INTO workbench_feature_artifact_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Impacted',$3)", [randomUUID(), baseline.id, rationale]);
    }
  }

  async #bumpFeatureAndImpactReadiness(client, featureId, rationale) {
    await client.query("UPDATE workbench_features SET version = version + 1, updated_at = now() WHERE id = $1", [featureId]);
    const baseline = await client.query("SELECT id FROM workbench_delivery_readiness_baselines WHERE feature_id = $1 ORDER BY baseline_number DESC LIMIT 1", [featureId]);
    if (baseline.rows[0]) {
      const latest = await client.query("SELECT validity FROM workbench_delivery_readiness_validity_events WHERE baseline_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [baseline.rows[0].id]);
      if (latest.rows[0]?.validity !== "Impacted") await client.query("INSERT INTO workbench_delivery_readiness_validity_events (id, baseline_id, validity, rationale) VALUES ($1, $2, 'Impacted', $3)", [randomUUID(), baseline.rows[0].id, rationale]);
    }
  }

  async #assertArtifactReferences(client, input) {
    if (input.phase === "Specification" || input.phase === "Solution Design" || input.phase === "Verification Planning") {
      const requirementIds = input.phase === "Specification"
        ? [...input.requirementRevisionIds, ...input.criteria.flatMap((item) => item.requirementRevisionIds)]
        : input.phase === "Verification Planning" ? input.cases.flatMap((item) => item.requirementRevisionIds) : input.requirementRevisionIds;
      await assertReferences(client, requirementIds,
        `SELECT rr.id FROM workbench_requirement_revisions rr JOIN workbench_requirements r ON r.id=rr.requirement_id
         WHERE r.feature_id=$1 AND rr.revision_state='Approved' AND rr.id=ANY($2::uuid[])`,
        [input.featureId], "Requirement traces must reference approved revisions in this Feature.");
    }
    if (input.phase === "Solution Design") {
      await assertReferences(client, input.specificationRevisionIds,
        "SELECT id FROM workbench_specification_revisions WHERE feature_id=$1 AND revision_state='Approved' AND id=ANY($2::uuid[])",
        [input.featureId], "Design traces must reference an approved Specification revision in this Feature.");
      await assertReferences(client, input.acceptanceCriterionIds,
        `SELECT c.id FROM workbench_specification_acceptance_criteria c JOIN workbench_specification_revisions r ON r.id=c.revision_id
         WHERE r.feature_id=$1 AND r.revision_state='Approved' AND c.id=ANY($2::uuid[])`,
        [input.featureId], "Design criterion traces must reference approved Acceptance Criteria in this Feature.");
    }
    if (input.phase === "Verification Planning") {
      await assertReferences(client, input.cases.flatMap((item) => item.specificationRevisionIds),
        "SELECT id FROM workbench_specification_revisions WHERE feature_id=$1 AND revision_state='Approved' AND id=ANY($2::uuid[])",
        [input.featureId], "Verification traces must reference an approved Specification revision in this Feature.");
      await assertReferences(client, input.cases.flatMap((item) => item.acceptanceCriterionIds),
        `SELECT c.id FROM workbench_specification_acceptance_criteria c JOIN workbench_specification_revisions r ON r.id=c.revision_id
         WHERE r.feature_id=$1 AND r.revision_state='Approved' AND c.id=ANY($2::uuid[])`,
        [input.featureId], "Verification criterion traces must reference approved Acceptance Criteria in this Feature.");
    }
  }

  async #latestArtifact(client, phase, featureId) {
    if (phase === "Specification") return client.query("SELECT * FROM workbench_specification_revisions WHERE feature_id=$1 ORDER BY revision_number DESC LIMIT 1 FOR UPDATE", [featureId]);
    if (phase === "Solution Design") return client.query("SELECT * FROM workbench_design_revisions WHERE feature_id=$1 ORDER BY revision_number DESC LIMIT 1 FOR UPDATE", [featureId]);
    if (phase === "Verification Planning") return client.query("SELECT * FROM workbench_verification_plan_revisions WHERE feature_id=$1 ORDER BY revision_number DESC LIMIT 1 FOR UPDATE", [featureId]);
    throw new WorkbenchError("This phase does not use a revision artifact.", 400, "INVALID_PHASE");
  }

  async #insertArtifact(client, input, id, number, predecessorId = null) {
    if (input.phase === "Specification") return (await client.query("INSERT INTO workbench_specification_revisions (id, feature_id, revision_number, title, behavior, predecessor_revision_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [id, input.featureId, number, input.title, input.body, predecessorId, input.authorName])).rows[0];
    if (input.phase === "Solution Design") return (await client.query("INSERT INTO workbench_design_revisions (id, feature_id, revision_number, title, design_summary, predecessor_revision_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [id, input.featureId, number, input.title, input.body, predecessorId, input.authorName])).rows[0];
    return (await client.query("INSERT INTO workbench_verification_plan_revisions (id, feature_id, revision_number, title, predecessor_revision_id, author_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [id, input.featureId, number, input.title, predecessorId, input.authorName])).rows[0];
  }

  async #updateArtifact(client, input, revisionId) {
    if (input.phase === "Specification") return (await client.query("UPDATE workbench_specification_revisions SET title=$2, behavior=$3, author_name=$4, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [revisionId, input.title, input.body, input.authorName])).rows[0];
    if (input.phase === "Solution Design") return (await client.query("UPDATE workbench_design_revisions SET title=$2, design_summary=$3, author_name=$4, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [revisionId, input.title, input.body, input.authorName])).rows[0];
    return (await client.query("UPDATE workbench_verification_plan_revisions SET title=$2, author_name=$3, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [revisionId, input.title, input.authorName])).rows[0];
  }

  async #setArtifactRevisionState(client, phase, revisionId, state) {
    if (phase === "Specification") return client.query("UPDATE workbench_specification_revisions SET revision_state=$2 WHERE id=$1", [revisionId, state]);
    if (phase === "Solution Design") return client.query("UPDATE workbench_design_revisions SET revision_state=$2 WHERE id=$1", [revisionId, state]);
    return client.query("UPDATE workbench_verification_plan_revisions SET revision_state=$2 WHERE id=$1", [revisionId, state]);
  }

  async #artifactForApproval(client, phase, revisionId, featureId) {
    if (phase === "Specification") return client.query("SELECT * FROM workbench_specification_revisions WHERE id=$1 AND feature_id=$2 FOR UPDATE", [revisionId, featureId]);
    if (phase === "Solution Design") return client.query("SELECT * FROM workbench_design_revisions WHERE id=$1 AND feature_id=$2 FOR UPDATE", [revisionId, featureId]);
    if (phase === "Verification Planning") return client.query("SELECT * FROM workbench_verification_plan_revisions WHERE id=$1 AND feature_id=$2 FOR UPDATE", [revisionId, featureId]);
    throw new WorkbenchError("This phase does not use a revision artifact.", 400, "INVALID_PHASE");
  }

  async #saveArtifact(client, input) {
    const { featureId, phase, expectedPhaseVersion, expectedRevisionVersion } = input;
    const phaseState = await this.#ensurePhaseState(client, featureId, phase);
    if (phaseState.version !== expectedPhaseVersion) throw new WorkbenchError(`${phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected: expectedPhaseVersion, actual: phaseState.version });
    if (phaseState.review_state === "In Review") throw new WorkbenchError("Request changes before editing an artifact that is in review.", 409, "REVIEW_LOCKED");
    if (phaseState.review_state === "Superseded") throw new WorkbenchError("A superseded phase cannot be edited.", 409, "IMMUTABLE_PHASE");

    await this.#assertArtifactReferences(client, input);
    const latest = await this.#latestArtifact(client, phase, featureId);
    let row;
    let created = false;
    if (!latest.rows[0]) {
      created = true;
      row = await this.#insertArtifact(client, input, randomUUID(), 1);
    } else if (latest.rows[0].revision_state === "Draft") {
      if (latest.rows[0].version !== expectedRevisionVersion) throw new WorkbenchError(`${phase} revision changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected: expectedRevisionVersion, actual: latest.rows[0].version });
      row = await this.#updateArtifact(client, input, latest.rows[0].id);
    } else if (latest.rows[0].revision_state === "Approved") {
      if (latest.rows[0].version !== expectedRevisionVersion) throw new WorkbenchError(`${phase} revision changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected: expectedRevisionVersion, actual: latest.rows[0].version });
      created = true;
      await this.#setArtifactRevisionState(client, phase, latest.rows[0].id, "Superseded");
      row = await this.#insertArtifact(client, input, randomUUID(), latest.rows[0].revision_number + 1, latest.rows[0].id);
      const baseline = await client.query("SELECT id FROM workbench_feature_artifact_baselines WHERE feature_id=$1 AND phase=$2 ORDER BY baseline_number DESC LIMIT 1", [featureId, phase]);
      if (baseline.rows[0]) await client.query("INSERT INTO workbench_feature_artifact_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Impacted',$3)", [randomUUID(), baseline.rows[0].id, `A successor ${phase} revision was created after approval.`]);
    } else throw new WorkbenchError("A superseded revision cannot be edited.", 409, "IMMUTABLE_REVISION");

    if (phase === "Specification") {
      await client.query("DELETE FROM workbench_acceptance_criterion_requirement_links WHERE criterion_id IN (SELECT id FROM workbench_specification_acceptance_criteria WHERE revision_id=$1)", [row.id]);
      await client.query("DELETE FROM workbench_specification_acceptance_criteria WHERE revision_id=$1", [row.id]);
      await client.query("DELETE FROM workbench_specification_requirement_links WHERE revision_id=$1", [row.id]);
      for (const criterion of input.criteria) {
        const criterionId = randomUUID();
        await client.query("INSERT INTO workbench_specification_acceptance_criteria (id, revision_id, criterion_key, criterion_text) VALUES ($1,$2,$3,$4)", [criterionId, row.id, criterion.key, criterion.text]);
        for (const id of criterion.requirementRevisionIds) await client.query("INSERT INTO workbench_acceptance_criterion_requirement_links (criterion_id, requirement_revision_id) VALUES ($1,$2)", [criterionId, id]);
      }
      for (const id of input.requirementRevisionIds) await client.query("INSERT INTO workbench_specification_requirement_links (revision_id, requirement_revision_id) VALUES ($1,$2)", [row.id, id]);
    }
    if (phase === "Solution Design") {
      await client.query("DELETE FROM workbench_design_specification_links WHERE revision_id=$1", [row.id]);
      await client.query("DELETE FROM workbench_design_requirement_links WHERE revision_id=$1", [row.id]);
      await client.query("DELETE FROM workbench_design_acceptance_criterion_links WHERE revision_id=$1", [row.id]);
      for (const id of input.specificationRevisionIds) await client.query("INSERT INTO workbench_design_specification_links (revision_id, specification_revision_id) VALUES ($1,$2)", [row.id, id]);
      for (const id of input.requirementRevisionIds) await client.query("INSERT INTO workbench_design_requirement_links (revision_id, requirement_revision_id) VALUES ($1,$2)", [row.id, id]);
      for (const id of input.acceptanceCriterionIds) await client.query("INSERT INTO workbench_design_acceptance_criterion_links (revision_id, criterion_id) VALUES ($1,$2)", [row.id, id]);
    }
    if (phase === "Verification Planning") {
      await client.query("DELETE FROM workbench_verification_acceptance_criterion_links WHERE case_id IN (SELECT id FROM workbench_verification_cases WHERE revision_id=$1)", [row.id]);
      await client.query("DELETE FROM workbench_verification_requirement_links WHERE case_id IN (SELECT id FROM workbench_verification_cases WHERE revision_id=$1)", [row.id]);
      await client.query("DELETE FROM workbench_verification_specification_links WHERE case_id IN (SELECT id FROM workbench_verification_cases WHERE revision_id=$1)", [row.id]);
      await client.query("DELETE FROM workbench_verification_cases WHERE revision_id=$1", [row.id]);
      for (const verificationCase of input.cases) {
        const caseId = randomUUID();
        await client.query("INSERT INTO workbench_verification_cases (id, revision_id, case_key, method, success_criteria, execution_condition, responsible_team) VALUES ($1,$2,$3,$4,$5,$6,$7)", [caseId, row.id, verificationCase.key, verificationCase.method, verificationCase.successCriteria, verificationCase.executionCondition, verificationCase.responsibleTeam]);
        for (const id of verificationCase.specificationRevisionIds) await client.query("INSERT INTO workbench_verification_specification_links (case_id, specification_revision_id) VALUES ($1,$2)", [caseId, id]);
        for (const id of verificationCase.requirementRevisionIds) await client.query("INSERT INTO workbench_verification_requirement_links (case_id, requirement_revision_id) VALUES ($1,$2)", [caseId, id]);
        for (const id of verificationCase.acceptanceCriterionIds) await client.query("INSERT INTO workbench_verification_acceptance_criterion_links (case_id, criterion_id) VALUES ($1,$2)", [caseId, id]);
      }
    }
    await client.query("UPDATE workbench_feature_phase_states SET review_state='Draft', version=version+1, updated_at=now() WHERE feature_id=$1 AND phase=$2", [featureId, phase]);
    await this.#impactArtifactBaselines(client, featureId, phase, `${phase} changed, so this baseline and downstream baselines require evaluation.`);
    await this.#bumpFeatureAndImpactReadiness(client, featureId, `${phase} changed after Delivery Readiness approval.`);
    return { created, workspace: await this.#readWorkspace(client, featureId) };
  }

  async #assertWorkPackageReferences(client, input) {
    await assertReferences(client, input.predecessorIds,
      "SELECT id FROM workbench_work_packages WHERE feature_id=$1 AND id=ANY($2::uuid[])",
      [input.featureId], "Work Package predecessors must belong to this Feature.");
    await assertReferences(client, input.designRevisionIds,
      "SELECT id FROM workbench_design_revisions WHERE feature_id=$1 AND revision_state='Approved' AND id=ANY($2::uuid[])",
      [input.featureId], "Work Package design traces must reference approved revisions in this Feature.");
    await assertReferences(client, input.verificationRevisionIds,
      "SELECT id FROM workbench_verification_plan_revisions WHERE feature_id=$1 AND revision_state='Approved' AND id=ANY($2::uuid[])",
      [input.featureId], "Work Package verification traces must reference approved revisions in this Feature.");
  }

  async #saveWorkPackage(client, input) {
    await this.#assertWorkPackageReferences(client, input);
    let row;
    if (input.id) {
      const current = await client.query("SELECT * FROM workbench_work_packages WHERE id=$1 AND feature_id=$2 FOR UPDATE", [input.id, input.featureId]);
      if (!current.rows[0]) missing("Work Package");
      if (current.rows[0].version !== input.expectedVersion) throw new WorkbenchError("Work Package changed since it was loaded. Reload and retry.", 409, "STALE_VERSION", { expected: input.expectedVersion, actual: current.rows[0].version });
      row = (await client.query("UPDATE workbench_work_packages SET package_key=$2, package_type=$3, description=$4, owning_team=$5, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [input.id, input.key, input.type, input.description, input.owningTeam || null])).rows[0];
    } else {
      const id = randomUUID();
      row = (await client.query("INSERT INTO workbench_work_packages (id, product_id, feature_id, package_key, package_type, description, owning_team) SELECT $1, product_id, id, $3,$4,$5,$6 FROM workbench_features WHERE id=$2 RETURNING *", [id, input.featureId, input.key, input.type, input.description, input.owningTeam || null])).rows[0];
      if (!row) missing("Feature");
    }
    await client.query("DELETE FROM workbench_work_package_predecessors WHERE work_package_id=$1", [row.id]);
    await client.query("DELETE FROM workbench_work_package_design_links WHERE work_package_id=$1", [row.id]);
    await client.query("DELETE FROM workbench_work_package_verification_links WHERE work_package_id=$1", [row.id]);
    for (const id of input.predecessorIds) await client.query("INSERT INTO workbench_work_package_predecessors (work_package_id, predecessor_work_package_id) VALUES ($1,$2)", [row.id, id]);
    for (const id of input.designRevisionIds) await client.query("INSERT INTO workbench_work_package_design_links (work_package_id, design_revision_id) VALUES ($1,$2)", [row.id, id]);
    for (const id of input.verificationRevisionIds) await client.query("INSERT INTO workbench_work_package_verification_links (work_package_id, verification_revision_id) VALUES ($1,$2)", [row.id, id]);
    const phase = await this.#ensurePhaseState(client, input.featureId, "Delivery Readiness");
    await client.query("UPDATE workbench_feature_phase_states SET review_state='Draft', version=version+1, updated_at=now() WHERE feature_id=$1 AND phase='Delivery Readiness'", [input.featureId]);
    await this.#bumpFeatureAndImpactReadiness(client, input.featureId, "A Work Package changed after Delivery Readiness approval.");
    return { created: !input.id, priorPhaseVersion: phase.version, workspace: await this.#readWorkspace(client, input.featureId) };
  }

  async #assertDeliverableReferences(client, input) {
    await assertReferences(client, input.workPackageIds,
      "SELECT id FROM workbench_work_packages WHERE feature_id=$1 AND id=ANY($2::uuid[])",
      [input.featureId], "Deliverable Work Package references must belong to this Feature.");
    await assertReferences(client, input.predecessorIds,
      `SELECT d.id FROM workbench_deliverables d
       JOIN workbench_features f ON f.product_id=d.product_id
       WHERE f.id=$1 AND d.id=ANY($2::uuid[])`,
      [input.featureId], "Deliverable predecessors must belong to the same Product.");
  }

  async #saveDeliverable(client, input) {
    await this.#assertDeliverableReferences(client, input);
    let deliverableId = input.deliverableId;
    let revision;
    let created = false;
    if (!deliverableId) {
      created = true;
      deliverableId = randomUUID();
      await client.query("INSERT INTO workbench_deliverables (id, product_id) SELECT $1, product_id FROM workbench_features WHERE id=$2", [deliverableId, input.featureId]);
      await client.query("INSERT INTO workbench_feature_deliverables (feature_id, deliverable_id) VALUES ($1,$2)", [input.featureId, deliverableId]);
      revision = (await client.query(`INSERT INTO workbench_deliverable_revisions (id, deliverable_id, revision_number, name, description, target_system, target_environment, artifact_revision_label, author_name) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), deliverableId, input.name, input.description, input.targetSystem, input.targetEnvironment, input.artifactRevisionLabel, input.authorName])).rows[0];
    } else {
      const latest = await client.query(`SELECT dr.* FROM workbench_deliverable_revisions dr JOIN workbench_feature_deliverables fd ON fd.deliverable_id=dr.deliverable_id WHERE dr.deliverable_id=$1 AND fd.feature_id=$2 ORDER BY dr.revision_number DESC LIMIT 1 FOR UPDATE OF dr`, [deliverableId, input.featureId]);
      if (!latest.rows[0]) missing("Deliverable");
      if (latest.rows[0].version !== input.expectedVersion) throw new WorkbenchError("Deliverable revision changed since it was loaded. Reload and retry.", 409, "STALE_VERSION", { expected: input.expectedVersion, actual: latest.rows[0].version });
      if (latest.rows[0].revision_state === "Draft") revision = (await client.query(`UPDATE workbench_deliverable_revisions SET name=$2, description=$3, target_system=$4, target_environment=$5, artifact_revision_label=$6, author_name=$7, version=version+1, updated_at=now() WHERE id=$1 RETURNING *`, [latest.rows[0].id, input.name, input.description, input.targetSystem, input.targetEnvironment, input.artifactRevisionLabel, input.authorName])).rows[0];
      else if (latest.rows[0].revision_state === "Approved") {
        created = true;
        await client.query("UPDATE workbench_deliverable_revisions SET revision_state='Superseded' WHERE id=$1", [latest.rows[0].id]);
        revision = (await client.query(`INSERT INTO workbench_deliverable_revisions (id, deliverable_id, revision_number, name, description, target_system, target_environment, artifact_revision_label, predecessor_revision_id, author_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [randomUUID(), deliverableId, latest.rows[0].revision_number + 1, input.name, input.description, input.targetSystem, input.targetEnvironment, input.artifactRevisionLabel, latest.rows[0].id, input.authorName])).rows[0];
      } else throw new WorkbenchError("A superseded Deliverable revision cannot be edited.", 409, "IMMUTABLE_REVISION");
    }
    await client.query("DELETE FROM workbench_deliverable_readiness_conditions WHERE revision_id=$1", [revision.id]);
    for (const condition of input.readinessConditions) await client.query("INSERT INTO workbench_deliverable_readiness_conditions (revision_id, condition_key, condition_text) VALUES ($1,$2,$3)", [revision.id, condition.key, condition.text]);
    await client.query("DELETE FROM workbench_deliverable_work_packages WHERE deliverable_revision_id=$1", [revision.id]);
    await client.query("DELETE FROM workbench_deliverable_dependencies WHERE deliverable_revision_id=$1", [revision.id]);
    for (const id of input.workPackageIds) await client.query("INSERT INTO workbench_deliverable_work_packages (deliverable_revision_id, work_package_id) VALUES ($1,$2)", [revision.id, id]);
    for (const id of input.predecessorIds) await client.query(
      `INSERT INTO workbench_deliverable_dependencies (deliverable_revision_id, predecessor_deliverable_revision_id)
       SELECT $1, id FROM workbench_deliverable_revisions WHERE deliverable_id=$2 ORDER BY revision_number DESC LIMIT 1`,
      [revision.id, id],
    );
    await this.#ensurePhaseState(client, input.featureId, "Delivery Readiness");
    await client.query("UPDATE workbench_feature_phase_states SET review_state='Draft', version=version+1, updated_at=now() WHERE feature_id=$1 AND phase='Delivery Readiness'", [input.featureId]);
    await this.#bumpFeatureAndImpactReadiness(client, input.featureId, "A Deliverable changed after Delivery Readiness approval.");
    return { created, workspace: await this.#readWorkspace(client, input.featureId) };
  }

  async #saveArtifactValidation(client, { featureId, phase, featureVersion, revisionId, findings }) {
    const runId = randomUUID();
    await client.query("INSERT INTO workbench_feature_artifact_validation_runs (id, feature_id, phase, feature_version, validator_version, revision_id) VALUES ($1,$2,$3,$4,'phase2-deterministic-v1',$5)", [runId, featureId, phase, featureVersion, revisionId]);
    for (const item of findings) await client.query("INSERT INTO workbench_feature_artifact_validation_findings (id, validation_run_id, severity, code, message, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), runId, item.severity, item.code, item.message, item.entityType, item.entityId]);
    return { id: runId, featureId, phase, featureVersion, revisionId, validatorVersion: "phase2-deterministic-v1", findings };
  }

  async #setPhaseState(client, { featureId, phase, expectedVersion, toState, actorName, rationale }) {
    const state = await this.#ensurePhaseState(client, featureId, phase);
    if (state.version !== expectedVersion) throw new WorkbenchError(`${phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected: expectedVersion, actual: state.version });
    const result = await client.query("UPDATE workbench_feature_phase_states SET review_state=$3, version=version+1, updated_at=now() WHERE feature_id=$1 AND phase=$2 RETURNING *", [featureId, phase, toState]);
    await client.query("INSERT INTO workbench_feature_artifact_review_events (id, feature_id, phase, from_state, to_state, actor_name, rationale) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), featureId, phase, state.review_state, toState, actorName, rationale]);
    return { reviewState: result.rows[0].review_state, version: result.rows[0].version, updatedAt: result.rows[0].updated_at };
  }

  async #approveArtifact(client, { featureId, phase, expectedVersion, revisionId, validationRunId, actorName, rationale, warningRationale }) {
    const state = await this.#ensurePhaseState(client, featureId, phase);
    if (state.version !== expectedVersion) throw new WorkbenchError(`${phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected: expectedVersion, actual: state.version });
    const revision = await this.#artifactForApproval(client, phase, revisionId, featureId);
    if (!revision.rows[0] || revision.rows[0].revision_state !== "Draft") throw new WorkbenchError("Only the current Draft revision can be approved.", 409, "IMMUTABLE_REVISION");
    await this.#setArtifactRevisionState(client, phase, revisionId, "Approved");
    const count = await client.query("SELECT count(*)::integer AS count FROM workbench_feature_artifact_baselines WHERE feature_id=$1 AND phase=$2", [featureId, phase]);
    const baselineId = randomUUID();
    await client.query("INSERT INTO workbench_feature_artifact_baselines (id, feature_id, phase, baseline_number, revision_id, validation_run_id) VALUES ($1,$2,$3,$4,$5,$6)", [baselineId, featureId, phase, count.rows[0].count + 1, revisionId, validationRunId]);
    await client.query("INSERT INTO workbench_feature_artifact_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Current',$3)", [randomUUID(), baselineId, `${phase} was approved with this frozen revision.`]);
    await client.query("INSERT INTO workbench_feature_artifact_approvals (id, baseline_id, actor_name, rationale, warning_rationale) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), baselineId, actorName, rationale, warningRationale || null]);
    const phaseState = await this.#setPhaseState(client, { featureId, phase, expectedVersion, toState: "Approved", actorName, rationale });
    return { baselineId, phaseState, workspace: await this.#readWorkspace(client, featureId) };
  }

  async #saveReadinessValidation(client, { featureId, featureVersion, findings }) {
    const runId = randomUUID();
    await client.query("INSERT INTO workbench_delivery_readiness_runs (id, feature_id, feature_version, validator_version) VALUES ($1,$2,$3,'phase2-readiness-deterministic-v1')", [runId, featureId, featureVersion]);
    for (const item of findings) await client.query("INSERT INTO workbench_delivery_readiness_findings (id, validation_run_id, severity, code, message, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), runId, item.severity, item.code, item.message, item.entityType, item.entityId]);
    return { id: runId, featureId, featureVersion, validatorVersion: "phase2-readiness-deterministic-v1", findings };
  }

  async #approveReadiness(client, { workspace, expectedVersion, validationRunId, actorName, rationale, warningRationale }) {
    const featureId = workspace.feature.id;
    const state = await this.#ensurePhaseState(client, featureId, "Delivery Readiness");
    if (state.version !== expectedVersion) throw new WorkbenchError("Delivery Readiness changed since it was loaded. Reload and retry.", 409, "STALE_VERSION", { expected: expectedVersion, actual: state.version });
    const requirementBaseline = await client.query("SELECT id FROM workbench_requirement_baselines WHERE feature_id=$1 ORDER BY baseline_number DESC LIMIT 1", [featureId]);
    if (!requirementBaseline.rows[0]) throw new WorkbenchError("An approved Requirement Baseline is required.", 409, "REQUIREMENT_BASELINE_MISSING");
    const count = await client.query("SELECT count(*)::integer AS count FROM workbench_delivery_readiness_baselines WHERE feature_id=$1", [featureId]);
    const baselineId = randomUUID();
    await client.query(`INSERT INTO workbench_delivery_readiness_baselines (id, feature_id, baseline_number, requirement_baseline_id, specification_revision_id, design_revision_id, verification_revision_id, validation_run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [baselineId, featureId, count.rows[0].count + 1, requirementBaseline.rows[0].id, workspace.specification.id, workspace.design.id, workspace.verificationPlan.id, validationRunId]);
    for (const item of workspace.workPackages) await client.query("INSERT INTO workbench_delivery_readiness_baseline_work_packages (baseline_id, work_package_id, work_package_version) VALUES ($1,$2,$3)", [baselineId, item.id, item.version]);
    for (const item of workspace.deliverables) {
      if (item.state !== "Approved") {
        await client.query("UPDATE workbench_deliverable_revisions SET revision_state='Approved' WHERE id=$1", [item.id]);
        await client.query("INSERT INTO workbench_deliverable_approvals (id, deliverable_revision_id, actor_name, rationale) VALUES ($1,$2,$3,$4)", [randomUUID(), item.id, actorName, rationale]);
      }
      await client.query("INSERT INTO workbench_delivery_readiness_baseline_deliverables (baseline_id, deliverable_revision_id) VALUES ($1,$2)", [baselineId, item.id]);
    }
    await client.query("INSERT INTO workbench_delivery_readiness_validity_events (id, baseline_id, validity, rationale) VALUES ($1,$2,'Current',$3)", [randomUUID(), baselineId, "Delivery Readiness was approved with this frozen snapshot."]);
    await client.query("INSERT INTO workbench_delivery_readiness_approvals (id, baseline_id, actor_name, rationale, warning_rationale) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), baselineId, actorName, rationale, warningRationale || null]);
    const phaseState = await this.#setPhaseState(client, { featureId, phase: "Delivery Readiness", expectedVersion, toState: "Approved", actorName, rationale });
    return { baselineId, phaseState, workspace: await this.#readWorkspace(client, featureId) };
  }
}
