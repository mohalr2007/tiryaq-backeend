import { NextResponse } from "next/server";
import { authenticateAdminUser, ensureAdminPortalDbReady, logAdminPortalActivity } from "@/utils/admin-portal/db";
import { adminJsonError } from "@/utils/admin-portal/api";
import { attachAdminPortalSession } from "@/utils/admin-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureAdminPortalDbReady();

    const body = (await request.json().catch(() => null)) as
      | { username?: string; password?: string }
      | null;

    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";

    if (!username || !password) {
      return adminJsonError("Username et mot de passe admin obligatoires.", 400);
    }

    const adminUser = await authenticateAdminUser(username, password);
    if (!adminUser) {
      return adminJsonError("Identifiants admin invalides.", 401);
    }

    const response = NextResponse.json({
      ok: true,
      user: adminUser,
    });

    attachAdminPortalSession(response, {
      adminUserId: adminUser.id,
      username: adminUser.username,
      fullName: adminUser.fullName,
      role: adminUser.role,
    }, request);

    await logAdminPortalActivity({
      adminUserId: adminUser.id,
      action: "admin_login",
      targetType: "admin_user",
      targetId: adminUser.id,
    });

    return response;
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible d'ouvrir la session admin.",
      500
    );
  }
}
