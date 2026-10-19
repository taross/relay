import { WorkbenchError } from "./domain.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASE_BY_SLUG = {
  specification: "Specification",
  design: "Solution Design",
  verification: "Verification Planning",
  readiness: "Delivery Readiness",
};

function record(value, label = "request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError(`The ${label} must be a JSON object.`, 400, "INVALID_PAYLOAD");
  return value;
}

function text(body, key, optional = false) {
  const value = body[key];
  if (optional && value === undefined) return "";
  if (typeof value !== "string") throw new WorkbenchError(`${key} must be a string.`, 400, "INVALID_PAYLOAD");
  return value;
}

function positiveInteger(body, key) {
  const value = body[key];
  if (!Number.isInteger(value) || value < 1) throw new WorkbenchError(`${key} must be a positive integer.`, 400, "INVALID_PAYLOAD");
  return value;
}

function optionalPositiveInteger(body, key) {
  if (body[key] === undefined || body[key] === null) return null;
  return positiveInteger(body, key);
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new WorkbenchError(`${label} must be a UUID.`, 400, "INVALID_PAYLOAD");
  return value;
}

function uuidList(body, key) {
  const value = body[key] ?? [];
  if (!Array.isArray(value)) throw new WorkbenchError(`${key} must be an array.`, 400, "INVALID_PAYLOAD");
  return value.map((item) => uuid(item, `${key} item`));
}

function objectList(body, key, mapper) {
  const value = body[key] ?? [];
  if (!Array.isArray(value)) throw new WorkbenchError(`${key} must be an array.`, 400, "INVALID_PAYLOAD");
  return value.map((item) => mapper(record(item, `${key} item`)));
}

