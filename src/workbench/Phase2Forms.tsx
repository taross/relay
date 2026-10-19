import type { ReactNode, SubmitEvent as ReactSubmitEvent } from "react";
import { workbenchApi } from "./api";
import type { ArtifactPhase, DeliverableRevision, Phase2Workspace, WorkPackage } from "./types";
import { WorkbenchDialog } from "./WorkbenchDialog";

type Submit = (operation: () => Promise<unknown>) => Promise<void>;
type Common = { workspace: Phase2Workspace; close: () => void; submit: Submit };
type Choice = { id: string; label: string };

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function pairs(value: FormDataEntryValue | null) {
  return lines(value).map((line) => {
    const [key, ...rest] = line.split("|");
    return { key: key.trim(), text: rest.join("|").trim() };
  });
}

function selected(form: FormData, name: string) {
  return form.getAll(name).map(String);
}

function ChoiceList({ legend, name, choices, selectedIds = [] }: { legend: string; name: string; choices: Choice[]; selectedIds?: string[] }) {
  return <fieldset className="workbench-choice-list"><legend>{legend}</legend>
    {choices.length ? choices.map((choice) => <label key={choice.id}><input type="checkbox" name={name} value={choice.id} defaultChecked={selectedIds.includes(choice.id)} /><span>{choice.label}</span></label>) : <p>No eligible records are available.</p>}
  </fieldset>;
}

export function SpecificationForm({ workspace, close, submit }: Common) {
  const current = workspace.specification;
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requirementRevisionIds = selected(form, "requirements");
    return submit(() => workbenchApi.saveSpecification(workspace.feature.id, {
      expectedFeatureVersion: workspace.feature.version,
      expectedPhaseVersion: workspace.phaseStates.Specification.version,
      expectedRevisionVersion: current?.version ?? null,
      title: String(form.get("title") ?? ""),
      behavior: String(form.get("behavior") ?? ""),
      authorName: String(form.get("authorName") ?? ""),
      criteria: pairs(form.get("criteria")).map((criterion) => ({ ...criterion, requirementRevisionIds })),
      requirementRevisionIds,
    }));
  };
  return <WorkbenchDialog title={current?.state === "Approved" ? "Create successor Specification" : "Edit Specification"} close={close}><form onSubmit={save}>
    {current?.state === "Approved" ? <p className="form-note">The approved revision remains immutable. Saving creates a successor Draft.</p> : null}
    <label>Author name<input autoFocus required name="authorName" defaultValue={current?.authorName} /></label>
    <label>Title<input required name="title" defaultValue={current?.title} /></label>
    <label>Behavior description<textarea required name="behavior" rows={7} defaultValue={current?.behavior} /></label>
    <label>Acceptance criteria <span>one per line: key | criterion</span><textarea required name="criteria" rows={5} defaultValue={current?.criteria.map((item) => `${item.key} | ${item.text}`).join("\n")} /></label>
    <ChoiceList legend="Traced approved Requirements" name="requirements" choices={workspace.requirements.map((item) => ({ id: item.id, label: `${item.externalKey} · ${item.title}` }))} selectedIds={current?.requirementRevisionIds} />
    <button className="primary save-button">{current?.state === "Approved" ? "Create successor Draft" : "Save Specification"}</button>
  </form></WorkbenchDialog>;
}

export function DesignForm({ workspace, close, submit }: Common) {
  const current = workspace.design;
  const specification = workspace.specification;
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit(() => workbenchApi.saveDesign(workspace.feature.id, {
      expectedFeatureVersion: workspace.feature.version,
      expectedPhaseVersion: workspace.phaseStates["Solution Design"].version,
      expectedRevisionVersion: current?.version ?? null,
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      authorName: String(form.get("authorName") ?? ""),
      specificationRevisionIds: selected(form, "specifications"),
      requirementRevisionIds: selected(form, "requirements"),
      acceptanceCriterionIds: selected(form, "criteria"),
    }));
  };
  return <WorkbenchDialog title={current?.state === "Approved" ? "Create successor Solution Design" : "Edit Solution Design"} close={close}><form onSubmit={save}>
    {current?.state === "Approved" ? <p className="form-note">The approved revision remains immutable. Saving creates a successor Draft.</p> : null}
    <label>Author name<input autoFocus required name="authorName" defaultValue={current?.authorName} /></label>
    <label>Title<input required name="title" defaultValue={current?.title} /></label>
    <label>Design summary<textarea required name="summary" rows={8} defaultValue={current?.summary} /></label>
    <ChoiceList legend="Traced Specification revision" name="specifications" choices={specification ? [{ id: specification.id, label: `Specification revision ${specification.revisionNumber} · ${specification.state}` }] : []} selectedIds={current?.specificationRevisionIds} />
    <ChoiceList legend="Traced approved Requirements" name="requirements" choices={workspace.requirements.map((item) => ({ id: item.id, label: `${item.externalKey} · ${item.title}` }))} selectedIds={current?.requirementRevisionIds} />
    <ChoiceList legend="Traced Acceptance Criteria" name="criteria" choices={specification?.criteria.map((item) => ({ id: item.id, label: `${item.key} · ${item.text}` })) ?? []} selectedIds={current?.acceptanceCriterionIds} />
    <button className="primary save-button">{current?.state === "Approved" ? "Create successor Draft" : "Save Solution Design"}</button>
  </form></WorkbenchDialog>;
}

