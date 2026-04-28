# Mofid Operations Runbook

## 1) Backup Strategy

1. Database backup (daily)
- Use Supabase managed backup schedule at least once per day.
- Keep 14 daily snapshots minimum.
- Keep 1 monthly snapshot for 6 months.

2. Storage backup (avatars/community images)
- Weekly export of storage buckets:
  - `profile-avatars`
  - `community-posts`
- Keep exports in an external bucket with versioning enabled.

3. Config backup
- Back up environment variables and SQL migration scripts in private repo/secret manager.

## 2) Restore Procedure

1. Identify incident window and target restore point (UTC timestamp).
2. Restore database snapshot to a staging project first.
3. Run smoke checks:
- login/signup
- create appointment
- read community feed
4. If staging is valid, restore production.
5. Restore storage bucket exports if objects are missing/corrupted.

## 3) Incident Response

1. Severity levels
- Sev-1: auth down, appointment booking unavailable, data exposure risk
- Sev-2: partial feature outage
- Sev-3: minor degradation

2. First 15 minutes
- Acknowledge incident.
- Freeze non-essential deploys.
- Capture logs and failing requests.
- Assign incident owner and comms owner.

3. Communication template
- What is impacted
- Since when (UTC)
- Current workaround
- Next update time

4. Post-incident
- Root cause analysis
- Preventive action items
- Owner + due date

## 3.1) Required Clinical Schema Modules

For the current doctor workflow, keep these migrations applied in the main site database:
- `15_visit_prescriptions.sql`
- `19_patient_registration_numbers_ean13.sql`
- `21_standalone_prescriptions.sql`

## 4) Monitoring Targets

- Search/map recommendation p95 <= 3000 ms
- Dashboard initial data load p95 <= 3000 ms
- Error rate < 1% over 15 min

## 5) Audit & Compliance Notes

- AI assistant shows medical disclaimer: recommendation only, no diagnosis.
- Sensitive actions are logged to `public.system_audit_logs`.
- Community moderation actions are traceable by `reviewed_by` and timestamps.
