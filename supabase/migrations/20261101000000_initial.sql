create schema if not exists roster;
set search_path = roster, public;
create table users (subject text primary key, name text not null, email text not null);
create table workspaces (id uuid primary key default gen_random_uuid(), slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'), name text not null check(length(trim(name))>0));
create table workspace_members (workspace_id uuid references workspaces(id), subject text references users(subject), role text not null check(role in ('admin','member')), status text not null check(status in ('active','suspended')), primary key(workspace_id,subject));
create table workspace_invites (workspace_id uuid primary key references workspaces(id), digest text not null unique);
create table teams (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), key text not null check(key ~ '^[A-Z][A-Z0-9]{1,5}$'), name text not null check(length(trim(name))>0), emoji text not null default '', private boolean not null default false, next_number integer not null default 1 check(next_number>0), unique(workspace_id,key), unique(workspace_id,id));
create table team_members (workspace_id uuid not null, team_id uuid not null, subject text not null, role text not null check(role in ('owner','member')), primary key(team_id,subject), foreign key(workspace_id,team_id) references teams(workspace_id,id), foreign key(workspace_id,subject) references workspace_members(workspace_id,subject));
create table issues (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, team_id uuid not null, number integer not null check(number>0), identifier text not null, title text not null check(length(trim(title))>0), description text not null default '', status text not null default 'triage' check(status in ('triage','backlog','todo','agent_ready','in_progress','in_review','done','canceled')), type text check(type in ('spec','feature','bug','improvement','chore')), priority integer not null default 0 check(priority between 0 and 4), assignee_subject text references users(subject), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(team_id,number), unique(workspace_id,identifier), unique(workspace_id,id), foreign key(workspace_id,team_id) references teams(workspace_id,id));
create index issues_workspace_created on issues(workspace_id,created_at desc,id desc);
create table audit_events (id bigint generated always as identity primary key, workspace_id uuid not null references workspaces(id), issue_id uuid, actor_subject text not null references users(subject), kind text not null, before jsonb, after jsonb, created_at timestamptz not null default now(), foreign key(workspace_id,issue_id) references issues(workspace_id,id));
create index audit_issue_id on audit_events(issue_id,id);
-- Service uses a dedicated login granted roster access, never Supabase browser roles.
revoke all on schema roster from public, anon, authenticated;
revoke all on all tables in schema roster from public, anon, authenticated;
revoke all on all sequences in schema roster from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'roster_app') then
    create role roster_app nologin nosuperuser nobypassrls;
  end if;
end $$;
grant usage on schema roster to roster_app;
grant select,insert,update,delete on all tables in schema roster to roster_app;
grant usage,select on all sequences in schema roster to roster_app;
