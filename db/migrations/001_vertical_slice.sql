create table if not exists teams (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists components (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists releases (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists plan_versions (
  id text primary key,
  release_id text not null references releases(id) on delete cascade,
  sequence integer not null,
  graph_revision text not null,
  status text not null check (status in ('draft', 'candidate', 'approved', 'superseded')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (release_id, sequence)
);

create table if not exists constraint_evaluations (
  id bigserial primary key,
  release_id text not null references releases(id) on delete cascade,
  constraint_id text not null,
  result text not null check (result in ('not-evaluated', 'satisfied', 'violated', 'unknown')),
  severity text not null check (severity in ('info', 'warning', 'blocker')),
  data jsonb not null,
  evaluated_at timestamptz not null default now()
);

create table if not exists change_events (
  id text primary key,
  release_id text not null references releases(id) on delete cascade,
  data jsonb not null,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_plan_versions_release on plan_versions(release_id);
create index if not exists idx_constraint_evaluations_release on constraint_evaluations(release_id, evaluated_at desc);
create index if not exists idx_change_events_release on change_events(release_id, occurred_at desc);
