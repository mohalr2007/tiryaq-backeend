import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { logAdminPortalActivity } from "@/utils/admin-portal/db";
import { resolveCommunityReportAction } from "@/utils/admin-portal/site";
import type { AdminModerationActionType } from "@/features/admin-page/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reportType: string; reportId: string }> }
) {
  const { session, response } = await requireAdminPortalSession();
  if (response || !session) {
    return response;
  }

  try {
    const { reportType, reportId } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { actionType?: AdminModerationActionType; reason?: string }
      | null;

    if ((reportType !== "post" && reportType !== "comment") || !reportId || !body?.actionType) {
      return adminJsonError("Signalement ou action de modération invalide.", 400);
    }

    await resolveCommunityReportAction({
      reportType,
      reportId,
      actionType: body.actionType,
      reason: body.reason ?? null,
      adminLabel: session.fullName?.trim() || session.username,
    });

    await logAdminPortalActivity({
      adminUserId: session.adminUserId,
      action: `report_${body.actionType}`,
      targetType: `community_${reportType}_report`,
      targetId: reportId,
      metadata: {
        reason: body.reason ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de traiter ce signalement.",
      500
    );
  }
}
