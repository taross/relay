import test from "node:test";
import assert from "node:assert/strict";
import { dispatchWorkbenchRequest, handleWorkbenchHttp } from "../workbench/api.mjs";
import { MemoryWorkbenchRepository } from "../workbench/memory-repository.mjs";
import { WorkbenchService, hashCommand } from "../workbench/service.mjs";

function setup() {
  return new WorkbenchService(new MemoryWorkbenchRepository());
}

async function assertRejectsCode(operation, code, status) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

test("command hashing is canonical and distinguishes changed payloads", () => {
  assert.equal(hashCommand("create", { b: 2, a: 1 }), hashCommand("create", { a: 1, b: 2 }));
  assert.notEqual(hashCommand("create", { a: 1 }), hashCommand("create", { a: 2 }));
});

test("application service persists the Requirements approval flow and creates a successor", async () => {
  const service = setup();
  const productResult = await service.createProduct("product-command", { name: "Checkout", description: "Checkout delivery" });
  const product = productResult.body;
  assert.equal(productResult.status, 201);

  const replay = await service.createProduct("product-command", { description: "Checkout delivery", name: "Checkout" });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body, product);
  await assertRejectsCode(
    () => service.createProduct("product-command", { name: "Different", description: "Checkout delivery" }),
    "IDEMPOTENCY_KEY_REUSED",
  );

  const featureResult = await service.createFeature("feature-command", product.id, {
    expectedProductVersion: 1,
    name: "Saved cart",
    summary: "Keep a cart between sessions",
  });
  const feature = featureResult.body;
  await assertRejectsCode(
    () => service.addSource("stale-source", feature.id, { expectedVersion: 2, content: "Keep the cart.", provenance: "Manual" }),
    "STALE_VERSION",
    409,
  );

  const sourceResult = await service.addSource("source-command", feature.id, {
    expectedVersion: 1,
    content: "A shopper needs the cart to remain available after signing in again.",
    provenance: "Manual",
  });
  assert.equal(sourceResult.body.source.provenance, "Manual");
  assert.equal(sourceResult.body.feature.reviewState, "Draft");

  const candidateResult = await service.createCandidate("candidate-command", feature.id, {
    expectedVersion: 2,
    sourceId: sourceResult.body.source.id,
    externalKey: "REQ-CART-001",
    title: "Persist the shopper cart",
    text: "The product shall retain a shopper's cart between authenticated sessions.",
  });
  const candidate = candidateResult.body.candidate;
  await assertRejectsCode(
    () => service.requestReview("blocked-review", feature.id, { expectedVersion: 3, actorName: "Rina Reviewer", rationale: "Ready for review." }),
    "VALIDATION_BLOCKED",
  );

  const accepted = await service.acceptCandidate("accept-command", feature.id, candidate.id, {
    expectedVersion: 1,
    expectedFeatureVersion: 3,
    rationale: "This candidate states the recorded need precisely.",
    referenceKeys: [],
    conflicts: [],
  });
  assert.equal(accepted.body.candidate.status, "Accepted");
  assert.equal(accepted.body.revision.state, "Draft");

  const inReview = await service.requestReview("review-command", feature.id, {
    expectedVersion: 4,
    actorName: "Rina Reviewer",
    rationale: "The Requirement is ready for a human decision.",
  });
  assert.equal(inReview.body.feature.reviewState, "In Review");
  assert.equal(inReview.body.validation.findings[0].severity, "Warning");

  const changesRequested = await service.requestChanges("changes-command", feature.id, {
    expectedVersion: 5,
    actorName: "Rina Reviewer",
    rationale: "Clarify the session boundary before approval.",
  });
  assert.equal(changesRequested.body.feature.reviewState, "Changes Requested");
  const reviewedAgain = await service.requestReview("second-review-command", feature.id, {
    expectedVersion: 6,
    actorName: "Rina Reviewer",
    rationale: "The recorded Requirement is acceptable for this Phase 1 baseline.",
  });
  assert.equal(reviewedAgain.body.feature.reviewState, "In Review");

  await assertRejectsCode(
    () => service.approve("approval-without-warning-rationale", feature.id, {
      expectedVersion: 7,
      actorName: "Ari Approver",
      rationale: "The Requirement is suitable.",
      warningRationale: "",
    }),
    "WARNING_RATIONALE_REQUIRED",
  );

  const approvalInput = {
    expectedVersion: 7,
    actorName: "Ari Approver",
    rationale: "The frozen Requirement defines the intended behavior.",
    warningRationale: "The Product has no upstream Requirement set in Phase 1.",
  };
  const approved = await service.approve("approval-command", feature.id, approvalInput);
  assert.equal(approved.status, 201);
  assert.equal(approved.body.baseline.baselineNumber, 1);
  assert.equal(approved.body.baseline.feature.reviewState, "Approved");

  const approvalReplay = await service.approve("approval-command", feature.id, approvalInput);
  assert.equal(approvalReplay.replayed, true);
  assert.equal(approvalReplay.body.baseline.id, approved.body.baseline.id);

  const approvedWorkspace = await service.getFeature(feature.id);
  const approvedRevision = approvedWorkspace.requirements[0];
  assert.equal(approvedRevision.state, "Approved");
  assert.equal(approvedWorkspace.baselines.length, 1);

  const addedAfterApproval = await service.addSource("post-approval-source", feature.id, {
    expectedVersion: 8,
    content: "The cart should also survive a browser restart.",
    provenance: "Manual",
  });
  assert.equal(addedAfterApproval.body.feature.reviewState, "Draft");
  const reopenedWorkspace = await service.getFeature(feature.id);
  assert.equal(reopenedWorkspace.baselines[0].validity, "Impacted");
  assert.equal(reopenedWorkspace.baselines[0].approval.rationale, approvalInput.rationale);

  const successor = await service.editRequirement("successor-command", feature.id, approvedRevision.id, {
    expectedVersion: approvedRevision.version,
    expectedFeatureVersion: 9,
    externalKey: "REQ-CART-001A",
    title: "Persist the shopper cart after sign-in",
    text: "The product shall restore a shopper's cart on the next authenticated session.",
    referenceKeys: [],
    conflicts: [],
  });
  assert.equal(successor.status, 201);
  assert.equal(successor.body.revision.predecessorRevisionId, approvedRevision.id);
  assert.equal(successor.body.revision.state, "Draft");
  assert.equal(successor.body.feature.reviewState, "Draft");

  const successorWorkspace = await service.getFeature(feature.id);
  assert.equal(successorWorkspace.baselines.length, 1);
  assert.equal(successorWorkspace.baselines[0].validity, "Impacted");
  assert.equal(successorWorkspace.baselines[0].approval.rationale, approvalInput.rationale);
  assert.equal(successorWorkspace.requirements[0].externalKey, "REQ-CART-001A");
  await assertRejectsCode(
    () => service.editRequirement("mutate-frozen-command", feature.id, approvedRevision.id, {
      expectedVersion: approvedRevision.version,
      expectedFeatureVersion: 10,
      externalKey: "REQ-MUTATED",
      title: "Mutation",
      text: "This direct mutation must fail.",
      referenceKeys: [],
      conflicts: [],
    }),
    "IMMUTABLE_REVISION",
    409,
  );
});

