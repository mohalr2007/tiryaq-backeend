// Server-side only — uses service role key to bypass RLS.
// Never import this file in client components.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let aiDbInstance: SupabaseClient | null = null;

export function getAiDb() {
  if (aiDbInstance) {
    return aiDbInstance;
  }

  const url = process.env.NEXT_PUBLIC_AI_SUPABASE_URL;
  const serviceRole = process.env.AI_SUPABASE_SERVICE_ROLE;

  if (!url || !serviceRole) {
    throw new Error(
      "AI history client is not configured. Missing NEXT_PUBLIC_AI_SUPABASE_URL or AI_SUPABASE_SERVICE_ROLE.",
    );
  }

  aiDbInstance = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });

  return aiDbInstance;
}
