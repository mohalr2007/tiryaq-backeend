import { createClient } from "@supabase/supabase-js";

type LooseSiteTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

type SiteAdminDatabase = {
  public: {
    Tables: Record<string, LooseSiteTable>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type SiteAdminSupabaseClient = ReturnType<typeof createClient<SiteAdminDatabase>>;

declare global {
  var __tiryaqAdminSupabaseClient: SiteAdminSupabaseClient | undefined;
}

export function createAdminClient() {
  if (globalThis.__tiryaqAdminSupabaseClient) {
    return globalThis.__tiryaqAdminSupabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured. Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  globalThis.__tiryaqAdminSupabaseClient = createClient<SiteAdminDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return globalThis.__tiryaqAdminSupabaseClient;
}
