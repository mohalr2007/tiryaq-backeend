import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { createAdminUser, listAdminUsers, logAdminPortalActivity } from "@/utils/admin-portal/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireAdminPortalSession();
  if (response) {
    return response;
  }

  try {
    const admins = await listAdminUsers();
    return NextResponse.json({ admins });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de charger les admins.",
      500
    );
  }
}

export async function POST(request: Request) {
  const { session, response } = await requireAdminPortalSession();
  if (response || !session) {
    return response;
  }

  if (session.role !== "super_admin") {
    return adminJsonError("Seul le super admin peut ajouter d'autres admins.", 403);
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | { username?: string; password?: string; fullName?: string; role?: "super_admin" | "admin" }
      | null;

    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    const role = body?.role === "super_admin" ? "super_admin" : "admin";

    if (!username || !password) {
      return adminJsonError("Username et mot de passe admin obligatoires.", 400);
    }

    const admin = await createAdminUser({
      username,
      password,
      fullName: body?.fullName?.trim() ?? null,
      role,
    });

    await logAdminPortalActivity({
      adminUserId: session.adminUserId,
      action: "admin_user_created",
      targetType: "admin_user",
      targetId: admin.id,
      metadata: {
        username: admin.username,
        role: admin.role,
      },
    });

    return NextResponse.json({ admin }, { status: 201 });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de créer l'admin.",
      500
    );
  }
}
