import { NextRequest, NextResponse } from "next/server";
import { getApprovedSiteDoctorIds } from "@/utils/admin-portal/site";
import { handleCorsPreflight, withCors } from "@/utils/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const doctorIds = await getApprovedSiteDoctorIds();
    return withCors(NextResponse.json({ doctorIds }), request);
  } catch (error) {
    return withCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Impossible de charger les validations des docteurs." },
        { status: 500 }
      ),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}
