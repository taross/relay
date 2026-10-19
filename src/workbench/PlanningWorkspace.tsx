import { useCallback, useEffect, useMemo, useState, type SubmitEvent as ReactSubmitEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { workbenchApi } from "./api";
import type { JsonValue, PlanningActivity, PlanningCapacity, PlanningConstraint, PlanningDeliverable, PlanningDelivery, PlanningPolicyRule, PlanningResource, PlanningRevisionComparison, PlanningScenario, PlanningScenarioRevision, PlanningTrain, PlanningWorkspace as PlanningWorkspaceModel } from "./types";
import { FormError, WorkbenchDialog } from "./WorkbenchDialog";

type View = "overview" | "catalog" | "scenarios" | "validation" | "actuals";
type Dialog =
  | { kind: "delivery"; target?: PlanningDelivery }
  | { kind: "resource"; target?: PlanningResource }
  | { kind: "train"; target?: PlanningTrain }
  | { kind: "policy" }
  | { kind: "scenario" }
  | { kind: "revision"; scenario: PlanningScenario }
  | { kind: "clone"; scenario: PlanningScenario; revision: PlanningScenarioRevision }
  | { kind: "actual"; scenario: PlanningScenario };

const iso = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return text ? new Date(text).toISOString() : null;
};
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not set";
const shortId = (value: string) => value.slice(0, 8);
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function jsonValue(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, label));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, label)]));
  throw new Error(`${label} must contain JSON values only.`);
}

