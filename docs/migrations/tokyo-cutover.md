# RST-14: Paris to Tokyo project cutover

Source: `qietzaqhmforixtpicjd` (`eu-west-3`). Target: `jmmwgdyfcmonzqkurcly`
(`ap-northeast-1`). Both belong to the Daniel Free organization. Paris is retained.

## Scope and prerequisites

The user authorized the data migration, GitHub deployment configuration update, redeployment and
real performance validation. The web origin remains `https://roster-ten-sigma.vercel.app`.

This change points repository MCP configuration at Tokyo and selects the Tokyo function region
for the new project. Paris retains its same-region default for rollback. Other projects remain
automatic, and explicit `VITE_API_REGION` overrides still work.

Do not merge or switch production configuration until target login, permissions and MCP pass.
Credentials and backups belong outside the checkout with restrictive permissions; never commit
the database dump, Auth exports or secret values.

## Migration verification

Initial source inventory: 28 roster tables, one Auth user and identity, no Storage buckets/objects,
no Vault secrets, no cron.job, and all nine migrations. Paris runs PostgreSQL17.11; Tokyo17.12.
The actual deployed functions are api and mcp; no jobs/webhook migration is needed.

Create a custom-format PostgreSQL17 archive of roster, auth, storage and supabase_migrations using
an authenticated session-pooler connection. Restore repository migrations on the empty target,
then roster table data/sequences and auth.users/auth.identities in one transaction with replication
triggers disabled as documented by Supabase. Do not copy old sessions, refresh tokens, transient
OAuth authorizations or consents; the issuer and signing keys change, and clients reauthorize.

The source migration-history table has created_by, idempotency_key and rollback columns that a new
CLI3-created table lacks. Preserve these columns and source history explicitly rather than
silently ignoring the difference. The initial restore matched all 31 scoped tables byte-for-byte
at the canonical JSON row-fingerprint level. Sequence values and runtime-role metadata matched.

Use the verification script before target login changes Auth timestamps:

```sh
node scripts/migration/verify-projects.mjs SOURCE_REF TARGET_REF /private/path/initial.json all
```

Use `roster` scope for the final business-data comparison after real target login. Validate Auth
user IDs, identity ownership/provider and the signed-in JWT subject separately at that point:

```sh
node scripts/migration/verify-projects.mjs SOURCE_REF TARGET_REF /private/path/final.json roster
```

The script uses the logged-in Supabase CLI, read-only queries, exact counts and sorted SHA-256
row fingerprints. It requires UTC sessions. Each project's aggregate uses one database statement;
there is no cross-project transaction. A successful comparison is only a cutover gate while
source writes are demonstrably frozen. Roles, grants, sequence values, Auth settings, storage and
function configuration require separate checks; this script does not claim to validate them.

## Authentication and runtime configuration

Use the same auth.users.id and auth.identities.user_id so workspace membership remains valid.
The fresh Tokyo login must return the existing subject, not a new user with an empty workspace.

GitHub's current OAuth settings permit multiple explicit redirect URIs. Add the Tokyo callback
`https://jmmwgdyfcmonzqkurcly.supabase.co/auth/v1/callback` alongside Paris; do not enable wildcard
matching. Create an additional GitHub client secret for Tokyo, preserving the Paris secret.
The Management API's returned secret field is not the reusable original secret; copying that
protected representation caused an external-code exchange failure during preflight.

Create a new dedicated Tokyo roster_runtime login with NOSUPERUSER/NOBYPASSRLS, membership only
in roster_app, and a new Keychain-stored password. Set Tokyo DATABASE_URL to its own pooler;
never copy the Paris connection string. Set MCP_PUBLIC_URL to the Tokyo functions base and
ALLOWED_ORIGINS to the canonical frontend origin. Temporary loopback origins and Auth redirects
used for preflight must be removed from production configuration after validation.

Enable Tokyo OAuth Server and dynamic registration, preserving `/oauth/consent`. Validate both
real GitHub login and a fresh Codex MCP OAuth grant followed by an authenticated tool call.
A 401 metadata response or a browser JWT-only tool call alone is not full OAuth acceptance.

## Cutover sequence

1. Save old Vercel production configuration and deployment ID. Confirm no main deploy is running.
2. Prepare GitHub **production environment** overrides for SUPABASE_PROJECT_REF,
   SUPABASE_DB_PASSWORD and SUPABASE_ACCESS_TOKEN. Keep repository-level Paris values intact.
3. Before final copy, record source grants, disable the source runtime login, revoke roster_app
   table DML and sequence write privileges, and terminate only source roster_runtime connections.
   Verify rejected test-workspace writes and stable source counts/fingerprints. Do not log work
   through the source MCP while frozen. No business-data writes through admin connections.
4. Take a final source snapshot, replace the target's preflight roster data in a transaction,
   restore sequences, and verify source T0=T1=target. Check stable Auth identity ownership.
5. Re-enable the Paris runtime login with SELECT-only application privileges so reads and the
   same-data performance baseline remain possible. Keep Paris writes disabled during cutover.
6. Set Tokyo Auth Site URL and redirect allow-list to the canonical frontend. Set Vercel production
   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL and VITE_API_REGION to Tokyo.
7. Merge the verified PR and verify the main GitHub Actions run deploys the intended SHA and project.
   The deployment workflow checks that frontend project URLs match SUPABASE_PROJECT_REF.
8. Verify canonical-host login, REST/MCP reads and reversible test-workspace writes; compare the
   same PERF fixtures and regions. Record client, samples, errors and tails. No global SLO claims.

## Rollback

Before Tokyo accepts business writes, remove only the Tokyo production-environment GitHub
overrides, restore the saved Paris Vercel configuration/deployment, revert repository MCP URL and
region configuration, and restore the recorded Paris runtime role/grants. The Paris GitHub OAuth
callback and secret remain valid. Do not delete either project as part of rollback.

After Tokyo accepts writes, first freeze Tokyo and reconcile its new records back to Paris;
blindly restoring the old frontend would lose those writes. Record the cutover audit/sequence
watermark and the accepted-write boundary. A code revert alone is not a data rollback.

Operational evidence and the append-only decision trail are kept at
`/Users/nd/Developer/roster-migration-20261116/`; private files are excluded from Git.
Production acceptance and measured results must be attached to RST-14 after the actual deployment.