test("candidate edits and rejection decisions persist and cannot be overwritten", async () => {
  const service = setup();
  const product = (await service.createProduct("reject-product", { name: "Catalog", description: "" })).body;
  const feature = (await service.createFeature("reject-feature", product.id, { expectedProductVersion: 1, name: "Search", summary: "" })).body;
  const sourceResult = await service.addSource("reject-source", feature.id, { expectedVersion: 1, content: "Search should tolerate a typo.", provenance: "Deterministic Sample" });
  const candidateResult = await service.createCandidate("reject-candidate", feature.id, {
    expectedVersion: 2,
    sourceId: sourceResult.body.source.id,
    externalKey: "REQ-SEARCH-1",
    title: "Initial wording",
    text: "Search might work.",
  });
  const candidate = candidateResult.body.candidate;
  const edited = await service.editCandidate("edit-candidate", feature.id, candidate.id, {
    expectedVersion: 1,
    expectedFeatureVersion: 3,
    externalKey: "REQ-SEARCH-001",
    title: "Typo-tolerant search",
    text: "The Product shall return relevant results for a single-character query typo.",
    referenceKeys: [],
    conflicts: [],
  });
  const rejected = await service.rejectCandidate("reject-decision", feature.id, candidate.id, {
    expectedVersion: 2,
    expectedFeatureVersion: 4,
    rationale: "This belongs in a later Feature scope.",
  });
  assert.equal(edited.body.candidate.title, "Typo-tolerant search");
  assert.equal(rejected.body.candidate.status, "Rejected");
  const workspace = await service.getFeature(feature.id);
  assert.equal(workspace.candidates[0].decisionRationale, "This belongs in a later Feature scope.");
  await assertRejectsCode(
    () => service.acceptCandidate("accept-rejected", feature.id, candidate.id, {
      expectedVersion: 3,
      expectedFeatureVersion: 5,
      rationale: "Attempt to overwrite a terminal decision.",
      referenceKeys: [],
      conflicts: [],
    }),
    "CANDIDATE_DISPOSITIONED",
  );
});

test("API dispatch validates runtime payloads and returns idempotent command responses", async () => {
  const service = setup();
  await assertRejectsCode(
    () => dispatchWorkbenchRequest({ method: "POST", url: "/api/workbench/products", headers: {}, body: { name: "Product" } }, service),
    "IDEMPOTENCY_KEY_REQUIRED",
  );
  await assertRejectsCode(
    () => dispatchWorkbenchRequest({ method: "POST", url: "/api/workbench/products", headers: { "idempotency-key": "invalid-payload" }, body: { name: 42 } }, service),
    "INVALID_PAYLOAD",
  );

  const request = {
    method: "POST",
    url: "/api/workbench/products",
    headers: { "idempotency-key": "api-create-product" },
    body: { name: "API Product", description: "Created through the API dispatch seam." },
  };
  const created = await dispatchWorkbenchRequest(request, service);
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "API Product");
  const replayed = await dispatchWorkbenchRequest(request, service);
  assert.equal(replayed.headers["Idempotent-Replay"], "true");

  const products = await dispatchWorkbenchRequest({ method: "GET", url: "/api/workbench/products", headers: {} }, service);
  assert.equal(products.status, 200);
  assert.equal(products.body.products.length, 1);

  let responseStatus = 0;
  let responseBody;
  const response = {
    writeHead(status) { responseStatus = status; },
    end(value) { responseBody = JSON.parse(value); },
  };
  const handled = await handleWorkbenchHttp(
    {
      method: "PUT",
      url: "/api/workbench/features/00000000-0000-4000-8000-000000000001/baselines/00000000-0000-4000-8000-000000000002",
      headers: { "idempotency-key": "attempt-baseline-mutation" },
    },
    response,
    service,
    async () => ({ validity: "Current" }),
    (target, status, body) => {
      target.writeHead(status);
      target.end(JSON.stringify(body));
    },
  );
  assert.equal(handled, true);
  assert.equal(responseStatus, 404);
  assert.equal(responseBody.code, "NOT_FOUND");
});
