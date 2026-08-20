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
