import type { ApiErrorBody, ArtifactPhase, Feature, FeatureWorkspace, JsonValue, Phase2Workspace, PlanningActivity, PlanningActual, PlanningCapacity, PlanningConstraint, PlanningDeliverable, PlanningPolicyRule, PlanningRevisionComparison, PlanningValidation, PlanningWorkspace, Product, ProductDetail } from "./types.js";

function workbenchApiError(status: number, body: ApiErrorBody) {
  const error = new Error(body.error ?? "Workbench request failed");
  error.name = `WorkbenchApiError:${body.code ?? "UNKNOWN_ERROR"}`;
  return Object.assign(error, { status, code: body.code ?? "UNKNOWN_ERROR" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: JsonValue = await response.json();
  if (!response.ok) throw workbenchApiError(response.status, isApiError(body) ? body : {});
  return body as T;
}

function isApiError(value: JsonValue): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value.error === undefined || typeof value.error === "string")
    && (value.code === undefined || typeof value.code === "string")
    && (value.details === undefined || (typeof value.details === "object" && value.details !== null && !Array.isArray(value.details)));
}

function command<T>(path: string, method: "POST" | "PUT", body: { [key: string]: JsonValue }): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

function phaseSlug(phase: ArtifactPhase) {
  if (phase === "Specification") return "specification";
  if (phase === "Solution Design") return "design";
  return "verification";
}

