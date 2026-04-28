# TIRYAQ Backend

Backend API deployable on Render.

## Contents

- `src/app/api/*`: Next route handlers for AI, admin, verification, reminders
- `src/utils/*`: server-side Supabase, admin, governance and reminder logic
- `src/features/ai-assistant/language.ts`: AI language helpers reused by the API
- `database/*`: SQL migrations and operational runbook

## Local run

```powershell
npm install
npm run dev
```

Backend listens on `http://127.0.0.1:4000`.

## Required environment variables

Copy `.env.example` and fill at least:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_AI_SUPABASE_URL`
- `NEXT_PUBLIC_AI_SUPABASE_ANON_KEY`
- `AI_SUPABASE_SERVICE_ROLE`
- `PATIENT_AI_API_KEY`
- `DOCTOR_AI_API_KEY`
- `AI_VISION_API_KEY`
- `ADMIN_SUPABASE_URL`
- `ADMIN_SUPABASE_ANON_KEY`
- `ADMIN_SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SESSION_SECRET`
- `APP_BASE_URL`
- `NEXT_PUBLIC_APP_BASE_URL`

Optional:

- `EMAIL_REMINDERS_ENABLED=true` only if you actually want appointment reminder emails enabled. By default keep it disabled.
- If you enable reminder emails, also configure:
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL`
  - `RESEND_REPLY_TO`
  - `CRON_SECRET`
  - `APPOINTMENT_REMINDER_TIMEZONE`
  - `APPOINTMENT_REMINDER_WINDOW_MINUTES`
  - `APPOINTMENT_REMINDER_STALE_CLAIM_MINUTES`

## Render

- Root directory: leave empty when using the dedicated `tiryaq-backeend` repository
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Production frontend origin expected by backend CORS:
  - `APP_BASE_URL=https://tiryaq-chi.vercel.app`
  - `NEXT_PUBLIC_APP_BASE_URL=https://tiryaq-chi.vercel.app`

`render.yaml` is included as a deployment base.
