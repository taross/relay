import { WorkbenchError } from "./domain.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkbenchError("The request body must be a JSON object.", 400, "INVALID_PAYLOAD");
  }
  return value;
}

function text(body, key, { optional = false } = {}) {
  const value = body[key];
  if (optional && value === undefined) return "";
  if (typeof value !== "string") throw new WorkbenchError(`${key} must be a string.`, 400, "INVALID_PAYLOAD");
  return value;
}

function version(body, key = "expectedVersion") {
  const value = body[key];
  if (!Number.isInteger(value) || value < 1) throw new WorkbenchError(`${key} must be a positive integer.`, 400, "INVALID_PAYLOAD");
  return value;
}

function uuid(value, label) {
  if (!UUID_PATTERN.test(value)) throw new WorkbenchError(`${label} must be a UUID.`, 400, "INVALID_PAYLOAD");
  return value;
}

function stringList(body, key) {
  const value = body[key] ?? [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new WorkbenchError(`${key} must be an array of strings.`, 400, "INVALID_PAYLOAD");
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function conflictList(body) {
  const value = body.conflicts ?? [];
  if (!Array.isArray(value)) throw new WorkbenchError("conflicts must be an array.", 400, "INVALID_PAYLOAD");
  return value.map((entry) => {
    const item = record(entry);
    if (typeof item.targetExternalKey !== "string" || typeof item.resolved !== "boolean") {
      throw new WorkbenchError("Each conflict requires targetExternalKey and resolved.", 400, "INVALID_PAYLOAD");
    }
    return { targetExternalKey: item.targetExternalKey.trim(), resolved: item.resolved };
  }).filter((item) => item.targetExternalKey);
}

function decision(body) {
  return {
    expectedVersion: version(body),
    expectedFeatureVersion: version(body, "expectedFeatureVersion"),
    rationale: text(body, "rationale"),
  };
}

function editArtifact(body) {
  return {
    expectedVersion: version(body),
    expectedFeatureVersion: version(body, "expectedFeatureVersion"),
    externalKey: text(body, "externalKey"),
    title: text(body, "title"),
    text: text(body, "text"),
    referenceKeys: stringList(body, "referenceKeys"),
    conflicts: conflictList(body),
  };
}

function commandId(headers) {
  const value = headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new WorkbenchError("A valid Idempotency-Key header is required for this command.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return value.trim();
}

function commandResponse(result) {
  return {
    status: result.status,
    body: result.body,
    headers: result.replayed ? { "Idempotent-Replay": "true" } : {},
  };
}

export async function dispatchWorkbenchRequest(request, service) {
  const method = request.method.toUpperCase();
  const pathname = request.url.split(/[?#]/, 1)[0];
  const body = request.body === undefined ? undefined : record(request.body);
  const headers = request.headers ?? {};

  if (method === "GET" && pathname === "/api/workbench/products") {
    return { status: 200, body: { products: await service.listProducts() }, headers: {} };
  }
  if (method === "POST" && pathname === "/api/workbench/products") {
    return commandResponse(await service.createProduct(commandId(headers), {
      name: text(body, "name"),
      description: text(body, "description", { optional: true }),
    }));
  }

  let match = pathname.match(/^\/api\/workbench\/products\/([^/]+)$/);
  if (method === "GET" && match) {
    return { status: 200, body: await service.getProduct(uuid(decodeURIComponent(match[1]), "productId")), headers: {} };
  }
  match = pathname.match(/^\/api\/workbench\/products\/([^/]+)\/features$/);
  if (method === "POST" && match) {
    return commandResponse(await service.createFeature(commandId(headers), uuid(decodeURIComponent(match[1]), "productId"), {
      expectedProductVersion: version(body, "expectedProductVersion"),
      name: text(body, "name"),
      summary: text(body, "summary", { optional: true }),
    }));
  }

  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)$/);
  if (method === "GET" && match) {
    return { status: 200, body: await service.getFeature(uuid(decodeURIComponent(match[1]), "featureId")), headers: {} };
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/sources$/);
  if (method === "POST" && match) {
    const provenance = text(body, "provenance");
    if (!["Manual", "Deterministic Sample"].includes(provenance)) throw new WorkbenchError("provenance must be Manual or Deterministic Sample.", 400, "INVALID_PAYLOAD");
    return commandResponse(await service.addSource(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), {
      expectedVersion: version(body), content: text(body, "content"), provenance,
    }));
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/candidates$/);
  if (method === "POST" && match) {
    return commandResponse(await service.createCandidate(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), {
      expectedVersion: version(body), sourceId: uuid(text(body, "sourceId"), "sourceId"), externalKey: text(body, "externalKey"), title: text(body, "title"), text: text(body, "text"),
    }));
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/candidates\/([^/]+)$/);
  if (method === "PUT" && match) {
    return commandResponse(await service.editCandidate(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), uuid(decodeURIComponent(match[2]), "candidateId"), editArtifact(body)));
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/candidates\/([^/]+)\/(accept|reject)$/);
  if (method === "POST" && match) {
    const input = decision(body);
    if (match[3] === "accept") {
      input.referenceKeys = stringList(body, "referenceKeys");
      input.conflicts = conflictList(body);
      return commandResponse(await service.acceptCandidate(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), uuid(decodeURIComponent(match[2]), "candidateId"), input));
    }
    return commandResponse(await service.rejectCandidate(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), uuid(decodeURIComponent(match[2]), "candidateId"), input));
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/requirements\/([^/]+)$/);
  if (method === "PUT" && match) {
    return commandResponse(await service.editRequirement(commandId(headers), uuid(decodeURIComponent(match[1]), "featureId"), uuid(decodeURIComponent(match[2]), "revisionId"), editArtifact(body)));
  }
  match = pathname.match(/^\/api\/workbench\/features\/([^/]+)\/(validate|request-review|request-changes|approve)$/);
  if (method === "POST" && match) {
    const featureId = uuid(decodeURIComponent(match[1]), "featureId");
    const expectedVersion = version(body);
    if (match[2] === "validate") return commandResponse(await service.validateFeature(commandId(headers), featureId, { expectedVersion }));
    const actorName = text(body, "actorName");
    const rationale = text(body, "rationale");
    if (match[2] === "request-review") return commandResponse(await service.requestReview(commandId(headers), featureId, { expectedVersion, actorName, rationale }));
    if (match[2] === "request-changes") return commandResponse(await service.requestChanges(commandId(headers), featureId, { expectedVersion, actorName, rationale }));
    return commandResponse(await service.approve(commandId(headers), featureId, {
      expectedVersion, actorName, rationale, warningRationale: text(body, "warningRationale", { optional: true }),
    }));
  }

  return null;
}

export async function handleWorkbenchHttp(request, response, service, readJson, sendJson) {
  if (!request.url?.startsWith("/api/workbench/")) return false;
  try {
    const body = request.method === "GET" ? undefined : await readJson(request);
    const result = await dispatchWorkbenchRequest({ method: request.method ?? "GET", url: request.url, headers: request.headers, body }, service);
    if (!result) {
      sendJson(response, 404, { error: "Workbench API endpoint not found", code: "NOT_FOUND" });
      return true;
    }
    response.writeHead(result.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...result.headers,
    });
    response.end(JSON.stringify(result.body));
  } catch (error) {
    let status = 500;
    if (Number.isInteger(error?.status)) status = error.status;
    else if (error instanceof SyntaxError) status = 400;

    const body = {
      error: error?.message || "Workbench request failed",
      code: error?.code || (status === 400 ? "INVALID_JSON" : "INTERNAL_ERROR"),
    };
    if (error?.details) body.details = error.details;
    sendJson(response, status, body);
  }
  return true;
}
