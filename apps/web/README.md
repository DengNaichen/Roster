# Roster web

## Design tokens

`src/tokens.css` owns Roster's palette, semantic roles, typography, spacing, density,
layout, interaction states, and business colors. Use `--r-*` roles for new styles.
`src/tokens-legacy.css` adapts older components while their callers are migrated;
do not add a second theme map or new numeric aliases there. Component-only geometry
and data-driven timeline positions stay local.

The account menu offers System / Light / Dark appearance and Compact / Comfortable
density. Preferences are saved locally; unavailable storage does not block changes.
Theme and density attributes live on `document.documentElement`. Rem dimensions keep
the browser's default root font size; reading typography does not shrink with density.
Measure rendered row pixels for virtual lists and resolve actual CSS colors before
passing them to diagram libraries. See the token file for usage and accessibility rules.

## Development

The original InfTask React/Vite frontend, copied from commit `0f7740bfbc29ba2755a778bba8a0f04074ea1224`. The existing History router, request hooks, CSS, Radix controls, list/board views, Markdown detail, dialogs and tests are retained. Supabase Auth is connected through `src/integration`; the simplified replacement UI has been removed.

From the repository root:

```sh
corepack pnpm --filter @roster/web dev
corepack pnpm --filter @roster/web build
corepack pnpm --filter @roster/web test
```

Copy `.env.example` to `.env.local`. `VITE_API_BASE_URL` is the backend origin or Supabase Edge Function URL, without `/api`; existing callers supply the full `/api/...` path. The Supabase key is the public anon/publishable key, never a service-role key. Without all three variables the app renders setup instructions and sends no API requests, unless the explicit local preview is enabled.

The Supabase client uses PKCE and handles code exchange during initialization. Email links redirect to the current URL, preserving `/auth/join?token=…` and `/oauth/consent?authorization_id=…`. Configure the deployment's allowed redirect URLs in Supabase. OAuth consent uses the real Supabase OAuth server APIs; it requires that capability to be enabled on the project. Session expiration retains mounted drafts; switching users clears the previous user's UI state.

Vercel builds from the repository root and serves `apps/web/dist`; the root `vercel.json` provides SPA route fallback. This repository does not configure CI or deployment automation.

All original business domains are connected to the TypeScript backend: workspaces, teams, members, projects, initiatives, labels, cycles, issues, assignments, comments, agent work logs/delegations, relations, links and GitHub pull requests. Capabilities are all enabled. The capability boundary remains fail-closed if the server cannot supply its supported features. External GitHub synchronization and hosted OAuth require deployment configuration.

For an isolated local preview, set `VITE_LOCAL_PREVIEW=true` and run the Vite development server on a loopback hostname. This mode calls only `http://127.0.0.1:18471`, sends no Bearer token, and displays a local-preview identity instead of sign-out. It requires the separate preview backend and database. Production builds and remote hosts always use the normal Supabase authentication path, even if this flag is set. OAuth consent remains unavailable in preview.