export const workbenchApi = {
  listProducts: () => request<{ products: Product[] }>("/api/workbench/products"),
  getProduct: (productId: string) => request<ProductDetail>(`/api/workbench/products/${encodeURIComponent(productId)}`),
  createProduct: (input: { name: string; description: string }) => command<Product>("/api/workbench/products", "POST", input),
  createFeature: (productId: string, input: { expectedProductVersion: number; name: string; summary: string }) => command<Feature>(`/api/workbench/products/${encodeURIComponent(productId)}/features`, "POST", input),
  getFeature: (featureId: string) => request<FeatureWorkspace>(`/api/workbench/features/${encodeURIComponent(featureId)}`),
  addSource: (featureId: string, input: { expectedVersion: number; content: string; provenance: "Manual" | "Deterministic Sample" }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/sources`, "POST", input),
  createCandidate: (featureId: string, input: { expectedVersion: number; sourceId: string; externalKey: string; title: string; text: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/candidates`, "POST", input),
  editCandidate: (featureId: string, candidateId: string, input: { expectedVersion: number; expectedFeatureVersion: number; externalKey: string; title: string; text: string; referenceKeys: string[]; conflicts: [] }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/candidates/${encodeURIComponent(candidateId)}`, "PUT", input),
  acceptCandidate: (featureId: string, candidateId: string, input: { expectedVersion: number; expectedFeatureVersion: number; rationale: string; referenceKeys: string[]; conflicts: { targetExternalKey: string; resolved: boolean }[] }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/candidates/${encodeURIComponent(candidateId)}/accept`, "POST", input),
  rejectCandidate: (featureId: string, candidateId: string, input: { expectedVersion: number; expectedFeatureVersion: number; rationale: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/candidates/${encodeURIComponent(candidateId)}/reject`, "POST", input),
  editRequirement: (featureId: string, revisionId: string, input: { expectedVersion: number; expectedFeatureVersion: number; externalKey: string; title: string; text: string; referenceKeys: string[]; conflicts: { targetExternalKey: string; resolved: boolean }[] }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/requirements/${encodeURIComponent(revisionId)}`, "PUT", input),
  validate: (featureId: string, expectedVersion: number) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/validate`, "POST", { expectedVersion }),
  requestReview: (featureId: string, input: { expectedVersion: number; actorName: string; rationale: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/request-review`, "POST", input),
  requestChanges: (featureId: string, input: { expectedVersion: number; actorName: string; rationale: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/request-changes`, "POST", input),
  approve: (featureId: string, input: { expectedVersion: number; actorName: string; rationale: string; warningRationale: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/approve`, "POST", input),
  getPhase2Workspace: (featureId: string) => request<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/phase2`),
  saveSpecification: (featureId: string, input: { expectedFeatureVersion: number; expectedPhaseVersion: number; expectedRevisionVersion: number | null; title: string; behavior: string; authorName: string; criteria: { key: string; text: string; requirementRevisionIds: string[] }[]; requirementRevisionIds: string[] }) => command<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/specification`, "PUT", input),
  saveDesign: (featureId: string, input: { expectedFeatureVersion: number; expectedPhaseVersion: number; expectedRevisionVersion: number | null; title: string; summary: string; authorName: string; specificationRevisionIds: string[]; requirementRevisionIds: string[]; acceptanceCriterionIds: string[] }) => command<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/design`, "PUT", input),
  saveVerificationPlan: (featureId: string, input: { expectedFeatureVersion: number; expectedPhaseVersion: number; expectedRevisionVersion: number | null; title: string; authorName: string; cases: { key: string; method: string; successCriteria: string; executionCondition: string; responsibleTeam: string; specificationRevisionIds: string[]; requirementRevisionIds: string[]; acceptanceCriterionIds: string[] }[] }) => command<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/verification-plan`, "PUT", input),
  saveWorkPackage: (featureId: string, input: { id?: string; expectedFeatureVersion: number; expectedPhaseVersion: number; expectedVersion: number | null; key: string; type: "development" | "QA" | "other"; description: string; owningTeam: string; predecessorIds: string[]; designRevisionIds: string[]; verificationRevisionIds: string[] }) => command<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/work-packages${input.id ? `/${encodeURIComponent(input.id)}` : ""}`, input.id ? "PUT" : "POST", input),
  saveDeliverable: (featureId: string, input: { deliverableId?: string; expectedFeatureVersion: number; expectedPhaseVersion: number; expectedVersion: number | null; name: string; description: string; targetSystem: string; targetEnvironment: string; artifactRevisionLabel: string; targetReleaseTrainId: null; authorName: string; workPackageIds: string[]; predecessorIds: string[]; readinessConditions: { key: string; text: string }[] }) => command<Phase2Workspace>(`/api/workbench/features/${encodeURIComponent(featureId)}/deliverables${input.deliverableId ? `/${encodeURIComponent(input.deliverableId)}` : ""}`, input.deliverableId ? "PUT" : "POST", input),
  validatePhase: (featureId: string, phase: ArtifactPhase, expectedFeatureVersion: number) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/phases/${phaseSlug(phase)}/validate`, "POST", { expectedFeatureVersion }),
  transitionPhase: (featureId: string, phase: ArtifactPhase, action: "request-review" | "request-changes" | "approve", input: { expectedFeatureVersion: number; expectedPhaseVersion: number; actorName: string; rationale: string; warningRationale?: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/phases/${phaseSlug(phase)}/${action}`, "POST", input),
  validateDeliveryReadiness: (featureId: string, expectedFeatureVersion: number) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/phases/readiness/validate`, "POST", { expectedFeatureVersion }),
  transitionDeliveryReadiness: (featureId: string, action: "request-review" | "request-changes" | "approve", input: { expectedFeatureVersion: number; expectedPhaseVersion: number; actorName: string; rationale: string; warningRationale?: string }) => command(`/api/workbench/features/${encodeURIComponent(featureId)}/phases/readiness/${action}`, "POST", input),
  getPlanningWorkspace: (productId: string) => request<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning`),
  savePlanningPolicy: (productId: string, input: { expectedProductVersion: number; rules: PlanningPolicyRule[] }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/policies`, "POST", input),
  savePlanningDelivery: (productId: string, deliveryId: string | null, input: { expectedProductVersion: number; expectedVersion?: number; name: string }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/deliveries${deliveryId ? `/${encodeURIComponent(deliveryId)}` : ""}`, deliveryId ? "PUT" : "POST", input),
  savePlanningResource: (productId: string, resourceId: string | null, input: { expectedProductVersion: number; expectedVersion?: number; name: string; capacity: PlanningCapacity[] }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/resources${resourceId ? `/${encodeURIComponent(resourceId)}` : ""}`, resourceId ? "PUT" : "POST", input),
  savePlanningTrain: (productId: string, trainId: string | null, input: { expectedProductVersion: number; expectedVersion?: number; name: string; cutoffAt: string | null }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/trains${trainId ? `/${encodeURIComponent(trainId)}` : ""}`, trainId ? "PUT" : "POST", input),
  createPlanningScenario: (productId: string, input: { expectedProductVersion: number; deliveryId: string; name: string }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/scenarios`, "POST", input),
  createPlanningRevision: (productId: string, scenarioId: string, input: { expectedScenarioVersion: number; activities: PlanningActivity[]; deliverables: PlanningDeliverable[]; constraints: PlanningConstraint[] }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/scenarios/${encodeURIComponent(scenarioId)}/revisions`, "POST", input),
  clonePlanningScenario: (productId: string, scenarioId: string, input: { expectedProductVersion: number; revisionId: string; name: string }) => command<PlanningWorkspace>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/scenarios/${encodeURIComponent(scenarioId)}/clones`, "POST", input),
  appendPlanningActual: (productId: string, scenarioId: string, input: { activityId: string; kind: string; value: JsonValue; observedAt: string }) => command<PlanningActual>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/scenarios/${encodeURIComponent(scenarioId)}/actuals`, "POST", input),
  validatePlanningRevision: (productId: string, revisionId: string, input: { asOf: string; validatorSetVersion?: string }) => command<PlanningValidation>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/revisions/${encodeURIComponent(revisionId)}/validations`, "POST", input),
  comparePlanningRevisions: (productId: string, beforeRevisionId: string, afterRevisionId: string) => request<PlanningRevisionComparison>(`/api/workbench/products/${encodeURIComponent(productId)}/planning/revisions/${encodeURIComponent(beforeRevisionId)}/comparisons/${encodeURIComponent(afterRevisionId)}`),
};
