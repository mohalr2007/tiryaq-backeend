-- =========================================================
-- 18_appointment_email_reminders.sql
-- Rappels email 24h avant les rendez-vous
-- =========================================================

alter table public.appointments
add column if not exists reminder_24h_sent_at timestamp with time zone,
add column if not exists reminder_24h_delivery_id text,
add column if not exists reminder_24h_recipient_email text,
add column if not exists reminder_24h_error text,
add column if not exists reminder_24h_error_at timestamp with time zone,
add column if not exists reminder_24h_processing_at timestamp with time zone,
add column if not exists reminder_24h_processing_token text;

create index if not exists idx_appointments_reminder_24h_queue
  on public.appointments (status, appointment_date, reminder_24h_sent_at);

create index if not exists idx_appointments_reminder_24h_processing
  on public.appointments (reminder_24h_processing_at);
