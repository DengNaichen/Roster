set search_path = roster, public;
create table comments(id bigint generated always as identity primary key,workspace_id uuid not null,issue_id uuid not null,body text not null check(length(trim(body))>0 and octet_length(body)<=65536),actor_subject text references users(subject),author text not null,created_at timestamptz not null default now(),foreign key(workspace_id,issue_id) references issues(workspace_id,id) on delete cascade);
create index comments_issue on comments(issue_id,id);
create table work_logs(id bigint generated always as identity primary key,workspace_id uuid not null,issue_id uuid not null,kind text not null check(kind in ('progress','decision')),summary text not null check(length(summary) between 1 and 240 and summary !~ '[[:cntrl:]]'),body text not null check(length(trim(body))>0 and octet_length(body)<=65536),actor_subject text references users(subject),created_at timestamptz not null default now(),foreign key(workspace_id,issue_id) references issues(workspace_id,id) on delete cascade);
create index work_logs_issue on work_logs(issue_id,id desc);
create table issue_delegations(id bigint generated always as identity primary key,workspace_id uuid not null,issue_id uuid not null,agent text not null check(agent in ('codex','claude')),session_id text not null check(length(session_id) between 1 and 256),agent_id text not null default '' check(length(agent_id)<=256),agent_type text not null default '' check(length(agent_type)<=128),hostname text not null check(length(hostname) between 1 and 253),actor_subject text references users(subject),created_at timestamptz not null default now(),foreign key(workspace_id,issue_id) references issues(workspace_id,id) on delete cascade,unique(issue_id,agent,session_id,agent_id,hostname));
create table links(id bigint generated always as identity primary key,workspace_id uuid not null,issue_id uuid not null,title text not null check(length(trim(title))>0),url text not null check(url ~ '^https?://'),foreign key(workspace_id,issue_id) references issues(workspace_id,id) on delete cascade);
create table relations(workspace_id uuid not null,issue_id uuid not null,kind text not null check(kind in ('blocks','related')),other_id uuid not null,primary key(issue_id,kind,other_id),check(issue_id<>other_id),foreign key(workspace_id,issue_id) references issues(workspace_id,id) on delete cascade,foreign key(workspace_id,other_id) references issues(workspace_id,id) on delete cascade);
create index relations_other on relations(other_id,kind);
create function roster.relation_acyclic() returns trigger language plpgsql set search_path=roster,public as $$
begin
 perform 1 from workspaces where id=new.workspace_id for update;
 if new.kind='blocks' and exists(with recursive reachable(id) as (select new.other_id union select r.other_id from relations r join reachable p on r.issue_id=p.id where r.kind='blocks' and r.workspace_id=new.workspace_id) select 1 from reachable where id=new.issue_id) then raise exception 'dependency cycle is not allowed' using errcode='23514'; end if;
 return new;
end $$;
create trigger relation_dag before insert or update on relations for each row execute function roster.relation_acyclic();
revoke all on comments,work_logs,issue_delegations,links,relations from public,anon,authenticated;
grant select,insert,update,delete on comments,work_logs,issue_delegations,links,relations to roster_app;
grant usage,select on all sequences in schema roster to roster_app;
