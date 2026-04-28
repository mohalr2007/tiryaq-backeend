import { NextResponse } from "next/server";
import { requireAdminPortalSession, adminJsonError } from "@/utils/admin-portal/api";
import { getAdminPortalOverview } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireAdminPortalSession();
  if (response) {
    return response;
  }

  try {
    const overview = await getAdminPortalOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de charger le tableau de bord admin.",
      500
    );
  }
}
