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

## Request inbox and timesheet updates

Ordinary covers, exchanges, and full-day covers no longer ask for a note. Requests are addressed to the selected employee, whose pending inbox and alert show them for acceptance. Pending and accepted messages remain in the manager inbox across pay periods until a manager deletes the message. Deletion dismisses the message only; it does not undo an accepted change or cancel an employee's pending request. An acceptance after a pending message was dismissed creates a visible accepted message again.

Acceptance transfers the assignments, adds one-day recurring exclusions, resolves the request, and recalculates existing saved regular-hours cells for the affected employees/dates in the same transaction. Unsaved regular cells continue to derive directly from the schedule. Sick/overtime/other rows, other dates, and flex/prior adjustments are unchanged.

The build applies the additive `manager_dismissed_at` column using `scripts/migrate-request-inbox.mjs`. It does not seed or rewrite existing schedule records.

Request email uses the Marketplace-provisioned `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN`. The sender is `schedule@<domain>`; verify that domain in Resend. Only the selected coworker receives request details. Emails link to authenticated acceptance in the app. Email failures preserve the in-app request and offer Retry email to its requester and managers. Successful provider submissions are recorded and retries use a per-request idempotency key. Manager message deletion dismisses history only.
