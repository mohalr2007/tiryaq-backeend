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
- `RESEND_API_KEY`
- `CRON_SECRET`

## Render

- Root directory: `TIRYAQ/backend`
- Build command: `npm install && npm run build`
- Start command: `npm run start`

`render.yaml` is included as a deployment base.
