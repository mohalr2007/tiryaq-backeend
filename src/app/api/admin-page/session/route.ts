import { NextResponse } from "next/server";
import { ensureAdminPortalDbReady } from "@/utils/admin-portal/db";
import { getAdminPortalSession } from "@/utils/admin-portal/session";
import { adminJsonError } from "@/utils/admin-portal/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureAdminPortalDbReady();
    const session = await getAdminPortalSession();

    return NextResponse.json({
      authenticated: Boolean(session),
      user: session
        ? {
            id: session.adminUserId,
            username: session.username,
            fullName: session.fullName,
            role: session.role,
          }
        : null,
    });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de lire la session admin.",
      500
    );
  }
}
