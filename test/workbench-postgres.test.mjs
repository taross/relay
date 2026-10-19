import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../db/migrate.mjs";
import { PostgresWorkbenchRepository } from "../workbench/postgres-repository.mjs";
import { WorkbenchService } from "../workbench/service.mjs";
import { Phase2PostgresRepository } from "../workbench/phase2-postgres-repository.mjs";
import { Phase2Service } from "../workbench/phase2-service.mjs";

const connectionString = process.env.TEST_DATABASE_URL?.trim();
const postgresTest = connectionString ? test : test.skip;

postgresTest("PostgreSQL persists approvals and enforces frozen records", async () => {
  const source = { DATABASE_URL: connectionString };
  await migrate(source);
  const repository = new PostgresWorkbenchRepository(source);
  const service = new WorkbenchService(repository);
  const suffix = randomUUID().slice(0, 8);

  try {
    const productInput = { name: `Integration Product ${suffix}`, description: "PostgreSQL integration verification" };
    const productResult = await service.createProduct(`pg-product-${suffix}`, productInput);
    const replay = await service.createProduct(`pg-product-${suffix}`, productInput);
    assert.equal(replay.replayed, true);

    const feature = (await service.createFeature(`pg-feature-${suffix}`, productResult.body.id, {
      expectedProductVersion: productResult.body.version,
      name: `Requirement flow ${suffix}`,
      summary: "Verify persisted Phase 1 behavior.",
    })).body;
    const sourceResult = await service.addSource(`pg-source-${suffix}`, feature.id, {
      expectedVersion: feature.version,
      content: "The product must preserve an approved Requirement Baseline.",
      provenance: "Manual",
    });
    const candidateResult = await service.createCandidate(`pg-candidate-${suffix}`, feature.id, {
      expectedVersion: sourceResult.body.feature.version,
      sourceId: sourceResult.body.source.id,
      externalKey: `REQ-PG-${suffix}`,
      title: "Preserve approved requirements",
      text: "The Product shall preserve every approved Requirement Baseline.",
    });
    const accepted = await service.acceptCandidate(`pg-accept-${suffix}`, feature.id, candidateResult.body.candidate.id, {
      expectedVersion: candidateResult.body.candidate.version,
      expectedFeatureVersion: candidateResult.body.feature.version,
      rationale: "The candidate captures the recorded source need.",
      referenceKeys: [],
      conflicts: [],
    });
    const review = await service.requestReview(`pg-review-${suffix}`, feature.id, {
      expectedVersion: accepted.body.feature.version,
      actorName: "Integration Reviewer",
      rationale: "The deterministic structural checks are ready for review.",
    });
    const approval = await service.approve(`pg-approve-${suffix}`, feature.id, {
      expectedVersion: review.body.feature.version,
      actorName: "Integration Approver",
      rationale: "The exact Requirement revision set is approved.",
      warningRationale: "Phase 1 has no upstream trace set for this isolated integration record.",
    });
    assert.equal(approval.body.baseline.feature.reviewState, "Approved");

    await assert.rejects(
      () => service.addSource(`pg-stale-${suffix}`, feature.id, {
        expectedVersion: review.body.feature.version,
        content: "This stale command must not persist.",
        provenance: "Manual",
      }),
      (error) => error.code === "STALE_VERSION" && error.status === 409,
    );

    const persisted = await service.getFeature(feature.id);
    const approvedRevision = persisted.requirements[0];

    const phase2Repository = new Phase2PostgresRepository(source);
    try {
      const phase2 = new Phase2Service(phase2Repository);
      let phase2Workspace = await phase2.getWorkspace(feature.id);
      await phase2.saveSpecification(`pg-spec-${suffix}`, feature.id, {
        expectedFeatureVersion: phase2Workspace.feature.version,
        expectedPhaseVersion: phase2Workspace.phaseStates.Specification.version,
        expectedRevisionVersion: null,
        authorName: "Integration Author",
        title: "Approved baseline behavior",
        behavior: "The approved Requirement Baseline is preserved.",
        criteria: [{ key: "AC-PG-1", text: "The baseline remains readable.", requirementRevisionIds: [approvedRevision.id] }],
        requirementRevisionIds: [approvedRevision.id],
      });
      phase2Workspace = await phase2.getWorkspace(feature.id);
      await phase2.requestReview(`pg-spec-review-${suffix}`, feature.id, "Specification", {
        expectedFeatureVersion: phase2Workspace.feature.version,
        expectedPhaseVersion: phase2Workspace.phaseStates.Specification.version,
        actorName: "Integration Reviewer",
        rationale: "The explicit Requirement and Acceptance Criterion trace is complete.",
      });
      phase2Workspace = await phase2.getWorkspace(feature.id);
      await phase2.approve(`pg-spec-approve-${suffix}`, feature.id, "Specification", {
        expectedFeatureVersion: phase2Workspace.feature.version,
        expectedPhaseVersion: phase2Workspace.phaseStates.Specification.version,
        actorName: "Integration Approver",
        rationale: "The exact Specification revision is approved.",
        warningRationale: "",
      });
      phase2Workspace = await phase2.getWorkspace(feature.id);
      assert.equal(phase2Workspace.specification.state, "Approved");
      assert.equal(phase2Workspace.artifactBaselines[0].validity, "Current");
      await assert.rejects(
        () => phase2Repository.requirePool().query("UPDATE workbench_specification_acceptance_criteria SET criterion_text='mutated' WHERE id=$1", [phase2Workspace.specification.criteria[0].id]),
        (error) => error.code === "55000",
      );
    } finally {
      await phase2Repository.close();
    }
    await assert.rejects(
      () => repository.requirePool().query("UPDATE workbench_requirement_revisions SET title = 'mutated' WHERE id = $1", [approvedRevision.id]),
      (error) => error.code === "55000",
    );
    await assert.rejects(
      () => repository.requirePool().query("UPDATE workbench_requirement_baselines SET validity = 'Invalid' WHERE id = $1", [persisted.baselines[0].id]),
      (error) => error.code === "55000",
    );

    const successor = await service.editRequirement(`pg-successor-${suffix}`, feature.id, approvedRevision.id, {
      expectedVersion: approvedRevision.version,
      expectedFeatureVersion: persisted.feature.version,
      externalKey: approvedRevision.externalKey,
      title: "Preserve approved requirements after change",
      text: "The Product shall preserve every approved Requirement Baseline and its approval history.",
      referenceKeys: [],
      conflicts: [],
    });
    assert.equal(successor.body.revision.predecessorRevisionId, approvedRevision.id);

    const reloadedRepository = new PostgresWorkbenchRepository(source);
    try {
      const reloaded = await new WorkbenchService(reloadedRepository).getFeature(feature.id);
      assert.equal(reloaded.requirements[0].state, "Draft");
      assert.equal(reloaded.baselines[0].validity, "Impacted");
      assert.equal(reloaded.baselines[0].approval.rationale, "The exact Requirement revision set is approved.");
    } finally {
      await reloadedRepository.close();
    }
  } finally {
    await repository.close();
  }
});
