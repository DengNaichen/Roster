-- Trusted operator bindings are fenced by identity; no credentials or PR bodies are stored.
alter table roster.github_sync
  drop column requested_at,
  add column binding_key text,
  add column initialized_at timestamptz,
  add column connected_at timestamptz not null default now(),
  add column reconcile_after timestamptz not null default now(),
  add column scan jsonb,
  add column blocked_until timestamptz,
  add column failures integer not null default 0 check (failures >= 0),
  add column last_error text;
alter table roster.pull_requests
  add column closes boolean not null default false,
  add column observed_live boolean not null default false,
  add column completion_eligible boolean not null default false;
create table roster.github_deliveries (
  workspace_id uuid not null references roster.workspaces(id),
  delivery_id uuid not null,
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'),
  repo text not null,
  binding_key text not null,
  pull_number integer not null check (pull_number > 0),
  action text not null,
  received_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 8),
  available_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (outcome in ('applied','ignored','dead')),
  last_error text,
  primary key (workspace_id,delivery_id),
  unique (workspace_id,binding_key,body_hash),
  check ((completed_at is null) = (outcome is null))
);
create index github_deliveries_due on roster.github_deliveries(workspace_id,repo,available_at)
  where completed_at is null;
revoke all on roster.github_deliveries from public,anon,authenticated;
grant select,insert,update,delete on roster.github_deliveries to roster_app;
