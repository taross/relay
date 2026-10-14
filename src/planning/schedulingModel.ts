import type { Activity, ComponentChange, Release, Resource, ResourceCalendarWindow } from "../domain";
import { deriveActivities } from "./releaseReadModel";

export type SchedulingActivity = {
  id: string;
  kind: Activity["kind"];
  subjectId: string;
  durationMinutes: number;
  predecessorIds: string[];
  resourceRequirements: { resourceId: Resource["id"]; capacity: number }[];
  fixedWindow?: { start: string; end: string };
  optional: boolean;
};

export type SchedulingModel = {
  releaseId: Release["id"];
  generatedAt: string;
  activities: SchedulingActivity[];
  resources: Resource[];
  calendar: ResourceCalendarWindow[];
  notes: string[];
};

const getChanges = (release: Release) => release.featureChanges.flatMap((feature) => feature.componentChanges);

export function compileSchedulingModel(release: Release): SchedulingModel {
  const changes = getChanges(release);
  const generatedActivities = deriveActivities(release);
  const explicitActivities = release.activities ?? [];
  const activities = [...explicitActivities, ...generatedActivities.filter((activity) => !explicitActivities.some((item) => item.id === activity.id))];
  const resourceIds = new Set((release.resourceCalendar ?? []).map((window) => window.resourceId));
  const firstResourceId = [...resourceIds][0];

  return {
    releaseId: release.id,
    generatedAt: new Date().toISOString(),
    activities: [
      ...changes.map((change) => compileChangeActivity(change, changes)),
      ...activities.map((activity): SchedulingActivity => ({
        id: activity.id,
        kind: activity.kind,
        subjectId: activity.subjectId,
        durationMinutes: activity.durationMinutes,
        predecessorIds: [],
        resourceRequirements: firstResourceId && activity.kind === "verification" ? [{ resourceId: firstResourceId, capacity: 1 }] : [],
        fixedWindow: fixedWindowFor(activity.id, release.resourceCalendar ?? []),
        optional: activity.mode === "exclude" || activity.mode === "defer" || activity.mode === "disable",
      })),
    ],
    resources: release.resources ?? [],
    calendar: release.resourceCalendar ?? [],
    notes: [
      "このモデルはsolver実行結果ではありません。",
      "Releaseの変更、検証、資源予定をsolverへ渡せる形へ正規化した入力モデルです。",
      "未確認条件は固定事実として扱いません。",
    ],
  };
}

function compileChangeActivity(change: ComponentChange, changes: ComponentChange[]): SchedulingActivity {
  return {
    id: `activity-change-${change.id}`,
    kind: change.migration.required ? "migration" : "deploy",
    subjectId: change.id,
    durationMinutes: change.migration.estimatedMinutes ?? (change.migration.required ? 45 : 30),
    predecessorIds: change.dependencyIds.filter((dependencyId) => changes.some((item) => item.id === dependencyId)).map((dependencyId) => `activity-change-${dependencyId}`),
    resourceRequirements: [],
    optional: false,
  };
}

function fixedWindowFor(activityId: Activity["id"], calendar: ResourceCalendarWindow[]) {
  const window = calendar.find((item) => item.activityId === activityId && item.fixed);
  return window ? { start: window.start, end: window.end } : undefined;
}
