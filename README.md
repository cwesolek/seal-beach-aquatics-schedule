# Seal Beach Aquatics Schedule

The Seal Beach Aquatics scheduling system supports manager and lifeguard workflows: staff directory, weekly schedules, recurring shift data, availability, open-shift claims, swap requests, approvals, and scheduled-hours reporting.

## Production setup

1. In the existing Vercel project, install the **Neon** and **Clerk** Marketplace integrations. This creates `DATABASE_URL`, `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. Set `MANAGER_EMAILS` to the two manager email addresses in Vercel for Development, Preview, and Production.
3. Pull the environment locally, then run `pnpm db:push` and `pnpm db:seed`. The seed command adds the original weekday and weekend recurring coverage patterns; staff join through sign-in.
4. Connect the GitHub `main` branch to deploy automatically through the existing Vercel project.

Without database configuration, the app intentionally displays a safe interactive preview instead of persisting staff data.

## Data model

`staff`, `recurring_shift_templates`, `shifts`, `shift_assignments`, `availability`, `open_shift_claims`, and `swap_requests` are defined in `db/schema.sql`.

## Current production source and cover/swap finalization

This source preserves the site deployed from commit `f52497d`: recurring assignments, schedule exceptions, custom assignment times, timesheets, approvals, full-day coverage, and all current pages. The GitHub repository previously lagged behind that deployed source.

Acceptance now transfers one or both assignments and records one-day exclusions for the outgoing recurring staff members in a single transaction. The scheduled time overrides transfer with each assignment; future recurring weeks are unchanged. The request is marked approved in that transaction so it leaves the pending list. Other sessions refresh every 15 seconds or on focus, and stale responses cannot overwrite newer loads.

`pnpm test` runs acceptance and recurring-refresh regression tests against an isolated PostgreSQL engine. `pnpm build` checks the production bundle. `node scripts/verify-schedule.mjs` performs read-only database count/fingerprint checks using the configured database; it prints no staff details.

Deployments now build the app without running schema or seed scripts. This fix needs no database migration. Run schema/seed commands explicitly only when a future change requires them.
