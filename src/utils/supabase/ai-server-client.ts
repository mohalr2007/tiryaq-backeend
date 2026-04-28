// Server-side only — uses service role key to bypass RLS.
// Never import this file in client components.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let aiDbInstance: SupabaseClient | null = null;

export function hasAiDbConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_AI_SUPABASE_URL &&
      process.env.AI_SUPABASE_SERVICE_ROLE,
  );
}

export function getAiDb() {
  if (aiDbInstance) {
    return aiDbInstance;
  }

  const url = process.env.NEXT_PUBLIC_AI_SUPABASE_URL;
  const serviceRole = process.env.AI_SUPABASE_SERVICE_ROLE;

  if (!url || !serviceRole) {
    return null;
  }

  aiDbInstance = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });

  return aiDbInstance;
}
