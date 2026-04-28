import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { listBlockedEmailsForAdmin, listCommunityReportsForAdmin } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireAdminPortalSession();
  if (response) {
    return response;
  }

  try {
    const [reports, blockedEmails] = await Promise.all([
      listCommunityReportsForAdmin(),
      listBlockedEmailsForAdmin(),
    ]);

    return NextResponse.json({ reports, blockedEmails });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de charger les signalements admin.",
      500
    );
  }
}
