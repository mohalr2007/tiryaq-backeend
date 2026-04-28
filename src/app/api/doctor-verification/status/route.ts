import { NextResponse } from "next/server";
import { getDoctorVerificationRequestState } from "@/utils/admin-portal/site";
import { withCors, handleCorsPreflight } from "@/utils/cors";
import { resolveRequestSupabaseClient } from "@/utils/requestSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, authError } = await resolveRequestSupabaseClient(request);

    if (authError || !user) {
      return withCors(NextResponse.json({ error: "Session introuvable." }, { status: 401 }), request);
    }

    const state = await getDoctorVerificationRequestState(user.id);
    if (state.profile.account_type !== "doctor") {
      return withCors(NextResponse.json({ error: "Cette page est réservée aux docteurs." }, { status: 403 }), request);
    }

    return withCors(NextResponse.json(state), request);
  } catch (error) {
    return withCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Impossible de charger l'état de vérification du docteur." },
        { status: 500 }
      ),
      request,
    );
  }
}

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}
