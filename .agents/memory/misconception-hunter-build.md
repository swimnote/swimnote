---
name: Misconception Hunter Build
description: Key decisions and quirks from building the SWIMNOTE AI admin (swimnote-web) and its API routes
---

## Architecture Decision
The SWIMNOTE AI admin is a separate Vite React app at `artifacts/swimnote-web/`, served at preview path `/ai-admin`. It is NOT the same as the compiled `dist/public/` bundle (the pool management SPA). The two coexist.

**Why:** No swimnote-web source existed in the repo — only a compiled bundle. Building as a separate artifact preserved the existing SPA untouched.

**How to apply:** New AI admin pages go in `artifacts/swimnote-web/src/pages/`. New API routes go in `artifacts/api-server/src/routes/` and must be mounted in `routes/index.ts`.

## Vite Base URL
`base: "/ai-admin/"` (absolute) is correct. An earlier attempt with `base: "./"` broke routing on the dev server — the dev server only served from `/` and route paths didn't match.

**Why:** With absolute base, Vite dev server serves at `/ai-admin/` matching wouter routes. The Replit proxy routes `/ai-admin/*` → port 5174.

## Missing API Server Lib Files
`responseTracker.ts` and `deactivationGuard.ts` were absent from `src/lib/` but imported by `app.ts`. Created both from scratch. `getPresignedUrl` was also missing from `objectStorage.ts` — needed `@aws-sdk/s3-request-presigner` installed.

**Why:** These files existed in the compiled `dist/` but not in source — likely deleted/gitignored accidentally.

## DB Target
Misconception data lives in **superAdminDb** (Supabase), not the pool DB. Tables: `misconception_candidates`, `misconception_hunter_settings`.

## Artifact Registration Quirk
`createArtifact()` fails if the directory already exists. Use ShellExec heredoc to write `.replit-artifact/artifact.toml`, then call `verifyAndReplaceArtifactToml` pointing the temp path AND dest path to the same file to register it.

## Wouter v3 Link Pattern
In wouter v3, `<Link>` renders as `<a>`. Never wrap it with another `<a>`. Pass className, onClick directly to `<Link>`.
BAD: `<Link href="..."><a className="...">...</a></Link>`
GOOD: `<Link href="..." className="...">...</Link>`
