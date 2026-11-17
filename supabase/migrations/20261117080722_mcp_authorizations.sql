-- Roster grants are private application capabilities, separate from OIDC profile scopes.
create table roster.oauth_authorizations (
  id uuid primary key,
  client_id uuid not null,
  redirect_uri text not null,
  state text,
  access text not null check(access in ('read','read_write')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  code_hash text unique,
  subject text,
  workspace text references roster.workspaces(slug),
  approved_access text check(approved_access in ('read','read_write')),
  consumed_at timestamptz,
  check ((code_hash is null and subject is null and workspace is null and approved_access is null) or
         (code_hash is not null and subject is not null and workspace is not null and approved_access is not null))
);
create table roster.oauth_grants (
  session_id uuid primary key,
  subject text not null,
  client_id uuid not null,
  workspace text not null references roster.workspaces(slug),
  access text not null check(access in ('read','read_write')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
revoke all on roster.oauth_authorizations, roster.oauth_grants from public, anon, authenticated;
grant select,insert,update,delete on roster.oauth_authorizations, roster.oauth_grants to roster_app;
