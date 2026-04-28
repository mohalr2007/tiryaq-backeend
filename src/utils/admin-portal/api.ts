import { NextResponse } from "next/server";
import { getAdminPortalSession } from "./session";

export function adminJsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireAdminPortalSession() {
  const session = await getAdminPortalSession();
  if (!session) {
    return { session: null, response: adminJsonError("Session admin expirée ou inexistante.", 401) };
  }

  return { session, response: null };
}
