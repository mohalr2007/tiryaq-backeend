import { NextResponse } from "next/server";
import { getApprovedSiteDoctorIds } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const doctorIds = await getApprovedSiteDoctorIds();
    return NextResponse.json({ doctorIds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de charger les validations des docteurs." },
      { status: 500 }
    );
  }
}
