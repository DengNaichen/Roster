-- Links are independent of document revisions and issue workflow state.
create table roster.spec_issues (
 workspace_id uuid not null,
 spec_id integer not null,
 issue_id uuid not null,
 created_by text not null references roster.users(subject),
 created_at timestamptz not null default clock_timestamp(),
 primary key (spec_id,issue_id),
 foreign key (workspace_id,spec_id) references roster.specs(workspace_id,id) on delete cascade,
 foreign key (workspace_id,issue_id) references roster.issues(workspace_id,id) on delete cascade
);
create index spec_issues_issue on roster.spec_issues(workspace_id,issue_id);
revoke all on roster.spec_issues from public,anon,authenticated;
grant select,insert,delete on roster.spec_issues to roster_app;
