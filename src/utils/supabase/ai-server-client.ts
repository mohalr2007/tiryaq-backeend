// Server-side only — uses service role key to bypass RLS
// Never import this file in client components
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_AI_SUPABASE_URL!;
const serviceRole = process.env.AI_SUPABASE_SERVICE_ROLE!;

export const aiDb = createClient(url, serviceRole, {
  auth: { persistSession: false },
});
