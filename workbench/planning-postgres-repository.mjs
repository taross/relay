import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDatabaseConfig } from "../db/client.mjs";
import { WorkbenchError } from "./domain.mjs";

const { Pool } = pg;
const missing = (name) => { throw new WorkbenchError(`${name} was not found.`, 404, "NOT_FOUND"); };
const mapProduct = (row) => ({ id: row.id, name: row.name, version: row.version });
const mapRevision = (row) => ({ id: row.id, scenarioId: row.scenario_id, productId: row.product_id, deliveryId: row.delivery_id, revisionNumber: row.revision_number, predecessorRevisionId: row.predecessor_revision_id, provenance: row.provenance, inputHash: row.input_hash, activities: row.activities, deliverables: row.deliverables, constraints: row.constraints, createdAt: row.created_at });

export class PlanningPostgresRepository {
  constructor(source) {
    const config = getDatabaseConfig(source);
    this.pool = config.configured ? new Pool({ connectionString: config.connectionString, max: 10 }) : null;
  }
  requirePool() { if (!this.pool) throw new WorkbenchError("PostgreSQL is not configured for Delivery Planning.", 503, "DATABASE_NOT_CONFIGURED"); return this.pool; }
  async close() { await this.pool?.end(); this.pool = null; }
  getWorkspace(productId) { return this.#readWorkspace(this.requirePool(), productId); }
  async getScenarioRevisions(revisionIds) {
    const result = await this.requirePool().query("SELECT * FROM workbench_planning_scenario_revisions WHERE id = ANY($1::uuid[]) ORDER BY id", [revisionIds]);
    return result.rows.map(mapRevision);
  }

  async runCommand(commandId, operation, requestHash, task) {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [commandId]);
      const receipt = await client.query("SELECT operation, request_hash, response_status, response_body FROM workbench_command_receipts WHERE command_id=$1", [commandId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].operation !== operation || receipt.rows[0].request_hash !== requestHash) throw new WorkbenchError("The idempotency key was already used for a different command payload.", 409, "IDEMPOTENCY_KEY_REUSED");
        await client.query("COMMIT");
        return { replayed: true, status: receipt.rows[0].response_status, body: receipt.rows[0].response_body };
      }
      const result = await task(this.#transaction(client));
      const status = result.status ?? 200;
      const body = result.body ?? result;
      await client.query("INSERT INTO workbench_command_receipts (command_id, operation, request_hash, response_status, response_body) VALUES ($1,$2,$3,$4,$5::jsonb)", [commandId, operation, requestHash, status, JSON.stringify(body)]);
      await client.query("COMMIT");
      return { replayed: false, status, body };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.code === "23505") throw new WorkbenchError("A planning resource with the same identity already exists.", 409, "DUPLICATE_RESOURCE");
      if (error?.code === "23503") throw new WorkbenchError("A planning reference is missing or outside this Product.", 409, "INVALID_REFERENCE");
      throw error;
    } finally { client.release(); }
  }

  #transaction(client) {
    return {
      lockProduct: async (productId) => { const result = await client.query("SELECT * FROM workbench_products WHERE id=$1 FOR UPDATE", [productId]); if (!result.rows[0]) missing("Product"); return mapProduct(result.rows[0]); },
      readWorkspace: (productId) => this.#readWorkspace(client, productId),
      savePolicy: (input) => this.#savePolicy(client, input),
      saveResource: (input) => this.#saveResource(client, input),
      saveTrain: (input) => this.#saveTrain(client, input),
      saveDelivery: (input) => this.#saveDelivery(client, input),
      createScenario: (input) => this.#createScenario(client, input),
      createRevision: (input) => this.#createRevision(client, input),
      cloneScenario: (input) => this.#cloneScenario(client, input),
      appendActual: (input) => this.#appendActual(client, input),
      saveValidation: (input) => this.#saveValidation(client, input),
    };
  }

  async #readWorkspace(source, productId) {
    const productResult = await source.query("SELECT id,name,version FROM workbench_products WHERE id=$1", [productId]);
    if (!productResult.rows[0]) missing("Product");
    const [deliveries, policies, resources, trains, scenarios, actuals, validations] = await Promise.all([
      source.query("SELECT * FROM workbench_deliveries WHERE product_id=$1 ORDER BY name,id", [productId]),
      source.query("SELECT * FROM workbench_planning_policy_revisions WHERE product_id=$1 ORDER BY revision_number", [productId]),
      source.query("SELECT * FROM workbench_planning_resources WHERE product_id=$1 ORDER BY name,id", [productId]),
      source.query("SELECT * FROM workbench_planning_trains WHERE product_id=$1 ORDER BY name,id", [productId]),
      source.query("SELECT * FROM workbench_planning_scenarios WHERE product_id=$1 ORDER BY created_at,id", [productId]),
      source.query("SELECT * FROM workbench_planning_actuals WHERE product_id=$1 ORDER BY observed_at,recorded_at,id", [productId]),
      source.query("SELECT * FROM workbench_planning_validation_runs WHERE product_id=$1 ORDER BY created_at,id", [productId]),
    ]);
    const mappedResources = await Promise.all(resources.rows.map(async (row) => {
      const capacity = await source.query("SELECT * FROM workbench_planning_resource_capacity WHERE resource_id=$1 ORDER BY effective_from", [row.id]);
      return { id: row.id, productId: row.product_id, name: row.name, version: row.version, capacity: capacity.rows.map((item) => ({ effectiveFrom: item.effective_from, effectiveTo: item.effective_to, units: item.units })), createdAt: row.created_at, updatedAt: row.updated_at };
    }));
    const mappedScenarios = await Promise.all(scenarios.rows.map(async (row) => {
      const revisions = await source.query("SELECT * FROM workbench_planning_scenario_revisions WHERE scenario_id=$1 ORDER BY revision_number", [row.id]);
      return { id: row.id, productId: row.product_id, deliveryId: row.delivery_id, name: row.name, provenance: row.provenance, clonedFromRevisionId: row.cloned_from_revision_id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, revisions: revisions.rows.map(mapRevision) };
    }));
    const mappedValidations = await Promise.all(validations.rows.map(async (row) => {
      const findings = await source.query("SELECT * FROM workbench_planning_validation_findings WHERE validation_run_id=$1 ORDER BY code,entity_id,id", [row.id]);
      return { id: row.id, productId: row.product_id, scenarioId: row.scenario_id, revisionId: row.revision_id, asOf: row.as_of, validatorSetVersion: row.validator_set_version, inputHash: row.input_hash, status: row.status, createdAt: row.created_at, findings: findings.rows.map((item) => ({ id: item.id, status: item.finding_status, code: item.code, message: item.message, entityType: item.entity_type, entityId: item.entity_id, details: item.details })) };
    }));
    return {
      product: mapProduct(productResult.rows[0]),
      deliveries: deliveries.rows.map((row) => ({ id: row.id, productId: row.product_id, name: row.name, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at })),
      deliverables: [],
      policies: policies.rows.map((row) => ({ id: row.id, productId: row.product_id, revisionNumber: row.revision_number, predecessorRevisionId: row.predecessor_revision_id, version: 1, rules: row.rules, createdAt: row.created_at })),
      resources: mappedResources,
      trains: trains.rows.map((row) => ({ id: row.id, productId: row.product_id, name: row.name, cutoffAt: row.cutoff_at, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at })),
      scenarios: mappedScenarios,
      actuals: actuals.rows.map((row) => ({ id: row.id, productId: row.product_id, scenarioId: row.scenario_id, activityId: row.activity_id, kind: row.kind, value: row.value, observedAt: row.observed_at, recordedAt: row.recorded_at })),
      validations: mappedValidations,
    };
  }

  async #bumpProduct(client, productId, expectedVersion) {
    const result = await client.query("UPDATE workbench_products SET version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING version", [productId, expectedVersion]);
    if (!result.rows[0]) throw new WorkbenchError("Product changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
  }
  async #savePolicy(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    const previous = await client.query("SELECT id,revision_number FROM workbench_planning_policy_revisions WHERE product_id=$1 ORDER BY revision_number DESC LIMIT 1", [input.productId]);
    const id = randomUUID();
    await client.query("INSERT INTO workbench_planning_policy_revisions (id,product_id,revision_number,predecessor_revision_id,rules) VALUES ($1,$2,$3,$4,$5::jsonb)", [id, input.productId, (previous.rows[0]?.revision_number ?? 0) + 1, previous.rows[0]?.id ?? null, JSON.stringify(input.rules)]);
    return { created: true, workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #saveResource(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    let id = input.id;
    if (id) {
      const result = await client.query("UPDATE workbench_planning_resources SET name=$3,version=version+1,updated_at=now() WHERE id=$1 AND product_id=$2 AND version=$4 RETURNING id", [id, input.productId, input.name, input.expectedVersion]);
      if (!result.rows[0]) throw new WorkbenchError("Resource changed since it was loaded or was not found.", 409, "STALE_VERSION");
      await client.query("DELETE FROM workbench_planning_resource_capacity WHERE resource_id=$1", [id]);
    } else { id = randomUUID(); await client.query("INSERT INTO workbench_planning_resources (id,product_id,name) VALUES ($1,$2,$3)", [id, input.productId, input.name]); }
    for (const item of input.capacity) await client.query("INSERT INTO workbench_planning_resource_capacity (id,resource_id,effective_from,effective_to,units) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), id, item.effectiveFrom, item.effectiveTo, item.units]);
    return { created: !input.id, workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #saveTrain(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    if (input.id) {
      const result = await client.query("UPDATE workbench_planning_trains SET name=$3,cutoff_at=$4,version=version+1,updated_at=now() WHERE id=$1 AND product_id=$2 AND version=$5 RETURNING id", [input.id, input.productId, input.name, input.cutoffAt, input.expectedVersion]);
      if (!result.rows[0]) throw new WorkbenchError("Train changed since it was loaded or was not found.", 409, "STALE_VERSION");
    } else await client.query("INSERT INTO workbench_planning_trains (id,product_id,name,cutoff_at) VALUES ($1,$2,$3,$4)", [randomUUID(), input.productId, input.name, input.cutoffAt]);
    return { created: !input.id, workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #saveDelivery(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    if (input.id) {
      const result = await client.query("UPDATE workbench_deliveries SET name=$3,version=version+1,updated_at=now() WHERE id=$1 AND product_id=$2 AND version=$4 RETURNING id", [input.id, input.productId, input.name, input.expectedVersion]);
      if (!result.rows[0]) throw new WorkbenchError("Delivery changed since it was loaded or was not found.", 409, "STALE_VERSION");
    } else await client.query("INSERT INTO workbench_deliveries (id,product_id,name) VALUES ($1,$2,$3)", [randomUUID(), input.productId, input.name]);
    return { created: !input.id, workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #createScenario(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    const id = randomUUID();
    const result = await client.query("INSERT INTO workbench_planning_scenarios (id,product_id,delivery_id,name,provenance) SELECT $1,$2,d.id,$4,'manual' FROM workbench_deliveries d WHERE d.id=$3 AND d.product_id=$2 RETURNING id", [id, input.productId, input.deliveryId, input.name]);
    if (!result.rows[0]) throw new WorkbenchError("Delivery was not found for this Product.", 409, "INVALID_REFERENCE");
    return { workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #createRevision(client, input) {
    const scenario = await client.query("SELECT * FROM workbench_planning_scenarios WHERE id=$1 AND product_id=$2 FOR UPDATE", [input.scenarioId, input.productId]);
    if (!scenario.rows[0]) missing("Scenario");
    if (scenario.rows[0].version !== input.expectedScenarioVersion) throw new WorkbenchError("Scenario changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
    const previous = await client.query("SELECT id,revision_number FROM workbench_planning_scenario_revisions WHERE scenario_id=$1 ORDER BY revision_number DESC LIMIT 1", [input.scenarioId]);
    await client.query("INSERT INTO workbench_planning_scenario_revisions (id,scenario_id,product_id,delivery_id,revision_number,predecessor_revision_id,provenance,input_hash,activities,deliverables,constraints) VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8::jsonb,$9::jsonb,$10::jsonb)", [randomUUID(), input.scenarioId, input.productId, scenario.rows[0].delivery_id, (previous.rows[0]?.revision_number ?? 0) + 1, previous.rows[0]?.id ?? null, input.inputHash, JSON.stringify(input.activities), JSON.stringify(input.deliverables), JSON.stringify(input.constraints)]);
    await client.query("UPDATE workbench_planning_scenarios SET version=version+1,updated_at=now() WHERE id=$1", [input.scenarioId]);
    return { workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #cloneScenario(client, input) {
    await this.#bumpProduct(client, input.productId, input.expectedProductVersion);
    const source = await client.query("SELECT s.delivery_id,r.* FROM workbench_planning_scenarios s JOIN workbench_planning_scenario_revisions r ON r.scenario_id=s.id WHERE s.id=$1 AND s.product_id=$2 AND r.id=$3", [input.scenarioId, input.productId, input.revisionId]);
    if (!source.rows[0]) missing("Scenario revision");
    const scenarioId = randomUUID(); const revisionId = randomUUID(); const row = source.rows[0];
    await client.query("INSERT INTO workbench_planning_scenarios (id,product_id,delivery_id,name,provenance,cloned_from_revision_id) VALUES ($1,$2,$3,$4,'manual',$5)", [scenarioId, input.productId, row.delivery_id, input.name, input.revisionId]);
    await client.query("INSERT INTO workbench_planning_scenario_revisions (id,scenario_id,product_id,delivery_id,revision_number,provenance,input_hash,activities,deliverables,constraints) VALUES ($1,$2,$3,$4,1,'manual',$5,$6::jsonb,$7::jsonb,$8::jsonb)", [revisionId, scenarioId, input.productId, row.delivery_id, row.input_hash, JSON.stringify(row.activities), JSON.stringify(row.deliverables), JSON.stringify(row.constraints)]);
    return { workspace: await this.#readWorkspace(client, input.productId) };
  }
  async #appendActual(client, input) {
    const result = await client.query("INSERT INTO workbench_planning_actuals (id,product_id,scenario_id,activity_id,kind,value,observed_at) SELECT $1,$2,s.id,$4,$5,$6::jsonb,$7 FROM workbench_planning_scenarios s WHERE s.id=$3 AND s.product_id=$2 RETURNING *", [randomUUID(), input.productId, input.scenarioId, input.activityId, input.kind, JSON.stringify(input.value), input.observedAt]);
    if (!result.rows[0]) missing("Scenario");
    const row = result.rows[0]; return { actual: { id: row.id, productId: row.product_id, scenarioId: row.scenario_id, activityId: row.activity_id, kind: row.kind, value: row.value, observedAt: row.observed_at, recordedAt: row.recorded_at } };
  }
  async #saveValidation(client, input) {
    const id = randomUUID();
    await client.query("INSERT INTO workbench_planning_validation_runs (id,product_id,scenario_id,revision_id,as_of,validator_set_version,input_hash,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, input.productId, input.scenarioId, input.revisionId, input.asOf, input.validatorSetVersion, input.inputHash, input.status]);
    for (const item of input.findings) await client.query("INSERT INTO workbench_planning_validation_findings (id,validation_run_id,finding_status,code,message,entity_type,entity_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [item.id, id, item.status, item.code, item.message, item.entityType, item.entityId, JSON.stringify(item.details)]);
    return { id, ...input };
  }
}