export function VerificationForm({ workspace, close, submit }: Common) {
  const current = workspace.verificationPlan;
  const specification = workspace.specification;
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const specificationRevisionIds = selected(form, "specifications");
    const requirementRevisionIds = selected(form, "requirements");
    const acceptanceCriterionIds = selected(form, "criteria");
    const cases = lines(form.get("cases")).map((line) => {
      const [key = "", method = "", successCriteria = "", executionCondition = "", responsibleTeam = ""] = line.split("|").map((item) => item.trim());
      return { key, method, successCriteria, executionCondition, responsibleTeam, specificationRevisionIds, requirementRevisionIds, acceptanceCriterionIds };
    });
    return submit(() => workbenchApi.saveVerificationPlan(workspace.feature.id, {
      expectedFeatureVersion: workspace.feature.version,
      expectedPhaseVersion: workspace.phaseStates["Verification Planning"].version,
      expectedRevisionVersion: current?.version ?? null,
      title: String(form.get("title") ?? ""), authorName: String(form.get("authorName") ?? ""), cases,
    }));
  };
  return <WorkbenchDialog title={current?.state === "Approved" ? "Create successor Verification Plan" : "Edit Verification Plan"} close={close}><form onSubmit={save}>
    {current?.state === "Approved" ? <p className="form-note">The approved revision remains immutable. Saving creates a successor Draft.</p> : null}
    <label>Author name<input autoFocus required name="authorName" defaultValue={current?.authorName} /></label>
    <label>Title<input required name="title" defaultValue={current?.title} /></label>
    <label>Verification cases <span>one per line: key | method | success criteria | execution condition | responsible team</span><textarea required name="cases" rows={8} defaultValue={current?.cases.map((item) => `${item.key} | ${item.method} | ${item.successCriteria} | ${item.executionCondition} | ${item.responsibleTeam}`).join("\n")} /></label>
    <ChoiceList legend="Case trace to Specification" name="specifications" choices={specification ? [{ id: specification.id, label: `Specification revision ${specification.revisionNumber} · ${specification.state}` }] : []} selectedIds={current?.cases.flatMap((item) => item.specificationRevisionIds)} />
    <ChoiceList legend="Case trace to approved Requirements" name="requirements" choices={workspace.requirements.map((item) => ({ id: item.id, label: `${item.externalKey} · ${item.title}` }))} selectedIds={current?.cases.flatMap((item) => item.requirementRevisionIds)} />
    <ChoiceList legend="Case trace to Acceptance Criteria" name="criteria" choices={specification?.criteria.map((item) => ({ id: item.id, label: `${item.key} · ${item.text}` })) ?? []} selectedIds={current?.cases.flatMap((item) => item.acceptanceCriterionIds)} />
    <button className="primary save-button">{current?.state === "Approved" ? "Create successor Draft" : "Save Verification Plan"}</button>
  </form></WorkbenchDialog>;
}

export function WorkPackageForm({ workspace, item, close, submit }: Common & { item?: WorkPackage }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit(() => workbenchApi.saveWorkPackage(workspace.feature.id, {
      id: item?.id,
      expectedFeatureVersion: workspace.feature.version,
      expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version,
      expectedVersion: item?.version ?? null,
      key: String(form.get("key") ?? ""), type: String(form.get("type")) === "QA" ? "QA" : String(form.get("type")) === "other" ? "other" : "development",
      description: String(form.get("description") ?? ""), owningTeam: String(form.get("owningTeam") ?? ""),
      predecessorIds: selected(form, "predecessors"), designRevisionIds: selected(form, "designs"), verificationRevisionIds: selected(form, "verification"),
    }));
  };
  return <WorkbenchDialog title={item ? "Edit Work Package" : "Create Work Package"} close={close}><form onSubmit={save}>
    <label>Package key<input autoFocus required name="key" defaultValue={item?.key} placeholder="WP-001" /></label>
    <label>Type<select name="type" defaultValue={item?.type ?? "development"}><option value="development">Development</option><option value="QA">QA</option><option value="other">Other</option></select></label>
    <label>Description<textarea required name="description" rows={5} defaultValue={item?.description} /></label>
    <label>Owning team<input name="owningTeam" defaultValue={item?.owningTeam} /></label>
    <ChoiceList legend="Predecessor Work Packages" name="predecessors" choices={workspace.workPackages.filter((candidate) => candidate.id !== item?.id).map((candidate) => ({ id: candidate.id, label: `${candidate.key} · ${candidate.description}` }))} selectedIds={item?.predecessorIds} />
    <ChoiceList legend="Solution Design trace" name="designs" choices={workspace.design ? [{ id: workspace.design.id, label: `Design revision ${workspace.design.revisionNumber} · ${workspace.design.state}` }] : []} selectedIds={item?.designRevisionIds} />
    <ChoiceList legend="Verification Plan trace" name="verification" choices={workspace.verificationPlan ? [{ id: workspace.verificationPlan.id, label: `Verification revision ${workspace.verificationPlan.revisionNumber} · ${workspace.verificationPlan.state}` }] : []} selectedIds={item?.verificationRevisionIds} />
    <button className="primary save-button">Save Work Package</button>
  </form></WorkbenchDialog>;
}

