-- Supabase issues 32-character opaque authorization IDs, not UUIDs.
-- Preserve any existing broker requests while accepting the upstream identifier verbatim.
alter table roster.oauth_authorizations alter column id type text using id::text;