function commandId(headers) {
  const value = headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new WorkbenchError("A valid Idempotency-Key header is required for this command.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  return value.trim();
}

function response(result) {
  return { status: result.status, body: result.body, headers: result.replayed ? { "Idempotent-Replay": "true" } : {} };
}

function commonArtifact(body) {
  return {
    expectedFeatureVersion: positiveInteger(body, "expectedFeatureVersion"),
    expectedPhaseVersion: positiveInteger(body, "expectedPhaseVersion"),
    expectedRevisionVersion: optionalPositiveInteger(body, "expectedRevisionVersion"),
    authorName: text(body, "authorName"),
    title: text(body, "title"),
  };
}

function reviewInput(body) {
  return {
    expectedFeatureVersion: positiveInteger(body, "expectedFeatureVersion"),
    expectedPhaseVersion: positiveInteger(body, "expectedPhaseVersion"),
    actorName: text(body, "actorName"),
    rationale: text(body, "rationale"),
    warningRationale: text(body, "warningRationale", true),
  };
}

export async function dispatchPhase2Request(request, service) {
  const method = request.method.toUpperCase();
  const pathname = request.url.split(/[?#]/, 1)[0];
  const body = request.body === undefined ? undefined : record(request.body);
  const headers = request.headers ?? {};

  let match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/phase2$/);
  if (method === "GET" && match) return { status: 200, body: await service.getWorkspace(uuid(decodeURIComponent(match[1]), "featureId")), headers: {} };

  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/(specification|design|verification-plan)$/);
  if (method === "PUT" && match) {
    const featureId = uuid(decodeURIComponent(match[1]), "featureId");
    const base = commonArtifact(body);
    if (match[2] === "specification") return response(await service.saveSpecification(commandId(headers), featureId, {
      ...base,
      behavior: text(body, "behavior"),
      criteria: objectList(body, "criteria", (item) => ({ key: text(item, "key"), text: text(item, "text"), requirementRevisionIds: uuidList(item, "requirementRevisionIds") })),
      requirementRevisionIds: uuidList(body, "requirementRevisionIds"),
    }));
    if (match[2] === "design") return response(await service.saveDesign(commandId(headers), featureId, {
      ...base,
      summary: text(body, "summary"),
      specificationRevisionIds: uuidList(body, "specificationRevisionIds"),
      requirementRevisionIds: uuidList(body, "requirementRevisionIds"),
      acceptanceCriterionIds: uuidList(body, "acceptanceCriterionIds"),
    }));
    return response(await service.saveVerificationPlan(commandId(headers), featureId, {
      ...base,
      cases: objectList(body, "cases", (item) => ({
        key: text(item, "key"),
        method: text(item, "method"),
        successCriteria: text(item, "successCriteria"),
        executionCondition: text(item, "executionCondition"),
        responsibleTeam: text(item, "responsibleTeam"),
        specificationRevisionIds: uuidList(item, "specificationRevisionIds"),
        requirementRevisionIds: uuidList(item, "requirementRevisionIds"),
        acceptanceCriterionIds: uuidList(item, "acceptanceCriterionIds"),
      })),
    }));
  }

  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/work-packages(?:\/([^/]+))?$/);
  if ((method === "POST" || method === "PUT") && match) {
    if ((method === "POST") === Boolean(match[2])) return null;
    const type = text(body, "type");
    if (!["development", "QA", "other"].includes(type)) throw new WorkbenchError("type must be development, QA, or other.", 400, "INVALID_PAYLOAD");
    return response(await service.saveWorkPackage(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), match[2] ? uuid(decodeURIComponent(match[2]), "workPackageId") : null, {
      expectedFeatureVersion: positiveInteger(body, "expectedFeatureVersion"),
      expectedPhaseVersion: positiveInteger(body, "expectedPhaseVersion"),
      expectedVersion: optionalPositiveInteger(body, "expectedVersion"),
      key: text(body, "key"),
      type,
      description: text(body, "description"),
      owningTeam: text(body, "owningTeam", true),
      predecessorIds: uuidList(body, "predecessorIds"),
      designRevisionIds: uuidList(body, "designRevisionIds"),
      verificationRevisionIds: uuidList(body, "verificationRevisionIds"),
    }));
  }

  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/deliverables(?:\/([^/]+))?$/);
  if ((method === "POST" || method === "PUT") && match) {
    if ((method === "POST") === Boolean(match[2])) return null;
    const targetReleaseTrainId = body.targetReleaseTrainId === null || body.targetReleaseTrainId === undefined ? null : uuid(body.targetReleaseTrainId, "targetReleaseTrainId");
    return response(await service.saveDeliverable(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), match[2] ? uuid(decodeURIComponent(match[2]), "deliverableId") : null, {
      expectedFeatureVersion: positiveInteger(body, "expectedFeatureVersion"),
      expectedPhaseVersion: positiveInteger(body, "expectedPhaseVersion"),
      expectedVersion: optionalPositiveInteger(body, "expectedVersion"),
      name: text(body, "name"),
      description: text(body, "description", true),
      targetSystem: text(body, "targetSystem"),
      targetEnvironment: text(body, "targetEnvironment"),
      artifactRevisionLabel: text(body, "artifactRevisionLabel"),
      targetReleaseTrainId,
      authorName: text(body, "authorName"),
      workPackageIds: uuidList(body, "workPackageIds"),
      predecessorIds: uuidList(body, "predecessorIds"),
      readinessConditions: objectList(body, "readinessConditions", (item) => ({ key: text(item, "key"), text: text(item, "text") })),
    }));
  }

  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/phases\/(specification|design|verification|readiness)\/(validate|request-review|request-changes|approve)$/);
  if (method === "POST" && match) {
    const featureId = uuid(decodeURIComponent(match[1]), "featureId");
    const phase = PHASE_BY_SLUG[match[2]];
    const action = match[3];
    if (action === "validate") return response(await service.validatePhase(commandId(headers), featureId, phase, { expectedFeatureVersion: positiveInteger(body, "expectedFeatureVersion") }));
    const input = reviewInput(body);
    if (action === "request-review") return response(await service.requestReview(commandId(headers), featureId, phase, input));
    if (action === "request-changes") return response(await service.requestChanges(commandId(headers), featureId, phase, input));
    return response(await service.approve(commandId(headers), featureId, phase, input));
  }

  return null;
}

export async function handlePhase2Http(request, responseStream, service, readJson, sendJson) {
  const pathname = request.url?.split(/[?#]/, 1)[0] ?? "";
  const phase2Path = /^\/api\/workbench\/features\/[^/]+\/(?:phase2|specification|design|verification-plan|work-packages(?:\/[^/]+)?|deliverables(?:\/[^/]+)?|phases\/(?:specification|design|verification|readiness)\/(?:validate|request-review|request-changes|approve))$/;
  if (!phase2Path.test(pathname)) return false;
  try {
    const body = request.method === "GET" ? undefined : await readJson(request);
    const result = await dispatchPhase2Request({ method: request.method ?? "GET", url: request.url, headers: request.headers, body }, service);
    if (!result) return false;
    responseStream.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...result.headers });
    responseStream.end(JSON.stringify(result.body));
    return true;
  } catch (error) {
    if (error instanceof WorkbenchError) {
      sendJson(responseStream, error.status, { error: error.message, code: error.code, details: error.details });
      return true;
    }
    throw error;
  }
}
