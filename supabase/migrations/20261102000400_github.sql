create table roster.pull_requests (
 workspace_id uuid not null references roster.workspaces(id), repo text not null,
 number integer not null check(number>0), issue_identifier text not null,
 title text not null, url text not null, head_ref text not null,
 state text not null check(state in ('open','draft','merged','closed')),
 updated_at timestamptz not null, linkback_posted_at timestamptz,
 primary key(workspace_id,repo,number,issue_identifier)
);
create table roster.github_sync (
 workspace_id uuid not null references roster.workspaces(id), repo text not null,
 last_updated_at timestamptz, requested_at timestamptz,
 lease_token uuid, lease_until timestamptz,
 primary key(workspace_id,repo)
);
grant select,insert,update,delete on roster.pull_requests,roster.github_sync to roster_app;
