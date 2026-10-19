# Relay Release Control

Relay includes the existing release-planning workspace and the Phase 1 Software Delivery Workbench Product/Feature Requirements slice.

## Local setup

Requirements:

- Node.js 22 or newer
- pnpm
- PostgreSQL available through `DATABASE_URL`

Install dependencies and apply additive migrations:

```sh
pnpm install
DATABASE_URL=postgres://... pnpm db:migrate
```

The migration runner applies every `db/migrations/*.sql` file in lexical order and records its SHA-256 checksum in `schema_migrations`. It refuses to continue if an already-applied migration file changes. Existing `001_vertical_slice.sql` data is not replaced.

Start the development server:

```sh
DATABASE_URL=postgres://... pnpm dev
```

Open `/products` for the Product-scoped Requirements workspace. PostgreSQL is authoritative for Product, Feature, Requirement candidate, Requirement revision, validation, approval, and baseline data. The legacy release screens continue to use their existing `/api/state` path; Workbench data never uses that endpoint or browser storage.

## Verification

```sh
pnpm test
pnpm build
git diff --check
```

`pnpm test` runs deterministic domain and application/API-seam tests without requiring PostgreSQL. To exercise persistence, set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run:

```sh
TEST_DATABASE_URL=postgres://... pnpm test
```

The optional integration test applies the same migrations, verifies reload persistence, stale-version rejection, idempotent command replay, immutable approved revisions, successor drafts, and preserved approval history. It does not drop or recreate the configured database.

## Phase 1 scope

Implemented Phase 1 capabilities are Product and Feature creation, stored natural-language requirement sources, manual or explicitly labeled deterministic-sample candidates, candidate edit/accept/reject disposition, immutable Requirement revisions, deterministic structural consistency checks, Requirements review/change/approval transitions, and persisted Requirement Baselines.

No AI generation, semantic contradiction detection, solver, CI/CD, Delivery approval, deployment, release, or activation workflow is connected by this phase.
