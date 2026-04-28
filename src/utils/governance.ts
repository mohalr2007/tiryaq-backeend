export type SiteDoctorVerificationStatus = "pending" | "approved" | "rejected";
export type SiteModerationStatus =
  | "active"
  | "warned"
  | "temporarily_blocked"
  | "permanently_blocked";

export type GovernedProfileSnapshot = {
  account_type?: string | null;
  doctor_verification_status?: string | null;
  is_doctor_verified?: boolean | null;
  moderation_status?: string | null;
};

export function normalizeDoctorVerificationStatus(
  value: string | null | undefined
): SiteDoctorVerificationStatus {
  if (value === "approved" || value === "rejected") {
    return value;
  }
  return "pending";
}

export function normalizeModerationStatus(value: string | null | undefined): SiteModerationStatus {
  if (
    value === "warned" ||
    value === "temporarily_blocked" ||
    value === "permanently_blocked"
  ) {
    return value;
  }
  return "active";
}

export function isDoctorApproved(profile: GovernedProfileSnapshot | null | undefined) {
  if (profile?.account_type !== "doctor") {
    return true;
  }

  return (
    normalizeDoctorVerificationStatus(profile.doctor_verification_status) === "approved" &&
    Boolean(profile.is_doctor_verified)
  );
}

export function isUserRestricted(profile: GovernedProfileSnapshot | null | undefined) {
  const moderationStatus = normalizeModerationStatus(profile?.moderation_status);
  return moderationStatus === "temporarily_blocked" || moderationStatus === "permanently_blocked";
}

export function mustRedirectDoctorToVerification() {
  // Allow unverified doctors to access the dashboard by bypassing the forced redirect.
  // They can complete verification later.
  return false;
}