export function DeliverableForm({ workspace, item, close, submit }: Common & { item?: DeliverableRevision }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit(() => workbenchApi.saveDeliverable(workspace.feature.id, {
      deliverableId: item?.deliverableId,
      expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, expectedVersion: item?.version ?? null,
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), targetSystem: String(form.get("targetSystem") ?? ""), targetEnvironment: String(form.get("targetEnvironment") ?? ""), artifactRevisionLabel: String(form.get("artifactRevisionLabel") ?? ""), targetReleaseTrainId: null, authorName: String(form.get("authorName") ?? ""),
      workPackageIds: selected(form, "packages"), predecessorIds: selected(form, "predecessors"), readinessConditions: pairs(form.get("conditions")),
    }));
  };
  return <WorkbenchDialog title={item?.state === "Approved" ? "Create successor Deliverable" : item ? "Edit Deliverable" : "Create Deliverable"} close={close}><form onSubmit={save}>
    {item?.state === "Approved" ? <p className="form-note">The approved Deliverable revision remains immutable. Saving creates a successor Draft.</p> : null}
    <label>Author name<input autoFocus required name="authorName" defaultValue={item?.authorName} /></label>
    <label>Name<input required name="name" defaultValue={item?.name} /></label>
    <label>Description<textarea required name="description" rows={4} defaultValue={item?.description} /></label>
    <label>Target system<input required name="targetSystem" defaultValue={item?.targetSystem} /></label>
    <label>Target environment<input required name="targetEnvironment" defaultValue={item?.targetEnvironment} /></label>
    <label>Artifact revision label<input required name="artifactRevisionLabel" defaultValue={item?.artifactRevisionLabel} placeholder="build-2025.04.1" /></label>
    <label>Readiness conditions <span>one per line: key | condition</span><textarea required name="conditions" rows={5} defaultValue={item?.readinessConditions.map((condition) => `${condition.key} | ${condition.text}`).join("\n")} /></label>
    <ChoiceList legend="Included Work Packages" name="packages" choices={workspace.workPackages.map((candidate) => ({ id: candidate.id, label: `${candidate.key} · ${candidate.description}` }))} selectedIds={item?.workPackageIds} />
    <ChoiceList legend="Predecessor Deliverables" name="predecessors" choices={workspace.deliverables.filter((candidate) => candidate.deliverableId !== item?.deliverableId).map((candidate) => ({ id: candidate.deliverableId, label: `${candidate.name} · revision ${candidate.revisionNumber}` }))} selectedIds={item?.predecessorIds} />
    <p className="form-note">Release Train assignment is intentionally unavailable in Phase 2. This action creates no Deployment, Release, or Activation state.</p>
    <button className="primary save-button">{item?.state === "Approved" ? "Create successor Draft" : "Save Deliverable"}</button>
  </form></WorkbenchDialog>;
}

export function PhaseDecisionForm({ phase, action, close, submit }: { phase: string; action: "request-review" | "request-changes" | "approve"; close: () => void; submit: (input: { actorName: string; rationale: string; warningRationale?: string }) => Promise<void> }) {
  const labels = { "request-review": "Request review", "request-changes": "Request changes", approve: "Approve and freeze" };
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit({ actorName: String(form.get("actorName") ?? ""), rationale: String(form.get("rationale") ?? ""), warningRationale: String(form.get("warningRationale") ?? "") });
  };
  return <WorkbenchDialog title={`${labels[action]} · ${phase}`} close={close}><form onSubmit={save}>
    {action === "approve" ? <p className="form-note">Approval freezes the exact current revision and validation context. Later edits create successor drafts and mark the saved baseline Impacted.</p> : null}
    <label>Actor name<input autoFocus required name="actorName" /></label>
    <label>Rationale<textarea required name="rationale" rows={4} /></label>
    {action === "approve" ? <label>Warning rationale <span>required only when the latest validation contains warnings</span><textarea name="warningRationale" rows={3} /></label> : null}
    <button className="primary save-button">{labels[action]}</button>
  </form></WorkbenchDialog>;
}

export function PanelSection({ title, meta, action, children }: { title: string; meta?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="workbench-subsection"><header><div><h3>{title}</h3>{meta ? <span>{meta}</span> : null}</div>{action}</header>{children}</section>;
}
