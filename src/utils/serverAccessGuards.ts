import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isDoctorApproved } from "@/utils/governance";

type GovernedServerProfile = {
  account_type?: string | null;
  doctor_verification_status?: string | null;
  is_doctor_verified?: boolean | null;
  moderation_status?: string | null;
};

async function fetchGovernedProfile(userId: string) {
  const supabase = await createClient();

  const { data: fullProfile, error: fullProfileError } = await supabase
    .from("profiles")
    .select(
      "account_type, doctor_verification_status, is_doctor_verified, moderation_status",
    )
    .eq("id", userId)
    .single();

  if (!fullProfileError && fullProfile) {
    return fullProfile as GovernedServerProfile;
  }

  const { data: basicProfile } = await supabase
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .single();

  return basicProfile
    ? ({
        ...basicProfile,
        doctor_verification_status: null,
        is_doctor_verified: null,
        moderation_status: null,
      } satisfies GovernedServerProfile)
    : null;
}

export async function requirePatientDashboardAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // In local/dev usage the browser client may still be restoring a valid
    // Supabase session from storage while the server sees no auth cookie yet.
    // Let the client-side guard and dashboard bootstrap resolve that state
    // instead of forcing a false logout loop.
    return;
  }

  const profile = await fetchGovernedProfile(user.id);
  if (!profile) {
    return;
  }

  if (profile.account_type === "doctor") {
    redirect("/dashboardoctlarabi");
  }
}

export async function requireDoctorDashboardAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const profile = await fetchGovernedProfile(user.id);
  if (!profile) {
    return;
  }

  if (profile.account_type !== "doctor") {
    redirect("/dashboardpatientlarabi");
  }
}

export async function requireDoctorVerificationAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const profile = await fetchGovernedProfile(user.id);
  if (!profile) {
    return;
  }

  if (profile.account_type !== "doctor") {
    redirect("/dashboardpatientlarabi");
  }

  if (isDoctorApproved(profile)) {
    redirect("/dashboardoctlarabi");
  }
}
