import { NextResponse } from "next/server";
import { adminJsonError, requireAdminPortalSession } from "@/utils/admin-portal/api";
import { logAdminPortalActivity } from "@/utils/admin-portal/db";
import { getDoctorForAdminDetails, updateDoctorVerificationStatus } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ doctorId: string }> }
) {
  const { response } = await requireAdminPortalSession();
  if (response) {
    return response;
  }

  try {
    const { doctorId } = await context.params;
    if (!doctorId) {
      return adminJsonError("Docteur introuvable.", 400);
    }

    const doctor = await getDoctorForAdminDetails(doctorId);
    return NextResponse.json({ doctor });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de charger la fiche complète du docteur.",
      500
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ doctorId: string }> }
) {
  const { session, response } = await requireAdminPortalSession();
  if (response || !session) {
    return response;
  }

  try {
    const { doctorId } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { action?: "approve" | "reject" | "pending"; note?: string }
      | null;

    const action = body?.action;
    if (!doctorId || !action) {
      return adminJsonError("Action ou docteur introuvable.", 400);
    }

    const nextStatus =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";

    const doctor = await updateDoctorVerificationStatus({
      doctorId,
      nextStatus,
      note: body?.note ?? null,
      adminUserId: session.adminUserId,
      adminLabel: session.fullName?.trim() || session.username,
    });

    await logAdminPortalActivity({
      adminUserId: session.adminUserId,
      action: `doctor_${nextStatus}`,
      targetType: "doctor_profile",
      targetId: doctorId,
      metadata: {
        note: body?.note ?? null,
      },
    });

    return NextResponse.json({ doctor });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de mettre à jour la validation du docteur.",
      500
    );
  }
}
