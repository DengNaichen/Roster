-- Additive catalog migration. UUID workspace/team/issue identities stay unchanged.
create table roster.projects (
  id integer generated always as identity primary key,
  workspace_id uuid not null references roster.workspaces(id),
  name text not null check(length(trim(name))>0),
  description text not null default '', emoji text not null default '',
  archived boolean not null default false, start_date date, target_date date,
  unique(workspace_id,name), unique(workspace_id,id),
  check(start_date is null or target_date is null or start_date<=target_date)
);
create table roster.project_teams (
  workspace_id uuid not null, project_id integer not null, team_id uuid not null,
  primary key(project_id,team_id),
  foreign key(workspace_id,project_id) references roster.projects(workspace_id,id),
  foreign key(workspace_id,team_id) references roster.teams(workspace_id,id)
);
alter table roster.issues add column project_id integer;
alter table roster.issues add foreign key(workspace_id,project_id) references roster.projects(workspace_id,id);
create index issues_project_team on roster.issues(project_id,team_id);
create table roster.initiatives (
  id integer generated always as identity primary key,
  workspace_id uuid not null references roster.workspaces(id),
  name text not null check(length(trim(name))>0), description text not null default '',
  archived boolean not null default false, unique(workspace_id,name), unique(workspace_id,id)
);
create table roster.initiative_projects (
  workspace_id uuid not null, initiative_id integer not null, project_id integer not null,
  primary key(initiative_id,project_id),
  foreign key(workspace_id,initiative_id) references roster.initiatives(workspace_id,id),
  foreign key(workspace_id,project_id) references roster.projects(workspace_id,id)
);
create table roster.label_groups (
  id integer generated always as identity primary key,
  workspace_id uuid not null references roster.workspaces(id),
  name text not null check(length(trim(name))>0), name_key text not null,
  unique(workspace_id,name_key), unique(workspace_id,id)
);
create table roster.labels (
  id integer generated always as identity primary key,
  workspace_id uuid not null references roster.workspaces(id),
  name text not null check(length(trim(name))>0), name_key text not null,
  color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),
  description text not null default '', group_id integer,
  archived boolean not null default false, unique(workspace_id,id),
  foreign key(workspace_id,group_id) references roster.label_groups(workspace_id,id)
);
create unique index labels_name_in_group on roster.labels(workspace_id,coalesce(group_id,0),name_key);
create table roster.issue_labels (
  workspace_id uuid not null, issue_id uuid not null, label_id integer not null, group_id integer,
  primary key(issue_id,label_id), unique(issue_id,group_id),
  foreign key(workspace_id,issue_id) references roster.issues(workspace_id,id),
  foreign key(workspace_id,label_id) references roster.labels(workspace_id,id) on delete cascade
);
create index issue_labels_label on roster.issue_labels(label_id,issue_id);
create function roster.issue_label_group() returns trigger language plpgsql as $$
begin
  select group_id into new.group_id from roster.labels where id=new.label_id and workspace_id=new.workspace_id;
  return new;
end $$;
create trigger issue_label_group before insert or update on roster.issue_labels for each row execute function roster.issue_label_group();
create function roster.label_fixed_group() returns trigger language plpgsql as $$
begin
  if new.group_id is distinct from old.group_id then raise exception 'Label group membership is fixed' using errcode='23514'; end if;
  return new;
end $$;
create trigger label_fixed_group before update on roster.labels for each row execute function roster.label_fixed_group();
create function roster.issue_project_team() returns trigger language plpgsql as $$
begin
  if new.project_id is not null and not exists(select 1 from roster.project_teams where workspace_id=new.workspace_id and project_id=new.project_id and team_id=new.team_id) then
    raise exception 'Issue and project team are incompatible' using errcode='23514';
  end if;
  return new;
end $$;
create trigger issue_project_team before insert or update of project_id,team_id,workspace_id on roster.issues for each row execute function roster.issue_project_team();
create function roster.project_team_in_use() returns trigger language plpgsql as $$
begin
  if exists(select 1 from roster.issues where project_id=old.project_id and team_id=old.team_id) then raise exception 'Project team has issues' using errcode='23514'; end if;
  return old;
end $$;
create trigger project_team_in_use before delete or update on roster.project_teams for each row execute function roster.project_team_in_use();
revoke all on roster.projects,roster.project_teams,roster.initiatives,roster.initiative_projects,roster.label_groups,roster.labels,roster.issue_labels from public,anon,authenticated;
revoke all on sequence roster.projects_id_seq,roster.initiatives_id_seq,roster.label_groups_id_seq,roster.labels_id_seq from public,anon,authenticated;
grant select,insert,update,delete on roster.projects,roster.project_teams,roster.initiatives,roster.initiative_projects,roster.label_groups,roster.labels,roster.issue_labels to roster_app;
grant usage,select on sequence roster.projects_id_seq,roster.initiatives_id_seq,roster.label_groups_id_seq,roster.labels_id_seq to roster_app;
