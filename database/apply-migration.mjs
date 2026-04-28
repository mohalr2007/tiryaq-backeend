// Apply governance columns migration via Supabase SQL API
import { createClient } from '@supabase/supabase-js';

const siteUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const siteKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!siteUrl || !siteKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const client = createClient(siteUrl, siteKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// First, test if columns exist already
const { error: testErr } = await client.from('profiles').select('doctor_verification_status').limit(1);
if (!testErr) {
  console.log('✅ Columns already exist, nothing to do.');
  process.exit(0);
}

console.log('Columns missing, applying migration...');

// Use Supabase's RPC to run SQL
// Note: Supabase has a built-in `exec` function on Postgres 15+
// If that doesn't work, we'll add columns one by one through Supabase REST

// Method: Use the Supabase HTTP API directly to execute SQL
const projectRef = siteUrl.replace('https://', '').replace('.supabase.co', '');

// We can use supabase-js's internal pg REST to add columns individually
// by inserting/updating via the SQL API

// Actually, let's try rpc approach first
const columns = [
  { name: 'doctor_verification_status', type: 'text', default: null },
  { name: 'is_doctor_verified', type: 'boolean NOT NULL DEFAULT false', default: 'false' },
  { name: 'doctor_verification_note', type: 'text', default: null },
  { name: 'doctor_verification_requested_at', type: 'timestamptz', default: null },
  { name: 'doctor_verification_decided_at', type: 'timestamptz', default: null },
  { name: 'doctor_verification_admin_label', type: 'text', default: null },
  { name: 'moderation_status', type: "text NOT NULL DEFAULT 'active'", default: "'active'" },
  { name: 'moderation_reason', type: 'text', default: null },
  { name: 'moderation_updated_at', type: 'timestamptz', default: null },
];

// Try using Supabase Management API
const managementUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Build the SQL
const sql = `
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS doctor_verification_status text,
  ADD COLUMN IF NOT EXISTS is_doctor_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_verification_note text,
  ADD COLUMN IF NOT EXISTS doctor_verification_requested_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS doctor_verification_decided_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS doctor_verification_admin_label text,
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS moderation_updated_at timestamp with time zone;

UPDATE public.profiles
SET
  doctor_verification_status = CASE
    WHEN account_type = 'doctor' THEN COALESCE(doctor_verification_status, 'pending')
    ELSE NULL
  END,
  is_doctor_verified = false,
  moderation_status = COALESCE(moderation_status, 'active')
WHERE doctor_verification_status IS NULL OR moderation_status IS NULL;
`;

console.log('');
console.log('========================================');
console.log('IMPORTANT: Run this SQL in Supabase');
console.log('========================================');
console.log('');
console.log('Go to: https://supabase.com/dashboard/project/' + projectRef + '/sql');
console.log('');
console.log('Paste and run:');
console.log('');
console.log(sql);
console.log('');
console.log('Or run the full migration file: back/17_admin_governance_verification_moderation.sql');
