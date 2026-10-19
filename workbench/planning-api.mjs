import { WorkbenchError } from "./domain.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const match = (path, expression) => path.match(expression);
const commandId = (request) => uuid(request.headers["idempotency-key"] ?? "");

const uuid = (value) => { const decoded = decodeURIComponent(value); if (!UUID_PATTERN.test(decoded)) throw new WorkbenchError("Route identifiers must be UUIDs.", 400, "INVALID_IDENTIFIER"); return decoded; };

async function mutate(request, response, readJson, sendJson, operation) {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkbenchError("The request body must be a JSON object.", 400, "INVALID_PAYLOAD");
  const result = await operation(commandId(request), body);
  response.setHeader("Idempotency-Replayed", String(result.replayed));
  sendJson(response, result.status, result.body);
}

export async function handlePlanningHttp(request, response, service, readJson, sendJson) {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  let route;

  if (request.method === "GET" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning$/))) {
    sendJson(response, 200, await service.getWorkspace(uuid(route[1])));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/policies$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.savePolicy(id, uuid(route[1]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/deliveries$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveDelivery(id, uuid(route[1]), null, body));
    return true;
  }
  if (request.method === "PUT" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/deliveries\/([^/]+)$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveDelivery(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/resources$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveResource(id, uuid(route[1]), null, body));
    return true;
  }
  if (request.method === "PUT" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/resources\/([^/]+)$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveResource(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/trains$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveTrain(id, uuid(route[1]), null, body));
    return true;
  }
  if (request.method === "PUT" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/trains\/([^/]+)$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.saveTrain(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/scenarios$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.createScenario(id, uuid(route[1]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/scenarios\/([^/]+)\/revisions$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.createRevision(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/scenarios\/([^/]+)\/clones$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.cloneScenario(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/scenarios\/([^/]+)\/actuals$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.appendActual(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "POST" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/revisions\/([^/]+)\/validations$/))) {
    await mutate(request, response, readJson, sendJson, (id, body) => service.validateRevision(id, uuid(route[1]), uuid(route[2]), body));
    return true;
  }
  if (request.method === "GET" && (route = match(path, /^\/api\/workbench\/products\/([^/]+)\/planning\/revisions\/([^/]+)\/comparisons\/([^/]+)$/))) {
    sendJson(response, 200, await service.compareRevisions(uuid(route[1]), uuid(route[2]), uuid(route[3])));
    return true;
  }
  return false;
}
