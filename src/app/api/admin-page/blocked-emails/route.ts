import { NextRequest, NextResponse } from "next/server";
import { requireAdminPortalSession, adminJsonError } from "@/utils/admin-portal/api";
import { blockEmailManually } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { response, session } = await requireAdminPortalSession();
  if (response || !session) {
    return response;
  }

  try {
    const payload = await request.json();
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : null;

    if (!email) {
      return adminJsonError("L'email est requis.", 400);
    }

    await blockEmailManually({
      email,
      reason: reason || "Bloqué manuellement par l'admin",
      adminLabel: session.fullName?.trim() || session.username,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminJsonError(
      error instanceof Error ? error.message : "Impossible de bloquer cet email.",
      500
    );
  }
}
