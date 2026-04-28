import { NextResponse } from "next/server";
import { getEmailBlockStatus } from "@/utils/admin-portal/site";
import { createClient } from "@/utils/supabase/server";
import { isUserRestricted } from "@/utils/governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim() ?? "";
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let moderationStatus: string | null = null;
    let moderationReason: string | null = null;
    let restricted = false;

    if (user?.id) {
      const { data: fullProfile, error: fullProfileError } = await supabase
        .from("profiles")
        .select("moderation_status, moderation_reason")
        .eq("id", user.id)
        .single();

      if (!fullProfileError && fullProfile) {
        moderationStatus = fullProfile.moderation_status ?? null;
        moderationReason = fullProfile.moderation_reason ?? null;
        restricted = isUserRestricted(fullProfile);
      }
    }

    const effectiveEmail = user?.email?.trim() || email;
    const blocked = effectiveEmail ? await getEmailBlockStatus(effectiveEmail) : null;

    if (!effectiveEmail && !user?.id) {
      return NextResponse.json({
        blocked: false,
        restricted: false,
        moderationStatus: null,
        moderationReason: null,
      });
    }

    return NextResponse.json({
      blocked: Boolean(blocked || restricted),
      emailBlocked: Boolean(blocked),
      restricted,
      moderationStatus,
      moderationReason,
      block: blocked,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de vérifier l'éligibilité de cet email." },
      { status: 500 }
    );
  }
}
