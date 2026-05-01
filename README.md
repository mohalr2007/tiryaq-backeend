# TIRYAQ Backend

This repository contains the TIRYAQ backend application and API layer.
It is built with Next.js route handlers and is intended to be deployed independently from the frontend.

## Purpose

The backend is responsible for:

- protected API endpoints
- AI chat and AI vision orchestration
- admin and moderation workflows
- doctor verification and governance logic
- reminder and scheduled-task flows
- Supabase server/admin access
- response normalization for frontend consumers

## Stack

- Next.js
- TypeScript
- Supabase
- Groq SDK
- SQL migrations for platform features

## Local development

Install dependencies and start the backend:

```powershell
npm install
npm run dev
```

Default local URL:

- `http://127.0.0.1:4000`

## Available scripts

```powershell
npm run dev
npm run dev:webpack
npm run build
npm run start
npm run lint
```

## Main code areas

- `src/app/api/`: HTTP route handlers
- `src/utils/`: Supabase, auth, governance, reminders, server helpers
- `src/features/ai-assistant/`: AI language and assistant-specific helpers
- `database/`: database setup scripts, migrations, and operational notes
- `scripts/`: backend utility scripts

## Environment variables

Use `.env.example` as the baseline.

Core groups:

- main Supabase access
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- AI-related Supabase access
  - `NEXT_PUBLIC_AI_SUPABASE_URL`
  - `NEXT_PUBLIC_AI_SUPABASE_ANON_KEY`
  - `AI_SUPABASE_SERVICE_ROLE`
- AI provider keys
  - `PATIENT_AI_API_KEY`
  - `PATIENT_VISION_API_KEY`
  - `DOCTOR_AI_API_KEY`
  - `DOCTOR_VISION_API_KEY`
  - `AI_VISION_API_KEY`
- admin portal configuration
  - `ADMIN_SUPABASE_URL`
  - `ADMIN_SUPABASE_ANON_KEY`
  - `ADMIN_SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_SESSION_SECRET`
  - `ADMIN_DEFAULT_USERNAME`
  - `ADMIN_DEFAULT_PASSWORD`
  - `ADMIN_DEFAULT_FULL_NAME`
- public frontend origin used for CORS and generated links
  - `APP_BASE_URL`
  - `NEXT_PUBLIC_APP_BASE_URL`

Optional reminder/email configuration:

- `EMAIL_REMINDERS_ENABLED`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO`
- `CRON_SECRET`
- `APPOINTMENT_REMINDER_TIMEZONE`
- `APPOINTMENT_REMINDER_WINDOW_MINUTES`
- `APPOINTMENT_REMINDER_STALE_CLAIM_MINUTES`

## Database

Database resources live under `database/`.

Important files/folders:

- `database_setup.sql`
- numbered migration files
- `main_db_all_in_one.sql`
- `admin_db_all_in_one.sql`
- `OPERATIONS_RUNBOOK.md`

When applying schema changes, keep the frontend contract aligned with the backend response shape.

## Deployment

Recommended target: Render

Typical production settings:

- build command: `npm install && npm run build`
- start command: `npm run start`

Before deployment, verify:

- frontend origin variables match the live frontend domain
- all Supabase credentials are present
- AI provider keys are configured
- optional reminder/email settings are intentionally enabled or disabled

`render.yaml` is included as a deployment base.

## Related repositories

- frontend repository: user-facing Next.js application
- root workspace repository: top-level documentation and coordination
