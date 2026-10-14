import type { Activity, Component, ComponentChange, Release, ReleaseConstraint, Resource, ResourceCalendarWindow, ResourceConflict, ReleaseReadModel, SuggestedAction, Team, VerificationEvidence } from "../domain";

const getChanges = (release: Release) => release.featureChanges.flatMap((feature) => feature.componentChanges);

export function buildReleaseReadModel(release: Release, catalog: { teams: Team[]; components: Component[] }): ReleaseReadModel {
  const changes = getChanges(release);
  const constraints = materializeConstraints(release, changes);
  const evaluations = constraints.map((constraint) => evaluateConstraint(release, changes, constraint));
  const resourceConflicts = findResourceConflicts(release.resources ?? [], release.resourceCalendar ?? []);
  const blockers = evaluations.filter((item) => item.result === "violated" && item.severity === "blocker");
  const unknowns = evaluations.filter((item) => item.result === "unknown");
  const suggestions = suggestActions(release, changes, resourceConflicts, blockers, unknowns, catalog);
  const approvalInvalidated = ["pending", "approved", "conditionally-approved"].includes(release.approvalStatus ?? "") && Boolean(release.changeEvents?.some((event) => event.status !== "accepted"));

  return {
    releaseId: release.id,
    status: blockers.length || resourceConflicts.length ? "blocked" : unknowns.length ? "unknown" : "ready",
    blockedConditions: blockers,
    unknownConditions: unknowns,
    satisfiedConditions: evaluations.filter((item) => item.result === "satisfied"),
    resourceConflicts,
    suggestedActions: suggestions,
    approvalInvalidated,
    evaluatedAt: new Date().toISOString(),
  };
}

function materializeConstraints(release: Release, changes: ComponentChange[]): ReleaseConstraint[] {
  const explicit = release.constraints ?? [];
  const derived: ReleaseConstraint[] = [];

  changes.forEach((change) => {
    if (change.dependencyIds.length > 0) {
      derived.push({
        id: `derived-dependency-${change.id}` as ReleaseConstraint["id"],
        scope: { type: "component-change", id: change.id },
        kind: "dependency",
        hardness: "hard",
        source: "system-derived",
        ownerTeamId: change.ownerTeamId,
        certainty: "confirmed",
        statement: "担当チームは、依存するコンポーネント変更が完了してから後続変更を開始する必要があります。",
      });
    }
    if (change.maintenance === "undetermined") {
      derived.push({
        id: `derived-maintenance-${change.id}` as ReleaseConstraint["id"],
        scope: { type: "component-change", id: change.id },
        kind: "policy",
        hardness: "hard",
        source: "system-derived",
        ownerTeamId: change.ownerTeamId,
        certainty: "unknown",
        statement: "担当チームは、停止またはメンテナンスの要否を計画承認前に確定する必要があります。",
      });
    }
    if (!change.recovery.trim()) {
      derived.push({
        id: `derived-recovery-${change.id}` as ReleaseConstraint["id"],
        scope: { type: "component-change", id: change.id },
        kind: "policy",
        hardness: "hard",
        source: "system-derived",
        ownerTeamId: change.ownerTeamId,
        certainty: "unknown",
        statement: "担当チームは、障害時の復旧方法を計画承認前に登録する必要があります。",
      });
    }
  });

  release.verifications.forEach((verification) => {
    derived.push({
      id: `derived-evidence-${verification.id}` as ReleaseConstraint["id"],
      scope: { type: "verification", id: verification.id },
      kind: "evidence",
      hardness: "hard",
      source: "system-derived",
      ownerTeamId: verification.ownerTeamId,
      certainty: verification.requiredEvidenceTypes?.length ? "confirmed" : "unknown",
      requiredEvidenceTypes: verification.requiredEvidenceTypes,
      statement: "担当チームは、対象revisionに一致する検証証跡を承認申請前に登録する必要があります。",
    });
  });

  return [...explicit, ...derived];
}

