# Roster web

React + Vite + React Router + TanStack Query, with Supabase Auth and Radix dialogs.

From the repository root:

```sh
corepack pnpm --filter @roster/web dev
corepack pnpm --filter @roster/web build
corepack pnpm --filter @roster/web test
```

Copy `.env.example` to `.env.local`. `VITE_API_BASE_URL` is the backend origin or Supabase Edge Function URL, without `/api`; the browser app appends `/api`. The Supabase key is the public anon/publishable key, never a service-role key. Without all three variables the app renders setup instructions and sends no API requests.

The Supabase client uses PKCE and handles code exchange during initialization. Email links redirect to the current URL, preserving `/join?token=…` and `/oauth/consent?authorization_id=…`. Configure the deployment's allowed redirect URLs in Supabase. OAuth consent uses the real Supabase OAuth server APIs; it requires that capability to be enabled on the project.

Vercel builds this directory with Vite and serves `dist`; `vercel.json` provides SPA route fallback. This repository does not configure CI or deployment automation.

The initial slice covers workspace creation/switching, team creation and private membership, issues, workspace invitations and membership administration. It does not reproduce the previous application's projects, cycles, labels, comments, markdown editor or GitHub integration.
