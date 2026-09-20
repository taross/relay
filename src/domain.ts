export type Id<T extends string> = string & { readonly __type: T };

export type Team = {
  id: Id<"Team">;
  name: string;
  lead: string;
  memberCount: number;
};

export type ComponentKind = "ios" | "android" | "backend" | "admin";

export type Component = {
  id: Id<"Component">;
  name: string;
  kind: ComponentKind;
  ownerTeamId: Team["id"];
  repository: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  githubConnection?: "mock" | "connected" | "disconnected";
  deliveryMethod: string;
};

export type GitHubPullRequest = {
  componentId: Component["id"];
  repository: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: "draft" | "review" | "merged";
  revision: string;
  baseBranch: string;
  labels: string[];
  changedFiles: string[];
  additions: number;
  deletions: number;
  updatedAt: string;
};

export type PullRequest = {
  repository: string;
  number: number;
  revision: string;
  state: "draft" | "review" | "merged";
  title?: string;
  description?: string;
  author?: string;
  url?: string;
  labels?: string[];
  changedFiles?: string[];
  additions?: number;
  deletions?: number;
};

export type MigrationPlan = {
  required: boolean;
  phase?: "expand" | "migrate" | "contract";
  execution?: "online" | "blocking";
  backwardCompatible?: boolean;
  estimatedMinutes?: number;
};

export type MaintenanceRequirement = "none" | "maintenance-mode" | "service-stop" | "undetermined";

export type VersionTransition = {
  currentVersion: string;
  targetVersion: string;
  versionSource?: "manual" | "github" | "deployment" | "app-store" | "google-play";
  rollout: "immediate" | "phased" | "store-phased";
  startsAt: string;
  expectedCompletionAt: string;
  coexistence: "compatible" | "feature-flag" | "incompatible";
  adoptionMilestones: { at: string; percentage: number }[];
};

export type ComponentReleasePlan = VersionTransition & {
  componentId: Component["id"];
};

export type ComponentChange = {
  id: Id<"ComponentChange">;
  componentId: Component["id"];
  ownerTeamId: Team["id"];
  summary: string;
  pullRequests: PullRequest[];
  migration: MigrationPlan;
  maintenance: MaintenanceRequirement;
  dependencyIds: ComponentChange["id"][];
  deploymentWindow: string;
  recovery: string;
  versionTransition?: VersionTransition;
};

export type Verification = {
  id: Id<"Verification">;
  releaseId: Id<"Release">;
  componentChangeId: ComponentChange["id"];
  name: string;
  condition: string;
  ownerTeamId: Team["id"];
  status: "pending" | "running" | "passed" | "failed";
};

export type FeatureChange = {
  id: Id<"FeatureChange">;
  name: string;
  description: string;
  componentChanges: ComponentChange[];
};

export type ReleaseStatus = "draft" | "preparing" | "ready" | "running" | "completed";
export type ApprovalStatus = "not-requested" | "pending" | "approved" | "conditionally-approved" | "rejected" | "invalidated";

export type PlanCandidate = {
  id: string;
  name: string;
  strategy: "fastest" | "compatibility-first" | "split";
  summary: string;
  estimatedCompletionAt: string;
  deterministicRisk: number;
  steps: string[];
  conditions: string[];
};

export type JevPlanEvaluation = {
  recommendation: "accept" | "accept-with-conditions" | "revise" | "reject";
  selectedPlanId: string;
  riskScore: number;
  confidence: number;
  categories: {
    compatibility: number;
    rollout: number;
    recovery: number;
    verification: number;
    schedule: number;
  };
  conditions: string[];
  evaluatedAt: string;
  mock: boolean;
};

export type ReleasePlanDecision = {
  graphRevision: string;
  generatedAt: string;
  candidates: PlanCandidate[];
  selectedPlanId: string;
  evaluation?: JevPlanEvaluation;
};

export type RepositoryReadme = {
  componentId: Component["id"];
  repository: string;
  path: string;
  revision: string;
  summary: string;
  commands: { purpose: string; command: string }[];
  cautions: string[];
};

export type RunbookStep = {
  id: string;
  order: number;
  phase: "precheck" | "migration" | "deploy" | "verify" | "rollout" | "close";
  componentId?: Component["id"];
  title: string;
  instruction: string;
  command?: string;
  expectedResult: string;
  stopCondition?: string;
  recovery?: string;
  sourceRefs: string[];
};

export type ReleaseRunbook = {
  graphRevision: string;
  planId: string;
  generatedAt: string;
  mock: boolean;
  sourceDocuments: { repository: string; path: string; revision: string }[];
  steps: RunbookStep[];
};

export type ReleaseHistoryEntry = {
  id: Id<"ReleaseHistoryEntry">;
  type: "schedule" | "approval" | "note" | "plan" | "jev" | "runbook";
  occurredAt: string;
  actor: string;
  summary: string;
  detail?: string;
};

export type Release = {
  id: Id<"Release">;
  code: string;
  name: string;
  status: ReleaseStatus;
  ownerTeamId: Team["id"];
  scheduledFor: string;
  scheduledAt?: string;
  approvalStatus?: ApprovalStatus;
  approvedBy?: string;
  approvedPlanRevision?: string;
  considerations?: string;
  notes?: string;
  history?: ReleaseHistoryEntry[];
  featureChanges: FeatureChange[];
  verifications: Verification[];
  componentPlans?: ComponentReleasePlan[];
  planDecision?: ReleasePlanDecision;
  runbook?: ReleaseRunbook;
};

export const id = <T extends string>(value: string) => value as Id<T>;
