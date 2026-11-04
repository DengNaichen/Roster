create table roster.spec_designs (
  spec_id integer primary key references roster.specs(id) on delete cascade,
  revision integer not null check (revision > 0),
  spec_revision integer not null,
  content json not null check (json_typeof(content) = 'object' and octet_length(content::text) <= 262144),
  updated_by text not null references roster.users(subject),
  updated_at timestamptz not null,
  foreign key (spec_id, spec_revision) references roster.spec_revisions(spec_id, number) on delete cascade
);
revoke all on roster.spec_designs from public, anon, authenticated;
grant select, insert, update on roster.spec_designs to roster_app;
