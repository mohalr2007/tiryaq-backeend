import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { logAdminPortalActivity } from "@/utils/admin-portal/db";
import { releaseBlockedEmail } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ blockedEmailId: string }> }
) {
  const { session, response } = await requireAdminPortalSession();
  if (response || !session) {
    return response;
  }

  try {
    const { blockedEmailId } = await context.params;
    const body = (await request.json().catch(() => null)) as { releaseNote?: string } | null;

    if (!blockedEmailId) {
      return adminJsonError("Email bloqué introuvable.", 400);
    }

    await releaseBlockedEmail({
      blockedEmailId,
      releaseNote: body?.releaseNote ?? null,
      adminLabel: session.fullName?.trim() || session.username,
    });

    await logAdminPortalActivity({
      adminUserId: session.adminUserId,
      action: "blocked_email_released",
      targetType: "blocked_email",
      targetId: blockedEmailId,
      metadata: {
        releaseNote: body?.releaseNote ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de réautoriser cet email.",
      500
    );
  }
}