function evaluateConstraint(release: Release, changes: ComponentChange[], constraint: ReleaseConstraint) {
  if (constraint.certainty === "unknown" || constraint.certainty === "assumed" || constraint.certainty === "conflicting") {
    return {
      constraintId: constraint.id,
      result: "unknown" as const,
      severity: constraint.hardness === "hard" ? "blocker" as const : "warning" as const,
      explanation: constraint.statement,
      requiredAction: "担当者は、この成立条件を確認済みの事実として登録してください。",
      evaluatedAt: new Date().toISOString(),
    };
  }

  if (constraint.kind === "dependency" && constraint.scope.type === "component-change") {
    const change = changes.find((item) => item.id === constraint.scope.id);
    const missing = change?.dependencyIds.filter((dependencyId) => !changes.some((item) => item.id === dependencyId)) ?? [];
    return missing.length
      ? violation(constraint, "担当チームは、存在しない依存先を削除するか、対象変更をリリースに追加してください。")
      : satisfied(constraint);
  }

  if (constraint.kind === "evidence" && constraint.scope.type === "verification") {
    const verification = release.verifications.find((item) => item.id === constraint.scope.id);
    if (!verification) return violation(constraint, "リリース責任者は、存在しない検証項目を参照する成立条件を削除してください。");
    const change = changes.find((item) => item.id === verification.componentChangeId);
    const revision = change?.pullRequests[0]?.revision;
    const required = constraint.requiredEvidenceTypes ?? verification.requiredEvidenceTypes ?? [];
    if (!required.length) return unknown(constraint, "担当チームは、この検証で必要な証跡種別を定義してください。");
    const evidence = verification.evidence ?? [];
    const failed = evidence.some((item) => item.revision === revision && item.result === "failed");
    if (failed) return violation(constraint, "担当チームは、失敗した検証を修正し、同じ対象revisionで再実行してください。");
    const missing = required.filter((type) => !hasValidEvidence(evidence, type, revision));
    return missing.length
      ? violation(constraint, `担当チームは、${missing.join("、")} の証跡を対象revisionに対して登録してください。`)
      : satisfied(constraint);
  }

  return satisfied(constraint);
}

function hasValidEvidence(evidence: VerificationEvidence[], type: VerificationEvidence["type"], revision: string | undefined) {
  const now = Date.now();
  return evidence.some((item) => item.type === type && item.revision === revision && item.result === "passed" && (!item.expiresAt || new Date(item.expiresAt).getTime() >= now));
}

function satisfied(constraint: ReleaseConstraint) {
  return { constraintId: constraint.id, result: "satisfied" as const, severity: "info" as const, explanation: constraint.statement, evaluatedAt: new Date().toISOString() };
}

function unknown(constraint: ReleaseConstraint, requiredAction: string) {
  return { constraintId: constraint.id, result: "unknown" as const, severity: constraint.hardness === "hard" ? "blocker" as const : "warning" as const, explanation: constraint.statement, requiredAction, evaluatedAt: new Date().toISOString() };
}

function violation(constraint: ReleaseConstraint, requiredAction: string) {
  return { constraintId: constraint.id, result: "violated" as const, severity: constraint.hardness === "hard" ? "blocker" as const : "warning" as const, explanation: constraint.statement, requiredAction, evaluatedAt: new Date().toISOString() };
}

