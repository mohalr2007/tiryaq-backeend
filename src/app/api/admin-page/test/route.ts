import { NextResponse } from "next/server";
import { getAdminPortalOverview, listDoctorsForAdmin } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await getAdminPortalOverview();
    const doctors = await listDoctorsForAdmin({ status: "all", search: "" });
    return NextResponse.json({
      overview,
      doctorsCount: doctors.length,
      doctors: doctors.map(d => ({
        id: d.id,
        fullName: d.fullName,
        verificationStatus: d.verificationStatus
      }))
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
