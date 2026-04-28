import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/utils/supabase/server";

type ResolvedRequestClient = {
  client: SupabaseClient;
  user: User | null;
  authError: Error | null;
};

function getAuthorizationHeader(request: Request) {
  const value = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!value?.trim()) {
    return null;
  }

  return value.trim();
}

function buildBearerScopedClient(authorizationHeader: string) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: authorizationHeader,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function resolveRequestSupabaseClient(request: Request): Promise<ResolvedRequestClient> {
  const authorizationHeader = getAuthorizationHeader(request);
  const client = authorizationHeader
    ? buildBearerScopedClient(authorizationHeader)
    : await createServerClient();

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  return {
    client,
    user,
    authError: error ? new Error(error.message) : null,
  };
}
