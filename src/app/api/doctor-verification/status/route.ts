import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getDoctorVerificationRequestState } from "@/utils/admin-portal/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Session introuvable." }, { status: 401 });
    }

    const state = await getDoctorVerificationRequestState(user.id);
    if (state.profile.account_type !== "doctor") {
      return NextResponse.json({ error: "Cette page est réservée aux docteurs." }, { status: 403 });
    }

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de charger l'état de vérification du docteur." },
      { status: 500 }
    );
  }
}