function findResourceConflicts(resources: Resource[], windows: ResourceCalendarWindow[]): ResourceConflict[] {
  const byResource = new Map<string, ResourceCalendarWindow[]>();
  windows.forEach((window) => {
    const items = byResource.get(window.resourceId) ?? [];
    items.push(window);
    byResource.set(window.resourceId, items);
  });

  const conflicts: ResourceConflict[] = [];
  byResource.forEach((items, resourceId) => {
    const resource = resources.find((item) => item.id === resourceId);
    const capacity = resource?.capacity ?? 1;
    for (let left = 0; left < items.length; left += 1) {
      const overlapping = items.filter((candidate) => overlaps(items[left], candidate));
      const required = overlapping.reduce((sum, item) => sum + item.capacityUsed, 0);
      if (required > capacity) {
        conflicts.push({
          resourceId: resourceId as Resource["id"],
          windowIds: [...new Set(overlapping.map((item) => item.id))],
          requiredCapacity: required,
          availableCapacity: capacity,
          explanation: `${resource?.name ?? "資源"} の同じ時間帯に ${required} 枠が予約され、利用可能枠 ${capacity} を超えています。`,
        });
      }
    }
  });

  return dedupeConflicts(conflicts);
}

function overlaps(left: ResourceCalendarWindow, right: ResourceCalendarWindow) {
  return new Date(left.start).getTime() < new Date(right.end).getTime() && new Date(right.start).getTime() < new Date(left.end).getTime();
}

function dedupeConflicts(conflicts: ResourceConflict[]) {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.resourceId}:${[...conflict.windowIds].sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function suggestActions(release: Release, changes: ComponentChange[], conflicts: ResourceConflict[], blockers: ReleaseReadModel["blockedConditions"], unknowns: ReleaseReadModel["unknownConditions"], catalog: { teams: Team[]; components: Component[] }): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  if (unknowns.length) actions.push({ id: "confirm-unknowns", label: "未確認の成立条件を確認", description: "担当チームは、未確認の前提条件を確認済みの事実または制約違反として登録してください。", impact: "未確認条件を充足扱いにせず、承認申請前の判断材料を確定します。" });
  if (blockers.length) actions.push({ id: "resolve-blockers", label: "違反している成立条件を解消", description: "リリース責任者は、違反している必須条件を担当チームに割り当てて解消してください。", impact: "必須制約を満たすまで、計画はリリース可能になりません。" });
  if (conflicts.length) actions.push({ id: "move-resource-window", label: "検証枠を移動", description: "リリース責任者は、競合している担当者または環境の予約時間を移動してください。", impact: "既存計画との差分を小さく保ちながら、同時利用制約を満たします。" });
  release.changeEvents?.filter((event) => event.status !== "accepted").forEach((event) => {
    const unit = release.featureChanges.find((feature) => feature.id === event.releaseUnitId);
    actions.push({
      id: `event-${event.id}`,
      label: `${unit?.name ?? "対象変更"}の対応を選択`,
      description: "リリース責任者は、不具合または遅延に対して、修正して再検証、無効化、除外、延期のいずれかを選択してください。",
      impact: "対応に応じて必要な再検証と承認差分が変わります。",
    });
  });
  changes.filter((change) => change.maintenance === "undetermined").forEach((change) => {
    const component = catalog.components.find((item) => item.id === change.componentId);
    actions.push({ id: `maintenance-${change.id}`, label: `${component?.name ?? "コンポーネント"}の停止要否を確定`, description: "担当チームは、migration方式、互換性、回復方法に基づいて停止またはメンテナンス要否を確定してください。", impact: "判定不能のまま承認申請されることを防ぎます。" });
  });
  return actions;
}

export function deriveActivities(release: Release): Activity[] {
  const existing = release.activities ?? [];
  const generated = release.verifications.map((verification, index): Activity => ({
    id: `activity-verification-${verification.id}` as Activity["id"],
    releaseId: release.id,
    kind: "verification",
    subjectId: verification.id,
    ownerTeamId: verification.ownerTeamId,
    durationMinutes: 60,
    status: verification.status === "passed" ? "done" : verification.status === "failed" ? "blocked" : "not-started",
    schedule: { earliestStart: release.scheduledAt ?? `${release.scheduledFor}T10:00`, expectedStart: release.scheduledAt ?? `${release.scheduledFor}T10:00`, displayOrder: index + 1 },
  }));
  return [...existing, ...generated.filter((activity) => !existing.some((item) => item.id === activity.id))];
}
