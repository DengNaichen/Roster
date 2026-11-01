set search_path = roster,public;
create table team_cycle_settings (
 team_id uuid primary key references teams(id),enabled boolean not null,
 timezone text not null,start_date date not null,duration_weeks integer not null check(duration_weeks between 1 and 8),
 upcoming_count integer not null check(upcoming_count between 1 and 15)
);
create table cycles (
 id integer generated always as identity primary key,
 workspace_id uuid not null,team_id uuid not null,number integer not null check(number>0),
 name text not null default '',description text not null default '',timezone text not null,
 starts_at timestamptz not null,ends_at timestamptz not null,completed_at timestamptz,
 total integer not null default 0,done integer not null default 0,canceled integer not null default 0,rolled_over integer not null default 0,
 unique(team_id,number),unique(team_id,id),foreign key(workspace_id,team_id) references teams(workspace_id,id),check(starts_at<ends_at)
);
create index cycles_team_dates on cycles(team_id,starts_at);
alter table issues add column cycle_id integer;
create index issues_cycle on issues(cycle_id);
alter table issues add constraint issues_cycle_team foreign key(team_id,cycle_id) references cycles(team_id,id);
alter table issues add column parent_id uuid;
alter table issues add constraint issues_parent_workspace foreign key(workspace_id,parent_id) references issues(workspace_id,id);
alter table issues add constraint issues_parent_not_self check(parent_id is null or parent_id<>id);
create index issues_parent on issues(parent_id);
create or replace function roster.prevent_parent_cycle() returns trigger language plpgsql as $$
begin
 perform 1 from roster.workspaces where id=new.workspace_id for update;
 if new.parent_id is not null and exists(with recursive ancestors(id,parent_id) as (select id,parent_id from roster.issues where id=new.parent_id union select i.id,i.parent_id from roster.issues i join ancestors a on i.id=a.parent_id) select 1 from ancestors where id=new.id) then raise exception 'Parent cycle is not allowed' using errcode='23514'; end if;
 return new;
end $$;
create trigger issues_parent_cycle before insert or update of parent_id on issues for each row execute function roster.prevent_parent_cycle();
revoke all on team_cycle_settings,cycles from public,anon,authenticated;
grant select,insert,update,delete on team_cycle_settings,cycles to roster_app;
grant usage,select on all sequences in schema roster to roster_app;
