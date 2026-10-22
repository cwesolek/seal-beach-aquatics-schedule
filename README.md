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

## Cover and swap acceptance

Staff use **Swaps** to request a cover of an assigned shift or an exchange with a named staff member's shift. The recipient accepts directly; acceptance immediately updates the assignment(s) and resolves the pending request without a separate manager approval. An open cover can be accepted by any other active staff member who is not already assigned to that shift. Managers can still decline pending requests.

The accepting browser refreshes the schedule and pending count immediately. Other open sessions refresh every 30 seconds and when the window regains focus.

### Deploying this change

Before deploying this version, run `pnpm db:push` against the target database. This adds the nullable `swap_requests.target_shift_id` column; existing requests remain covers and their records are preserved. Apply this schema update before merging to `main` if Vercel deploys automatically. No production database changes are performed by the build.

Run `pnpm test` for the database-backed acceptance regression tests and `pnpm build` for the production build. Tests use an isolated in-memory PostgreSQL engine and never connect to the live schedule.
