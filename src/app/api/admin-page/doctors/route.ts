import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { listDoctorsForAdmin } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { response } = await requireAdminPortalSession();
  if (response) {
    return response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search") ?? "";

    const doctors = await listDoctorsForAdmin({
      status:
        status === "pending" || status === "approved" || status === "rejected" || status === "all"
          ? status
          : "all",
      search,
    });

    return NextResponse.json({ doctors });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de charger la liste des docteurs.",
      500
    );
  }
}