function jsonArray(text: string, label: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error(`${label} must be valid JSON.`); }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function requiredString(record: Record<string, unknown>, key: string, label: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} requires a non-empty ${key}.`);
  return value;
}
function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string or null.`);
  return value;
}
function strings(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${key} must be an array of strings.`);
  return value.filter((item): item is string => typeof item === "string");
}
function integer(record: Record<string, unknown>, key: string, minimum: number) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) throw new Error(`${key} must be an integer of at least ${minimum}.`);
  return value;
}
function level(record: Record<string, unknown>) {
  const value = record.level;
  if (value !== "mandatory" && value !== "configurable" && value !== "advisory") throw new Error("level must be mandatory, configurable, or advisory.");
  return value;
}
function objectValue(record: Record<string, unknown>, key: string) {
  const value = record[key] ?? {};
  if (!isRecord(value)) throw new Error(`${key} must be a JSON object.`);
  return jsonValue(value, key);
}

function parseRules(text: string): PlanningPolicyRule[] {
  return jsonArray(text, "Rules").map((value) => {
    if (!isRecord(value)) throw new Error("Each rule must be a JSON object.");
    const parameters = objectValue(value, "parameters");
    if (!isRecord(parameters)) throw new Error("Rule parameters must be a JSON object.");
    return { id: requiredString(value, "id", "Each rule"), level: level(value), kind: requiredString(value, "kind", "Each rule"), ruleVersion: requiredString(value, "ruleVersion", "Each rule"), parameters };
  });
}
function parseCapacity(text: string): PlanningCapacity[] {
  return jsonArray(text, "Capacity").map((value) => {
    if (!isRecord(value)) throw new Error("Each capacity period must be a JSON object.");
    return { effectiveFrom: new Date(requiredString(value, "effectiveFrom", "Each capacity period")).toISOString(), effectiveTo: optionalString(value, "effectiveTo"), units: integer(value, "units", 0) };
  });
}
function parseActivities(text: string, productId: string): PlanningActivity[] {
  return jsonArray(text, "Activities").map((value) => {
    if (!isRecord(value)) throw new Error("Each activity must be a JSON object.");
    const demandsValue = value.demands;
    if (!Array.isArray(demandsValue)) throw new Error("Activity demands must be an array.");
    const demands = demandsValue.map((demand) => {
      if (!isRecord(demand)) throw new Error("Each demand must be a JSON object.");
      return { resourceId: requiredString(demand, "resourceId", "Each demand"), units: integer(demand, "units", 1) };
    });
    return { id: requiredString(value, "id", "Each activity"), productId, name: requiredString(value, "name", "Each activity"), startAt: new Date(requiredString(value, "startAt", "Each activity")).toISOString(), endAt: new Date(requiredString(value, "endAt", "Each activity")).toISOString(), predecessorIds: strings(value, "predecessorIds"), demands };
  });
}
function parseDeliverables(text: string, productId: string): PlanningDeliverable[] {
  return jsonArray(text, "Deliverables").map((value) => {
    if (!isRecord(value)) throw new Error("Each deliverable must be a JSON object.");
    return { id: requiredString(value, "id", "Each deliverable"), productId, name: requiredString(value, "name", "Each deliverable"), order: integer(value, "order", 0), predecessorIds: strings(value, "predecessorIds"), trainId: optionalString(value, "trainId"), readyAt: optionalString(value, "readyAt") };
  });
}
function parseConstraints(text: string): PlanningConstraint[] {
  return jsonArray(text, "Constraints").map((value) => {
    if (!isRecord(value)) throw new Error("Each constraint must be a JSON object.");
    const override = value.override ?? false;
    const requiresEvidence = value.requiresEvidence ?? false;
    if (typeof override !== "boolean" || typeof requiresEvidence !== "boolean") throw new Error("Constraint override and requiresEvidence values must be boolean.");
    return { id: requiredString(value, "id", "Each constraint"), level: level(value), kind: requiredString(value, "kind", "Each constraint"), ruleVersion: requiredString(value, "ruleVersion", "Each constraint"), requiresEvidence, evidence: jsonValue(value.evidence ?? null, "Constraint evidence"), override, overrideRationale: optionalString(value, "overrideRationale") };
  });
}

export function PlanningWorkspace() {
  const { productId = "" } = useParams();
  const [workspace, setWorkspace] = useState<PlanningWorkspaceModel | null>(null);
  const [view, setView] = useState<View>("overview");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<PlanningRevisionComparison | null>(null);
  const [beforeRevisionId, setBeforeRevisionId] = useState("");
  const [afterRevisionId, setAfterRevisionId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setWorkspace(await workbenchApi.getPlanningWorkspace(productId)); }
    catch (reason) { setError(message(reason)); }
  }, [productId]);
  useEffect(() => { void load(); }, [load]);
  const revisions = useMemo(() => workspace?.scenarios.flatMap((scenario) => scenario.revisions.map((revision) => ({ scenario, revision }))) ?? [], [workspace]);

  const run = async (task: () => Promise<unknown>, reload = true, propagate = false) => {
    setBusy(true); setError("");
    try { await task(); if (reload) await load(); }
    catch (reason) { setError(message(reason)); if (propagate) throw reason; }
    finally { setBusy(false); }
  };
  const validate = (revision: PlanningScenarioRevision) => run(() => workbenchApi.validatePlanningRevision(productId, revision.id, { asOf: new Date().toISOString(), validatorSetVersion: "planning-deterministic-v1" }));
  const compare = async () => {
    if (!beforeRevisionId || !afterRevisionId) { setError("Select both revisions before comparing them."); return; }
    setBusy(true); setError("");
    try { setComparison(await workbenchApi.comparePlanningRevisions(productId, beforeRevisionId, afterRevisionId)); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };

  if (!workspace) return <section className="workbench-view"><Link to={`/products/${productId}`}>← Product</Link><FormError message={error} />{!error ? <p>Loading Planning workspace…</p> : null}</section>;
  const latestPolicy = workspace.policies.at(-1);
  const latestValidation = workspace.validations.at(-1);
  const scenarioCount = workspace.scenarios.length;
  return <section className="workbench-view planning-workspace">
    <nav className="workbench-context" aria-label="Planning breadcrumb"><Link to="/products">Products</Link><span aria-hidden="true">/</span><Link to={`/products/${workspace.product.id}`}>{workspace.product.name}</Link><span aria-hidden="true">/</span><span aria-current="page">Planning</span></nav>
    <header className="workbench-heading"><div><span className="eyebrow">Product-scoped delivery planning</span><h1>Planning</h1><p>Manual plans with Deterministic Validation. No solver or AI is connected; every Scenario and revision is entered by a person.</p></div><div className="workbench-actions"><button className="ghost" onClick={() => void load()} disabled={busy}>Reload</button><button className="primary" onClick={() => setDialog({ kind: "scenario" })} disabled={!workspace.deliveries.length}>Create Scenario</button></div></header>
    <FormError message={error} />
    <div className="workbench-status-grid planning-status"><section><span>Catalog</span><b>{workspace.deliveries.length} deliveries</b><p>{workspace.resources.length} resources · {workspace.trains.length} trains</p></section><section><span>Manual scenarios</span><b>{scenarioCount}</b><p>{revisions.length} immutable revisions</p></section><section><span>Deterministic Validation</span><b>{latestValidation?.status ?? "Not run"}</b><p>{latestValidation ? `${latestValidation.findings.length} findings at ${dateTime(latestValidation.asOf)}` : "Run validation against an exact revision."}</p></section></div>
    <nav className="planning-tabs" aria-label="Planning workspace views">{([['overview','Overview'],['catalog','Catalog'],['scenarios','Scenarios'],['validation','Validation & comparison'],['actuals','Actuals']] as const).map(([id, label]) => <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}</button>)}</nav>
    {view === "overview" ? <Overview workspace={workspace} latestPolicy={latestPolicy} setView={setView} /> : null}
    {view === "catalog" ? <Catalog workspace={workspace} open={setDialog} /> : null}
    {view === "scenarios" ? <Scenarios workspace={workspace} busy={busy} open={setDialog} validate={validate} /> : null}
    {view === "validation" ? <Validation workspace={workspace} revisions={revisions} beforeRevisionId={beforeRevisionId} afterRevisionId={afterRevisionId} setBefore={setBeforeRevisionId} setAfter={setAfterRevisionId} compare={compare} comparison={comparison} busy={busy} /> : null}
    {view === "actuals" ? <Actuals workspace={workspace} open={setDialog} /> : null}
    {dialog ? <PlanningDialog dialog={dialog} workspace={workspace} close={() => setDialog(null)} save={(task) => run(task, true, true)} /> : null}
  </section>;
}

function Overview({ workspace, latestPolicy, setView }: { workspace: PlanningWorkspaceModel; latestPolicy: PlanningWorkspaceModel["policies"][number] | undefined; setView: (view: View) => void }) {
  const blocked = workspace.validations.filter((item) => item.status === "blocked").length;
  return <div className="planning-panel"><section className="planning-summary"><header><div><span className="eyebrow">Current planning record</span><h2>Execution inputs</h2></div><span>Product version {workspace.product.version}</span></header><dl><div><dt>Planning Policy</dt><dd>{latestPolicy ? `Revision ${latestPolicy.revisionNumber} · ${latestPolicy.rules.length} rules` : "No revision"}</dd></div><div><dt>Capacity periods</dt><dd>{workspace.resources.reduce((count, item) => count + item.capacity.length, 0)}</dd></div><div><dt>Train cutoffs</dt><dd>{workspace.trains.filter((item) => item.cutoffAt).length} of {workspace.trains.length}</dd></div><div><dt>Blocked validations</dt><dd>{blocked}</dd></div></dl></section><section className="planning-blockers"><header><h2>Planning constraints</h2><span>Operational requirements</span></header><p>The release manager must create a Delivery before creating a Manual Scenario.</p><p>The planning owner must provide explicit capacity periods and Train cutoffs before relying on schedule validation.</p><p>The approver must resolve every violated or unknown Deterministic Validation finding before approval.</p><div className="record-actions"><button className="ghost" onClick={() => setView("catalog")}>Review catalog</button><button className="ghost" onClick={() => setView("validation")}>Review validation</button></div></section></div>;
}

function Catalog({ workspace, open }: { workspace: PlanningWorkspaceModel; open: (dialog: Dialog) => void }) {
  return <div className="planning-panel"><section className="workbench-section"><header><div><h2>Deliveries</h2><span>{workspace.deliveries.length}</span></div><button className="ghost" onClick={() => open({ kind: "delivery" })}>Add Delivery</button></header>{workspace.deliveries.length ? workspace.deliveries.map((item) => <article className="planning-record" key={item.id}><div><b>{item.name}</b><span>Version {item.version} · {shortId(item.id)}</span></div><button className="ghost" onClick={() => open({ kind: "delivery", target: item })}>Edit</button></article>) : <p className="workbench-empty">Add a Delivery to scope Manual Scenarios.</p>}</section>
  <section className="workbench-section"><header><div><h2>Planning Policy revisions</h2><span>{workspace.policies.length}</span></div><button className="ghost" onClick={() => open({ kind: "policy" })}>New revision</button></header>{[...workspace.policies].reverse().map((policy) => <article className="planning-record" key={policy.id}><div><b>Revision {policy.revisionNumber}</b><span>{policy.rules.length} rules · {dateTime(policy.createdAt)}</span><details className="planning-input"><summary>View policy rules</summary><pre>{JSON.stringify(policy.rules, null, 2)}</pre></details></div><span className="mono">{shortId(policy.id)}</span></article>)}{!workspace.policies.length ? <p className="workbench-empty">No Planning Policy revision has been recorded.</p> : null}</section>
  <section className="workbench-section"><header><div><h2>Resources and dated capacity</h2><span>{workspace.resources.length}</span></div><button className="ghost" onClick={() => open({ kind: "resource" })}>Add Resource</button></header>{workspace.resources.map((item) => <article className="planning-record" key={item.id}><div><b>{item.name}</b><span>{item.capacity.length ? item.capacity.map((period) => `${period.units} from ${dateTime(period.effectiveFrom)}${period.effectiveTo ? ` to ${dateTime(period.effectiveTo)}` : " onward"}`).join("; ") : "Capacity is unknown."}</span></div><button className="ghost" onClick={() => open({ kind: "resource", target: item })}>Edit</button></article>)}{!workspace.resources.length ? <p className="workbench-empty">Add Resources and explicit dated capacity.</p> : null}</section>
  <section className="workbench-section"><header><div><h2>Trains and cutoffs</h2><span>{workspace.trains.length}</span></div><button className="ghost" onClick={() => open({ kind: "train" })}>Add Train</button></header>{workspace.trains.map((item) => <article className="planning-record" key={item.id}><div><b>{item.name}</b><span>{item.cutoffAt ? `Cutoff ${dateTime(item.cutoffAt)}` : "The release manager has not set a cutoff."}</span></div><button className="ghost" onClick={() => open({ kind: "train", target: item })}>Edit</button></article>)}{!workspace.trains.length ? <p className="workbench-empty">Add a Train to assign planned Deliverables.</p> : null}</section></div>;
}

function Scenarios({ workspace, busy, open, validate }: { workspace: PlanningWorkspaceModel; busy: boolean; open: (dialog: Dialog) => void; validate: (revision: PlanningScenarioRevision) => Promise<void> }) {
  return <div className="planning-panel"><div className="planning-truth-note"><b>Manual only.</b> The workspace stores exactly what a person enters. Deterministic Validation checks those inputs; it does not generate or optimize a schedule.</div>{workspace.scenarios.map((scenario) => <section className="workbench-section scenario-section" key={scenario.id}><header><div><h2>{scenario.name}</h2><span>Manual · {workspace.deliveries.find((delivery) => delivery.id === scenario.deliveryId)?.name ?? "Unknown Delivery"} · version {scenario.version} · {scenario.revisions.length} revisions</span></div><button className="primary" onClick={() => open({ kind: "revision", scenario })}>Add revision</button></header>{scenario.revisions.map((revision) => <article className="revision-record" key={revision.id}><div><b>Revision {revision.revisionNumber}</b><span>{revision.activities.length} activities · {revision.deliverables.length} deliverables · {revision.constraints.length} constraints</span><code>{revision.inputHash}</code><details className="planning-input"><summary>View exact manual input</summary><h3>Activities</h3><pre>{JSON.stringify(revision.activities, null, 2)}</pre><h3>Deliverables</h3><pre>{JSON.stringify(revision.deliverables, null, 2)}</pre><h3>Constraints</h3><pre>{JSON.stringify(revision.constraints, null, 2)}</pre></details></div><div className="record-actions"><button className="ghost" disabled={busy} onClick={() => void validate(revision)}>Validate</button><button className="ghost" onClick={() => open({ kind: "clone", scenario, revision })}>Clone</button></div></article>)}{!scenario.revisions.length ? <p className="workbench-empty">Add a Manual revision with explicit activities, Deliverables, and constraints.</p> : null}</section>)}{!workspace.scenarios.length ? <p className="workbench-empty">Create a Manual Scenario from a Delivery to begin planning.</p> : null}</div>;
}

type RevisionOption = { scenario: PlanningScenario; revision: PlanningScenarioRevision };
function Validation({ workspace, revisions, beforeRevisionId, afterRevisionId, setBefore, setAfter, compare, comparison, busy }: { workspace: PlanningWorkspaceModel; revisions: RevisionOption[]; beforeRevisionId: string; afterRevisionId: string; setBefore: (id: string) => void; setAfter: (id: string) => void; compare: () => Promise<void>; comparison: PlanningRevisionComparison | null; busy: boolean }) {
  const label = (item: RevisionOption) => `${item.scenario.name} · revision ${item.revision.revisionNumber} · ${shortId(item.revision.id)}`;
  return <div className="planning-panel"><section className="workbench-section"><header><div><h2>Exact revision comparison</h2><span>Canonical field and collection differences</span></div></header><div className="comparison-controls"><label>Before revision<select value={beforeRevisionId} onChange={(event) => setBefore(event.target.value)}><option value="">Select a revision</option>{revisions.map((item) => <option value={item.revision.id} key={item.revision.id}>{label(item)}</option>)}</select></label><label>After revision<select value={afterRevisionId} onChange={(event) => setAfter(event.target.value)}><option value="">Select a revision</option>{revisions.map((item) => <option value={item.revision.id} key={item.revision.id}>{label(item)}</option>)}</select></label><button className="primary" disabled={busy || revisions.length < 2} onClick={() => void compare()}>Compare exact revisions</button></div>{comparison ? <div className="comparison-result"><b>{comparison.equal ? "The revisions are exactly equal." : `${comparison.fields.length + comparison.collections.length} differences found.`}</b><div className="comparison-hashes"><code>{comparison.beforeInputHash}</code><span aria-hidden="true">→</span><code>{comparison.afterInputHash}</code></div>{comparison.fields.concat(comparison.collections.flatMap((item) => item.fields.map((field) => ({ ...field, field: `${item.collection}.${item.entityId}.${field.field}` })))).map((field) => <article key={field.field}><b>{field.field}</b><code>{JSON.stringify(field.before)}</code><span aria-hidden="true">→</span><code>{JSON.stringify(field.after)}</code></article>)}</div> : null}</section>
  <section className="workbench-section"><header><div><h2>Deterministic Validation history</h2><span>{workspace.validations.length} runs</span></div></header>{[...workspace.validations].reverse().map((run) => <article className="validation-record" key={run.id}><header><div><b className={run.status === "blocked" ? "status-rejected" : "status-accepted"}>{run.status}</b><span>{dateTime(run.asOf)} · {run.validatorSetVersion}</span></div><code>{shortId(run.revisionId)}</code></header>{run.findings.length ? run.findings.map((finding) => <div className={`finding-record severity-${finding.status === "violated" ? "blocker" : "warning"}`} key={finding.id}><span>{finding.status}</span><div><b>{finding.message}</b><code>{finding.code} · {finding.entityType}{finding.entityId ? ` ${shortId(finding.entityId)}` : ""}</code></div></div>) : <p>No findings were recorded.</p>}</article>)}{!workspace.validations.length ? <p className="workbench-empty">Run Deterministic Validation from an exact Scenario revision. No solver or AI is connected.</p> : null}</section></div>;
}

function Actuals({ workspace, open }: { workspace: PlanningWorkspaceModel; open: (dialog: Dialog) => void }) {
  return <div className="planning-panel"><section className="workbench-section"><header><div><h2>Append-only actuals</h2><span>{workspace.actuals.length}</span></div></header><p className="workbench-truth-note">Actuals are immutable observations. Corrections must be appended as new observations; existing records are never edited.</p>{workspace.scenarios.map((scenario) => <article className="planning-record" key={scenario.id}><div><b>{scenario.name}</b><span>{workspace.actuals.filter((item) => item.scenarioId === scenario.id).length} observations</span></div><button className="ghost" disabled={!scenario.revisions.some((revision) => revision.activities.length)} onClick={() => open({ kind: "actual", scenario })}>Append actual</button></article>)}{[...workspace.actuals].reverse().map((actual) => <article className="actual-record" key={actual.id}><div><b>{actual.kind}</b><span>Activity {shortId(actual.activityId)} · observed {dateTime(actual.observedAt)}</span></div><code>{JSON.stringify(actual.value)}</code></article>)}</section></div>;
}

function PlanningDialog({ dialog, workspace, close, save }: { dialog: Dialog; workspace: PlanningWorkspaceModel; close: () => void; save: (task: () => Promise<unknown>) => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (dialog.kind === "delivery") await save(() => workbenchApi.savePlanningDelivery(workspace.product.id, dialog.target?.id ?? null, { expectedProductVersion: workspace.product.version, expectedVersion: dialog.target?.version, name: String(form.get("name") ?? "") }));
      if (dialog.kind === "resource") await save(() => workbenchApi.savePlanningResource(workspace.product.id, dialog.target?.id ?? null, { expectedProductVersion: workspace.product.version, expectedVersion: dialog.target?.version, name: String(form.get("name") ?? ""), capacity: parseCapacity(String(form.get("capacity") ?? "[]")) }));
      if (dialog.kind === "train") await save(() => workbenchApi.savePlanningTrain(workspace.product.id, dialog.target?.id ?? null, { expectedProductVersion: workspace.product.version, expectedVersion: dialog.target?.version, name: String(form.get("name") ?? ""), cutoffAt: iso(form.get("cutoffAt")) }));
      if (dialog.kind === "policy") await save(() => workbenchApi.savePlanningPolicy(workspace.product.id, { expectedProductVersion: workspace.product.version, rules: parseRules(String(form.get("rules") ?? "[]")) }));
      if (dialog.kind === "scenario") await save(() => workbenchApi.createPlanningScenario(workspace.product.id, { expectedProductVersion: workspace.product.version, deliveryId: String(form.get("deliveryId") ?? ""), name: String(form.get("name") ?? "") }));
      if (dialog.kind === "revision") await save(() => workbenchApi.createPlanningRevision(workspace.product.id, dialog.scenario.id, { expectedScenarioVersion: dialog.scenario.version, activities: parseActivities(String(form.get("activities") ?? "[]"), workspace.product.id), deliverables: parseDeliverables(String(form.get("deliverables") ?? "[]"), workspace.product.id), constraints: parseConstraints(String(form.get("constraints") ?? "[]")) }));
      if (dialog.kind === "clone") await save(() => workbenchApi.clonePlanningScenario(workspace.product.id, dialog.scenario.id, { expectedProductVersion: workspace.product.version, revisionId: dialog.revision.id, name: String(form.get("name") ?? "") }));
      if (dialog.kind === "actual") {
        const raw: unknown = JSON.parse(String(form.get("value") ?? "null"));
        await save(() => workbenchApi.appendPlanningActual(workspace.product.id, dialog.scenario.id, { activityId: String(form.get("activityId") ?? ""), kind: String(form.get("kind") ?? ""), value: jsonValue(raw, "Actual value"), observedAt: iso(form.get("observedAt")) ?? "" }));
      }
      close();
    } catch (reason) { setError(message(reason)); }
    finally { setSaving(false); }
  };
  const title = dialog.kind === "delivery" ? `${dialog.target ? "Edit" : "Add"} Delivery` : dialog.kind === "resource" ? `${dialog.target ? "Edit" : "Add"} Resource` : dialog.kind === "train" ? `${dialog.target ? "Edit" : "Add"} Train` : dialog.kind === "policy" ? "New Planning Policy revision" : dialog.kind === "scenario" ? "Create Manual Scenario" : dialog.kind === "revision" ? "Add Manual revision" : dialog.kind === "clone" ? "Clone Manual Scenario" : "Append actual";
  return <WorkbenchDialog title={title} close={close}><form onSubmit={submit}>
    {dialog.kind === "delivery" ? <label>Delivery name<input autoFocus required name="name" defaultValue={dialog.target?.name} /></label> : null}
    {dialog.kind === "resource" ? <><label>Resource name<input autoFocus required name="name" defaultValue={dialog.target?.name} /></label><JsonField name="capacity" label="Dated capacity JSON" value={JSON.stringify(dialog.target?.capacity ?? [], null, 2)} help="Use non-overlapping periods with effectiveFrom, effectiveTo, and integer units." /></> : null}
    {dialog.kind === "train" ? <><label>Train name<input autoFocus required name="name" defaultValue={dialog.target?.name} /></label><label>Cutoff<input name="cutoffAt" type="datetime-local" defaultValue={dialog.target?.cutoffAt?.slice(0, 16)} /></label></> : null}
    {dialog.kind === "policy" ? <JsonField name="rules" label="Policy rules JSON" value="[]" help="Each rule requires id, level, kind, ruleVersion, and parameters. This creates an append-only policy revision." /> : null}
    {dialog.kind === "scenario" ? <><label>Delivery<select autoFocus required name="deliveryId"><option value="">Select a Delivery</option>{workspace.deliveries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Scenario name<input required name="name" /></label><p className="form-note">This Scenario is Manual. No solver or AI will generate revisions.</p></> : null}
    {dialog.kind === "revision" ? <><JsonField name="activities" label="Activities JSON" value="[]" help="Each activity requires a UUID id, name, ISO startAt and endAt, predecessorIds, and demands." /><JsonField name="deliverables" label="Deliverables JSON" value="[]" help="Each Deliverable requires a UUID id, name, non-negative order, predecessorIds, trainId, and readyAt." /><JsonField name="constraints" label="Constraints JSON" value={JSON.stringify(workspace.policies.at(-1)?.rules.map((rule) => ({ id: rule.id, level: rule.level, kind: rule.kind, ruleVersion: rule.ruleVersion, requiresEvidence: false, evidence: null, override: false, overrideRationale: null })) ?? [], null, 2)} help="Mandatory policy rules must be present and unchanged. Advisory overrides require a rationale." /></> : null}
    {dialog.kind === "clone" ? <><label>Cloned Scenario name<input autoFocus required name="name" defaultValue={`${dialog.scenario.name} copy`} /></label><p className="form-note">The exact input of revision {dialog.revision.revisionNumber} will be copied into a new Manual Scenario.</p></> : null}
    {dialog.kind === "actual" ? <><label>Activity<select autoFocus required name="activityId"><option value="">Select an activity</option>{dialog.scenario.revisions.flatMap((revision) => revision.activities).filter((activity, index, items) => items.findIndex((item) => item.id === activity.id) === index).map((activity) => <option value={activity.id} key={activity.id}>{activity.name} · {shortId(activity.id)}</option>)}</select></label><label>Actual kind<input required name="kind" placeholder="completed" /></label><JsonField name="value" label="Observed value JSON" value="{}" help="Record only observed facts. This event is append-only." /><label>Observed at<input required name="observedAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} /></label></> : null}
    <FormError message={error} /><button className="primary save-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
  </form></WorkbenchDialog>;
}

function JsonField({ name, label, value, help }: { name: string; label: string; value: string; help: string }) {
  return <label>{label}<textarea required name={name} rows={6} defaultValue={value} spellCheck={false} /><span>{help}</span></label>;
}
