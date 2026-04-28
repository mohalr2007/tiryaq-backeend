import type {
  AdminBlockedEmail,
  AdminCommunityReport,
  AdminDoctorStatus,
  AdminManagedDoctor,
  AdminManagedDoctorDetails,
  AdminModerationActionType,
  AdminPortalOverview,
  AdminUserModerationStatus,
} from "@/features/admin-page/types";
import {
  normalizeDoctorVerificationStatus,
  normalizeModerationStatus,
  type SiteDoctorVerificationStatus,
  type SiteModerationStatus,
} from "@/utils/governance";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  countAdminUsers,
  getApprovedDoctorIds,
  getDoctorVerificationFiles,
  listDoctorVerificationFilesByDoctorIds,
  listDoctorVerifications,
  replaceDoctorVerificationSubmission,
  upsertDoctorVerification,
} from "./db";

type RawDoctorRow = {
  id: string;
  full_name: string | null;
  specialty: string | null;
  address: string | null;
  avatar_url: string | null;
  gender: string | null;
  bio: string | null;
  created_at: string | null;
  is_accepting_appointments: boolean | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  doctor_verification_status: string | null;
  is_doctor_verified: boolean | null;
  doctor_verification_note: string | null;
  doctor_verification_requested_at: string | null;
  doctor_verification_decided_at: string | null;
  doctor_verification_admin_label: string | null;
  moderation_status: string | null;
  moderation_reason: string | null;
};

type LegacyRawDoctorRow = Omit<
  RawDoctorRow,
  | "doctor_verification_status"
  | "is_doctor_verified"
  | "doctor_verification_note"
  | "doctor_verification_requested_at"
  | "doctor_verification_decided_at"
  | "doctor_verification_admin_label"
  | "moderation_status"
  | "moderation_reason"
>;

type VerificationRow = {
  doctor_id: string;
  verification_status: AdminDoctorStatus;
  is_doctor_verified: boolean;
  verification_note: string | null;
  request_message: string | null;
  requested_at: string | null;
  submitted_by_site_user_id: string | null;
  verified_by_admin_label: string | null;
  verified_at: string | null;
};

type ReportRelation<T> = T | T[] | null;

type RawPostReportRow = {
  id: string;
  post_id: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed" | "actioned";
  created_at: string;
  reviewed_at: string | null;
  reporter: ReportRelation<{ id: string; full_name: string | null }>;
  post: ReportRelation<{
    id: string;
    title: string | null;
    doctor_id: string | null;
    is_hidden: boolean | null;
    content: string | null;
  }>;
};

type RawCommentReportRow = {
  id: string;
  comment_id: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed" | "actioned";
  created_at: string;
  reviewed_at: string | null;
  reporter: ReportRelation<{ id: string; full_name: string | null }>;
  comment: ReportRelation<{
    id: string;
    content: string | null;
    user_id: string | null;
    is_hidden: boolean | null;
    post_id: string | null;
  }>;
};

type RawProfileNameRow = {
  id: string;
  full_name: string | null;
  moderation_status: string | null;
};

type RawBlockedEmailRow = {
  id: string;
  email: string;
  status: "blocked" | "released";
  reason: string | null;
  handled_by_admin_label: string | null;
  blocked_at: string;
  released_at: string | null;
  release_note: string | null;
};

type RawModerationActionTarget = {
  targetUserId: string | null;
  reportTable: "community_post_reports" | "community_comment_reports";
  reportColumn: "post_id" | "comment_id";
  entityType: "community_post_report" | "community_comment_report";
  currentStatus: "open" | "reviewed" | "dismissed" | "actioned";
};

const ADMIN_DOCTOR_SELECT =
  "id, full_name, specialty, address, avatar_url, gender, bio, created_at, is_accepting_appointments, working_hours_start, working_hours_end, doctor_verification_status, is_doctor_verified, doctor_verification_note, doctor_verification_requested_at, doctor_verification_decided_at, doctor_verification_admin_label, moderation_status, moderation_reason";
const ADMIN_DOCTOR_LEGACY_SELECT =
  "id, full_name, specialty, address, avatar_url, gender, bio, created_at, is_accepting_appointments, working_hours_start, working_hours_end";
const EMAIL_BLOCK_CACHE_TTL_MS = 10_000;

type BlockedEmailStatusRecord = {
  id: string;
  email: string;
  reason: string | null;
  blockedAt: string;
  handledByAdminLabel: string | null;
};

declare global {
  var __tiryaqBlockedEmailStatusCache:
    | Map<string, { expiresAt: number; value: BlockedEmailStatusRecord | null }>
    | undefined;
}

function getBlockedEmailStatusCache() {
  if (!globalThis.__tiryaqBlockedEmailStatusCache) {
    globalThis.__tiryaqBlockedEmailStatusCache = new Map();
  }

  return globalThis.__tiryaqBlockedEmailStatusCache;
}

function clearBlockedEmailStatusCache(email?: string | null) {
  const cache = getBlockedEmailStatusCache();

  if (!email) {
    cache.clear();
    return;
  }

  cache.delete(email.trim().toLowerCase());
}

function readBlockedEmailStatusCache(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cacheEntry = getBlockedEmailStatusCache().get(normalizedEmail);

  if (!cacheEntry) {
    return undefined;
  }

  if (cacheEntry.expiresAt <= Date.now()) {
    getBlockedEmailStatusCache().delete(normalizedEmail);
    return undefined;
  }

  return cacheEntry.value;
}

function writeBlockedEmailStatusCache(
  email: string,
  value: BlockedEmailStatusRecord | null,
) {
  getBlockedEmailStatusCache().set(email.trim().toLowerCase(), {
    expiresAt: Date.now() + EMAIL_BLOCK_CACHE_TTL_MS,
    value,
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const parts = [
      typeof candidate.message === "string" ? candidate.message : null,
      typeof candidate.details === "string" ? candidate.details : null,
      typeof candidate.hint === "string" ? candidate.hint : null,
      typeof candidate.code === "string" ? candidate.code : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    // Fallback: try JSON.stringify to avoid [object Object]
    try {
      return JSON.stringify(error);
    } catch {
      return "Erreur Supabase inconnue (objet non sérialisable).";
    }
  }

  return String(error) || "Erreur inconnue.";
}

function getSiteSetupMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lowered = message.toLowerCase();

  if (
    lowered.includes("doctor_verification_status") ||
    lowered.includes("is_doctor_verified") ||
    lowered.includes("blocked_emails") ||
    lowered.includes("user_moderation_actions") ||
    lowered.includes("moderation_status")
  ) {
    return "La base principale du site n'est pas prête pour la gouvernance admin. Exécutez d'abord back/17_admin_governance_verification_moderation.sql dans la base principale.";
  }

  return message;
}

function isMissingGovernanceSchemaError(error: unknown) {
  const message = getErrorMessage(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("doctor_verification_status") ||
    lowered.includes("is_doctor_verified") ||
    lowered.includes("moderation_status") ||
    lowered.includes("moderation_reason") ||
    lowered.includes("blocked_emails") ||
    lowered.includes("user_moderation_actions")
  );
}

function withLegacyGovernanceDefaults(row: LegacyRawDoctorRow): RawDoctorRow {
  return {
    ...row,
    doctor_verification_status: null,
    is_doctor_verified: null,
    doctor_verification_note: null,
    doctor_verification_requested_at: null,
    doctor_verification_decided_at: null,
    doctor_verification_admin_label: null,
    moderation_status: null,
    moderation_reason: null,
  };
}

function normalizeRelation<T>(value: ReportRelation<T>) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function mapDoctor(input: {
  row: RawDoctorRow;
  verification?: VerificationRow;
  documentsCount?: number;
}): AdminManagedDoctor {
  const { row, verification } = input;
  const verificationStatus = normalizeDoctorVerificationStatus(
    row.doctor_verification_status ?? verification?.verification_status
  );
  const moderationStatus = normalizeModerationStatus(row.moderation_status);
  const requestedAt = verification?.requested_at ?? row.doctor_verification_requested_at;
  const verifiedAt = row.doctor_verification_decided_at ?? verification?.verified_at ?? null;
  const verifiedByAdmin =
    row.doctor_verification_admin_label ?? verification?.verified_by_admin_label ?? null;
  const verificationNote = row.doctor_verification_note ?? verification?.verification_note ?? null;

  return {
    id: row.id,
    fullName: row.full_name,
    specialty: row.specialty,
    address: row.address,
    avatarUrl: row.avatar_url,
    gender: row.gender,
    bio: row.bio,
    createdAt: row.created_at,
    isAcceptingAppointments: row.is_accepting_appointments,
    workingHoursStart: row.working_hours_start,
    workingHoursEnd: row.working_hours_end,
    verificationStatus,
    isDoctorVerified: Boolean(row.is_doctor_verified ?? verification?.is_doctor_verified),
    verifiedAt,
    verifiedByAdmin,
    verificationNote,
    requestMessage: verification?.request_message ?? null,
    requestedAt,
    hasSubmittedDocuments: Boolean((input.documentsCount ?? 0) > 0 && requestedAt),
    documentsCount: input.documentsCount ?? 0,
    moderationStatus: moderationStatus as AdminUserModerationStatus,
    moderationReason: row.moderation_reason ?? null,
  };
}

async function fetchSiteDoctors() {
  const siteDb = createAdminClient();
  const { data, error } = await siteDb
    .from("profiles")
    .select(ADMIN_DOCTOR_SELECT)
    .eq("account_type", "doctor")
    .order("created_at", { ascending: false });

  if (!error) {
    return (data ?? []) as RawDoctorRow[];
  }

  if (!isMissingGovernanceSchemaError(error)) {
    throw new Error(getSiteSetupMessage(error));
  }

  const { data: legacyData, error: legacyError } = await siteDb
    .from("profiles")
    .select(ADMIN_DOCTOR_LEGACY_SELECT)
    .eq("account_type", "doctor")
    .order("created_at", { ascending: false });

  if (legacyError) {
    throw new Error(getSiteSetupMessage(legacyError));
  }

  return ((legacyData ?? []) as LegacyRawDoctorRow[]).map(withLegacyGovernanceDefaults);
}

async function updateSiteDoctorVerificationState(input: {
  doctorId: string;
  nextStatus: SiteDoctorVerificationStatus;
  note: string | null;
  adminLabel: string | null;
  requestedAt?: string | null;
}) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    doctor_verification_status: input.nextStatus,
    is_doctor_verified: input.nextStatus === "approved",
    doctor_verification_note: input.note,
    doctor_verification_admin_label: input.adminLabel,
    doctor_verification_decided_at:
      input.nextStatus === "approved" || input.nextStatus === "rejected" ? nowIso : null,
  };

  if (typeof input.requestedAt !== "undefined") {
    patch.doctor_verification_requested_at = input.requestedAt;
  }

  const { error } = await siteDb.from("profiles").update(patch).eq("id", input.doctorId);
  if (error) {
    throw new Error(getSiteSetupMessage(error));
  }
}

async function getUserEmailsByIds(userIds: string[]) {
  const siteDb = createAdminClient();
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));

  const entries = await Promise.all(
    uniqueIds.map(async (userId) => {
      const { data, error } = await siteDb.auth.admin.getUserById(userId);
      if (error || !data.user?.email) {
        return [userId, null] as const;
      }
      return [userId, data.user.email.toLowerCase()] as const;
    })
  );

  return new Map(entries);
}

async function getProfileNamesByIds(userIds: string[]) {
  const siteDb = createAdminClient();
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, RawProfileNameRow>();
  }

  const { data, error } = await siteDb
    .from("profiles")
    .select("id, full_name, moderation_status")
    .in("id", uniqueIds);

  if (!error) {
    return ((data ?? []) as RawProfileNameRow[]).reduce((map, row) => {
      map.set(row.id, row);
      return map;
    }, new Map<string, RawProfileNameRow>());
  }

  if (!isMissingGovernanceSchemaError(error)) {
    throw new Error(getSiteSetupMessage(error));
  }

  const { data: legacyData, error: legacyError } = await siteDb
    .from("profiles")
    .select("id, full_name")
    .in("id", uniqueIds);

  if (legacyError) {
    throw new Error(getSiteSetupMessage(legacyError));
  }

  return ((legacyData ?? []) as Array<{ id: string; full_name: string | null }>).reduce((map, row) => {
    map.set(row.id, {
      id: row.id,
      full_name: row.full_name,
      moderation_status: null,
    });
    return map;
  }, new Map<string, RawProfileNameRow>());
}

async function fetchDoctorProfileForVerification(doctorId: string) {
  const siteDb = createAdminClient();
  const { data, error } = await siteDb
    .from("profiles")
    .select(
      "id, account_type, full_name, specialty, doctor_verification_status, is_doctor_verified, doctor_verification_note, doctor_verification_requested_at, moderation_status, moderation_reason"
    )
    .eq("id", doctorId)
    .single();

  if (!error && data) {
    return data as {
      id: string;
      account_type: "doctor" | "patient" | null;
      full_name: string | null;
      specialty: string | null;
      doctor_verification_status: string | null;
      is_doctor_verified: boolean | null;
      doctor_verification_note: string | null;
      doctor_verification_requested_at: string | null;
      moderation_status: string | null;
      moderation_reason: string | null;
    };
  }

  if (!isMissingGovernanceSchemaError(error ?? "missing governance schema")) {
    throw new Error(getSiteSetupMessage(error ?? "Profil docteur introuvable."));
  }

  const { data: legacyData, error: legacyError } = await siteDb
    .from("profiles")
    .select("id, account_type, full_name, specialty")
    .eq("id", doctorId)
    .single();

  if (legacyError || !legacyData) {
    throw new Error(getSiteSetupMessage(legacyError ?? "Profil docteur introuvable."));
  }

  return {
    id: legacyData.id,
    account_type: legacyData.account_type,
    full_name: legacyData.full_name,
    specialty: legacyData.specialty,
    doctor_verification_status: null,
    is_doctor_verified: null,
    doctor_verification_note: null,
    doctor_verification_requested_at: null,
    moderation_status: null,
    moderation_reason: null,
  };
}

async function fetchDoctorByIdForAdmin(doctorId: string) {
  const siteDb = createAdminClient();
  const { data, error } = await siteDb
    .from("profiles")
    .select(ADMIN_DOCTOR_SELECT)
    .eq("id", doctorId)
    .single();

  if (!error && data) {
    return data as RawDoctorRow;
  }

  if (!isMissingGovernanceSchemaError(error ?? "missing governance schema")) {
    throw new Error(getSiteSetupMessage(error ?? "Docteur introuvable."));
  }

  const { data: legacyData, error: legacyError } = await siteDb
    .from("profiles")
    .select(ADMIN_DOCTOR_LEGACY_SELECT)
    .eq("id", doctorId)
    .single();

  if (legacyError || !legacyData) {
    throw new Error(getSiteSetupMessage(legacyError ?? "Docteur introuvable."));
  }

  return withLegacyGovernanceDefaults(legacyData as LegacyRawDoctorRow);
}

async function safeCountTable(
  tableName: string,
  statusFilter?: { column: string; value: string }
) {
  try {
    const siteDb = createAdminClient();
    let query = siteDb.from(tableName).select("id", { count: "exact", head: true });
    if (statusFilter) {
      query = query.eq(statusFilter.column, statusFilter.value);
    }
    const { count, error } = await query;
    if (error) {
      if (isMissingGovernanceSchemaError(error)) {
        return 0;
      }
      const msg = getErrorMessage(error);
      if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
        return 0;
      }
      throw new Error(msg);
    }
    return count ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
      return 0;
    }
    throw err;
  }
}

export async function getAdminPortalOverview(): Promise<AdminPortalOverview> {
  const [siteDoctors, totalAdmins, verificationMap, openPostReports, openCommentReports, blockedEmailsTotal] =
    await Promise.all([
      fetchSiteDoctors(),
      countAdminUsers(),
      listDoctorVerifications(),
      safeCountTable("community_post_reports", { column: "status", value: "open" }),
      safeCountTable("community_comment_reports", { column: "status", value: "open" }),
      safeCountTable("blocked_emails", { column: "status", value: "blocked" }),
    ]);

  const statusCounts = siteDoctors.reduce(
    (accumulator, doctor) => {
      const status = normalizeDoctorVerificationStatus(
        doctor.doctor_verification_status ?? verificationMap.get(doctor.id)?.verification_status
      );
      accumulator.totalDoctors += 1;
      if (status === "approved") {
        accumulator.approvedDoctors += 1;
      } else if (status === "rejected") {
        accumulator.rejectedDoctors += 1;
      } else {
        accumulator.pendingDoctors += 1;
      }
      return accumulator;
    },
    {
      totalDoctors: 0,
      pendingDoctors: 0,
      approvedDoctors: 0,
      rejectedDoctors: 0,
    }
  );

  return {
    ...statusCounts,
    totalAdmins,
    openReports: openPostReports + openCommentReports,
    blockedEmails: blockedEmailsTotal,
  };
}

export async function listDoctorsForAdmin(input?: {
  status?: "all" | AdminDoctorStatus;
  search?: string;
}) {
  const siteDoctors = await fetchSiteDoctors();
  const doctorIds = siteDoctors.map((doctor) => doctor.id);
  const [verificationMap, filesMap] = await Promise.all([
    listDoctorVerifications(doctorIds),
    listDoctorVerificationFilesByDoctorIds(doctorIds),
  ]);

  const normalizedSearch = input?.search?.trim().toLowerCase() ?? "";
  const merged = siteDoctors.map((doctor) =>
    mapDoctor({
      row: doctor,
      verification: verificationMap.get(doctor.id),
      documentsCount: filesMap.get(doctor.id)?.length ?? 0,
    })
  );

  return merged.filter((doctor) => {
    if (input?.status && input.status !== "all" && doctor.verificationStatus !== input.status) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return [doctor.fullName, doctor.specialty, doctor.address]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch));
  });
}

export async function getDoctorForAdminDetails(doctorId: string): Promise<AdminManagedDoctorDetails> {
  const [siteDoctors, verificationMap, files, emailMap] = await Promise.all([
    fetchSiteDoctors(),
    listDoctorVerifications([doctorId]),
    getDoctorVerificationFiles(doctorId, { includeSignedUrls: true }),
    getUserEmailsByIds([doctorId]),
  ]);

  const doctorRow = siteDoctors.find((entry) => entry.id === doctorId);
  if (!doctorRow) {
    throw new Error("Docteur introuvable dans la base principale du site.");
  }

  const latestProfile = await fetchDoctorByIdForAdmin(doctorId);

  const refreshed = mapDoctor({
    row: latestProfile,
    verification: verificationMap.get(doctorId),
    documentsCount: files.length,
  });

  return {
    ...refreshed,
    files,
    email: emailMap.get(doctorId) ?? null,
  };
}

export async function updateDoctorVerificationStatus(input: {
  doctorId: string;
  nextStatus: AdminDoctorStatus;
  note?: string | null;
  adminUserId: string;
  adminLabel: string;
}) {
  const siteDoctors = await fetchSiteDoctors();
  const doctor = siteDoctors.find((entry) => entry.id === input.doctorId);

  if (!doctor) {
    throw new Error("Docteur introuvable dans la base principale du site.");
  }

  const verification = await upsertDoctorVerification({
    doctorId: input.doctorId,
    status: input.nextStatus,
    note: input.note?.trim() || null,
    adminUserId: input.adminUserId,
    adminLabel: input.adminLabel,
  });

  await updateSiteDoctorVerificationState({
    doctorId: input.doctorId,
    nextStatus: input.nextStatus,
    note: input.note?.trim() || null,
    adminLabel: input.adminLabel,
  });

  return mapDoctor({ row: doctor, verification });
}

export async function submitDoctorVerificationRequest(input: {
  doctorId: string;
  submittedBySiteUserId: string;
  requestMessage: string | null;
  files: Array<{
    documentType: "clinic_document" | "medical_certificate" | "other";
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    storagePath: string;
  }>;
}) {
  const verification = await replaceDoctorVerificationSubmission({
    doctorId: input.doctorId,
    requestMessage: input.requestMessage,
    submittedBySiteUserId: input.submittedBySiteUserId,
    files: input.files,
  });

  await updateSiteDoctorVerificationState({
    doctorId: input.doctorId,
    nextStatus: "pending",
    note: null,
    adminLabel: null,
    requestedAt: verification?.requested_at ?? new Date().toISOString(),
  });

  return verification;
}

export async function getDoctorVerificationRequestState(doctorId: string) {
  const [profile, verificationMap, files] = await Promise.all([
    fetchDoctorProfileForVerification(doctorId),
    listDoctorVerifications([doctorId]),
    getDoctorVerificationFiles(doctorId, { includeSignedUrls: false }),
  ]);

  const verification = verificationMap.get(doctorId);
  return {
    profile,
    verification: verification
      ? {
          requestMessage: verification.request_message,
          requestedAt: verification.requested_at,
          verificationStatus: verification.verification_status,
          verificationNote: verification.verification_note,
          verifiedAt: verification.verified_at,
          verifiedByAdmin: verification.verified_by_admin_label,
        }
      : null,
    files,
  };
}

export async function getApprovedSiteDoctorIds() {
  const siteDb = createAdminClient();
  const { data, error } = await siteDb
    .from("profiles")
    .select("id")
    .eq("account_type", "doctor")
    .eq("doctor_verification_status", "approved")
    .eq("is_doctor_verified", true)
    .neq("moderation_status", "permanently_blocked")
    .neq("moderation_status", "temporarily_blocked");

  if (!error) {
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  if (!isMissingGovernanceSchemaError(error)) {
    throw new Error(getSiteSetupMessage(error));
  }

  return await getApprovedDoctorIds();
}

export async function listCommunityReportsForAdmin(): Promise<AdminCommunityReport[]> {
  try {
    const siteDb = createAdminClient();
    const [postReportsResult, commentReportsResult] = await Promise.all([
      siteDb
        .from("community_post_reports")
        .select(
          "id, post_id, reason, status, created_at, reviewed_at, reporter:profiles!reporter_id(id, full_name), post:community_posts!post_id(id, title, doctor_id, is_hidden, content)"
        )
        .order("created_at", { ascending: false }),
      siteDb
        .from("community_comment_reports")
        .select(
          "id, comment_id, reason, status, created_at, reviewed_at, reporter:profiles!reporter_id(id, full_name), comment:community_post_comments!comment_id(id, content, user_id, is_hidden, post_id)"
        )
        .order("created_at", { ascending: false }),
    ]);

    if (postReportsResult.error) {
      const msg = getErrorMessage(postReportsResult.error).toLowerCase();
      if (!msg.includes("does not exist") && !msg.includes("relation") && !msg.includes("is_hidden") && !msg.includes("reporter_id")) {
        console.warn("[admin-portal] community_post_reports query error:", msg);
      }
    }
    if (commentReportsResult.error) {
      const msg = getErrorMessage(commentReportsResult.error).toLowerCase();
      if (!msg.includes("does not exist") && !msg.includes("relation") && !msg.includes("is_hidden") && !msg.includes("reporter_id")) {
        console.warn("[admin-portal] community_comment_reports query error:", msg);
      }
    }

  const postReports = (postReportsResult.data ?? []) as RawPostReportRow[];
  const commentReports = (commentReportsResult.data ?? []) as RawCommentReportRow[];

  const targetIds = [
    ...postReports.map((report) => normalizeRelation(report.post)?.doctor_id ?? null),
    ...commentReports.map((report) => normalizeRelation(report.comment)?.user_id ?? null),
  ].filter(Boolean) as string[];

  const [profileNames] = await Promise.all([
    getProfileNamesByIds(targetIds),
  ]);
  const emailMap = new Map<string, string>(); // Optimization: Removed slow N+1 getUserEmailsByIds call here

  const normalizedPostReports: AdminCommunityReport[] = postReports.map((report) => {
    const post = normalizeRelation(report.post);
    const reporter = normalizeRelation(report.reporter);
    const targetUserId = post?.doctor_id ?? null;
    const targetProfile = targetUserId ? profileNames.get(targetUserId) : null;
    return {
      id: report.id,
      reportType: "post",
      reportStatus: report.status,
      reason: report.reason,
      createdAt: report.created_at,
      reviewedAt: report.reviewed_at,
      reporterName: reporter?.full_name ?? null,
      targetUserId,
      targetUserName: targetProfile?.full_name ?? null,
      targetUserEmail: targetUserId ? emailMap.get(targetUserId) ?? null : null,
      targetModerationStatus: normalizeModerationStatus(
        targetProfile?.moderation_status
      ) as AdminUserModerationStatus,
      contentPreview: post?.content ?? null,
      subjectTitle: post?.title ?? null,
      isHidden: Boolean(post?.is_hidden),
    };
  });

  const normalizedCommentReports: AdminCommunityReport[] = commentReports.map((report) => {
    const comment = normalizeRelation(report.comment);
    const reporter = normalizeRelation(report.reporter);
    const targetUserId = comment?.user_id ?? null;
    const targetProfile = targetUserId ? profileNames.get(targetUserId) : null;
    return {
      id: report.id,
      reportType: "comment",
      reportStatus: report.status,
      reason: report.reason,
      createdAt: report.created_at,
      reviewedAt: report.reviewed_at,
      reporterName: reporter?.full_name ?? null,
      targetUserId,
      targetUserName: targetProfile?.full_name ?? null,
      targetUserEmail: targetUserId ? emailMap.get(targetUserId) ?? null : null,
      targetModerationStatus: normalizeModerationStatus(
        targetProfile?.moderation_status
      ) as AdminUserModerationStatus,
      contentPreview: comment?.content ?? null,
      subjectTitle: "Commentaire de communauté",
      isHidden: Boolean(comment?.is_hidden),
    };
  });

    return [...normalizedPostReports, ...normalizedCommentReports].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  } catch (err) {
    console.warn("[admin-portal] listCommunityReportsForAdmin failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function listBlockedEmailsForAdmin(): Promise<AdminBlockedEmail[]> {
  try {
    const siteDb = createAdminClient();
    const { data, error } = await siteDb
      .from("blocked_emails")
      .select("id, email, status, reason, handled_by_admin_label, blocked_at, released_at, release_note")
      .order("blocked_at", { ascending: false });

    if (error) {
      console.warn("[admin-portal] blocked_emails query error:", getErrorMessage(error));
      return [];
    }

    return ((data ?? []) as RawBlockedEmailRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
      reason: row.reason,
      handledByAdminLabel: row.handled_by_admin_label,
      blockedAt: row.blocked_at,
      releasedAt: row.released_at,
      releaseNote: row.release_note,
    }));
  } catch (err) {
    console.warn("[admin-portal] listBlockedEmailsForAdmin failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function resolveReportTarget(reportType: "post" | "comment", reportId: string) {
  const siteDb = createAdminClient();

  if (reportType === "post") {
    const { data, error } = await siteDb
      .from("community_post_reports")
      .select("status, post:community_posts!post_id(doctor_id)")
      .eq("id", reportId)
      .single();

    const typedData = data as unknown as {
      status: "open" | "reviewed" | "dismissed" | "actioned";
      post: ReportRelation<{ doctor_id: string | null }>;
    } | null;

    if (error || !typedData) {
      throw new Error(getSiteSetupMessage(error ?? "Signalement publication introuvable."));
    }

    return {
      targetUserId: normalizeRelation(typedData.post)?.doctor_id ?? null,
      reportTable: "community_post_reports",
      reportColumn: "post_id",
      entityType: "community_post_report",
      currentStatus: typedData.status,
    } as RawModerationActionTarget;
  }

  const { data, error } = await siteDb
    .from("community_comment_reports")
    .select("status, comment:community_post_comments!comment_id(user_id)")
    .eq("id", reportId)
    .single();

  const typedData = data as unknown as {
    status: "open" | "reviewed" | "dismissed" | "actioned";
    comment: ReportRelation<{ user_id: string | null }>;
  } | null;

  if (error || !typedData) {
    throw new Error(getSiteSetupMessage(error ?? "Signalement commentaire introuvable."));
  }

  return {
    targetUserId: normalizeRelation(typedData.comment)?.user_id ?? null,
    reportTable: "community_comment_reports",
    reportColumn: "comment_id",
    entityType: "community_comment_report",
    currentStatus: typedData.status,
  } as RawModerationActionTarget;
}

export async function resolveCommunityReportAction(input: {
  reportType: "post" | "comment";
  reportId: string;
  actionType: AdminModerationActionType;
  reason: string | null;
  adminLabel: string;
}) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();
  const target = await resolveReportTarget(input.reportType, input.reportId);

  if (!target.targetUserId) {
    throw new Error("Impossible de retrouver l'utilisateur ciblé par ce signalement.");
  }

  const emailMap = await getUserEmailsByIds([target.targetUserId]);
  const targetEmail = emailMap.get(target.targetUserId) ?? null;
  const moderationReason = input.reason?.trim() || "Décision admin";

  const nextReportStatus = input.actionType === "false_alert" ? "dismissed" : "actioned";
  const { error: reportError } = await siteDb
    .from(target.reportTable)
    .update({
      status: nextReportStatus,
      reviewed_at: nowIso,
    })
    .eq("id", input.reportId);

  if (reportError) {
    throw new Error(getSiteSetupMessage(reportError));
  }

  if (input.actionType !== "false_alert") {
    let nextModerationStatus: SiteModerationStatus = "active";
    if (input.actionType === "warning") {
      nextModerationStatus = "warned";
    } else if (input.actionType === "temporary_block") {
      nextModerationStatus = "temporarily_blocked";
    } else if (input.actionType === "permanent_block") {
      nextModerationStatus = "permanently_blocked";
    }

    const { error: profileError } = await siteDb
      .from("profiles")
      .update({
        moderation_status: nextModerationStatus,
        moderation_reason: moderationReason,
        moderation_updated_at: nowIso,
      })
      .eq("id", target.targetUserId);

    if (profileError) {
      throw new Error(getSiteSetupMessage(profileError));
    }

    if (
      (input.actionType === "temporary_block" ||
        input.actionType === "permanent_block") &&
      targetEmail
    ) {
      const { error: blockedError } = await siteDb.from("blocked_emails").upsert(
        {
          email: targetEmail,
          status: "blocked",
          reason: moderationReason,
          handled_by_admin_label: input.adminLabel,
          blocked_at: nowIso,
          released_at: null,
          release_note: null,
        },
        { onConflict: "email" }
      );

      if (blockedError) {
        throw new Error(getSiteSetupMessage(blockedError));
      }

      if (input.actionType === "permanent_block") {
        await enforcePermanentEmailBlock({
          email: targetEmail,
          reason: moderationReason,
          nowIso,
          knownUserId: target.targetUserId,
        });
      } else {
        clearBlockedEmailStatusCache(targetEmail);
      }
    }
  }

  const { error: actionError } = await siteDb.from("user_moderation_actions").insert({
    target_user_id: target.targetUserId,
    target_email: targetEmail,
    report_type: target.entityType,
    report_id: input.reportId,
    action_type: input.actionType === "false_alert" ? "false_alert" : input.actionType,
    reason: moderationReason,
    admin_actor_label: input.adminLabel,
    created_at: nowIso,
  });

  if (actionError) {
    throw new Error(getSiteSetupMessage(actionError));
  }
}

export async function releaseBlockedEmail(input: {
  blockedEmailId: string;
  releaseNote: string | null;
  adminLabel: string;
}) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: row, error: fetchError } = await siteDb
    .from("blocked_emails")
    .select("id, email")
    .eq("id", input.blockedEmailId)
    .single();

  if (fetchError || !row) {
    throw new Error(getSiteSetupMessage(fetchError ?? "Email bloqué introuvable."));
  }

  const { error } = await siteDb
    .from("blocked_emails")
    .update({
      status: "released",
      release_note: input.releaseNote?.trim() || null,
      released_at: nowIso,
      handled_by_admin_label: input.adminLabel,
    })
    .eq("id", input.blockedEmailId);

  if (error) {
    throw new Error(getSiteSetupMessage(error));
  }

  const { error: actionError } = await siteDb.from("user_moderation_actions").insert({
    target_email: row.email,
    report_type: "manual",
    action_type: "email_released",
    reason: input.releaseNote?.trim() || "Email réautorisé par l'admin",
    admin_actor_label: input.adminLabel,
    created_at: nowIso,
  });

  if (actionError) {
    throw new Error(getSiteSetupMessage(actionError));
  }

  clearBlockedEmailStatusCache(typeof row.email === "string" ? row.email : null);
}

async function findSiteAuthUserIdsByEmail(email: string) {
  const siteDb = createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();
  const matchingUserIds = new Set<string>();
  let page = 1;
  const perPage = 200;

  for (let index = 0; index < 25; index += 1) {
    const { data, error } = await siteDb.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(getSiteSetupMessage(error));
    }

    const users = data.users ?? [];
    for (const user of users) {
      if (user.email?.trim().toLowerCase() === normalizedEmail) {
        matchingUserIds.add(user.id);
      }
    }

    if (!data.nextPage || users.length === 0) {
      break;
    }

    page = data.nextPage;
  }

  return Array.from(matchingUserIds);
}

async function enforcePermanentEmailBlock(input: {
  email: string;
  reason: string;
  nowIso: string;
  knownUserId?: string | null;
}) {
  const siteDb = createAdminClient();
  const normalizedEmail = input.email.trim().toLowerCase();
  const userIds = new Set<string>();

  if (input.knownUserId) {
    userIds.add(input.knownUserId);
  }

  const discoveredUserIds = await findSiteAuthUserIdsByEmail(normalizedEmail);
  for (const userId of discoveredUserIds) {
    userIds.add(userId);
  }

  const targetIds = Array.from(userIds);
  if (targetIds.length > 0) {
    const { error: profileError } = await siteDb
      .from("profiles")
      .update({
        moderation_status: "permanently_blocked",
        moderation_reason: input.reason,
        moderation_updated_at: input.nowIso,
      })
      .in("id", targetIds);

    if (profileError && !isMissingGovernanceSchemaError(profileError)) {
      throw new Error(getSiteSetupMessage(profileError));
    }

    await Promise.all(
      targetIds.map(async (userId) => {
        try {
          await siteDb.auth.admin.deleteUser(userId);
        } catch {
          // Soft fallback: the email blacklist and moderation flag remain authoritative.
        }
      }),
    );
  }

  clearBlockedEmailStatusCache(normalizedEmail);
}

export async function getEmailBlockStatus(email: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return null;
    }

    const cached = readBlockedEmailStatusCache(normalizedEmail);
    if (typeof cached !== "undefined") {
      return cached;
    }

    const siteDb = createAdminClient();
    const { data, error } = await siteDb
      .from("blocked_emails")
      .select("id, email, status, reason, handled_by_admin_label, blocked_at, released_at, release_note")
      .eq("email", normalizedEmail)
      .eq("status", "blocked")
      .maybeSingle<RawBlockedEmailRow>();

    if (error) {
      // Never crash the auth flow — log and treat as "not blocked"
      console.warn("[admin-portal] getEmailBlockStatus error:", getErrorMessage(error));
      writeBlockedEmailStatusCache(normalizedEmail, null);
      return null;
    }

    if (!data) {
      writeBlockedEmailStatusCache(normalizedEmail, null);
      return null;
    }

    const record: BlockedEmailStatusRecord = {
      id: data.id,
      email: data.email,
      reason: data.reason,
      blockedAt: data.blocked_at,
      handledByAdminLabel: data.handled_by_admin_label,
    };

    writeBlockedEmailStatusCache(normalizedEmail, record);
    return record;
  } catch (err) {
    // Absolute safety net: never let email block check crash auth flow
    console.warn("[admin-portal] getEmailBlockStatus crashed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function blockEmailManually(input: {
  email: string;
  reason: string | null;
  adminLabel: string;
}) {
  const siteDb = createAdminClient();
  const normalizedEmail = input.email.trim().toLowerCase();
  
  if (!normalizedEmail) {
    throw new Error("L'email est requis.");
  }

  const nowIso = new Date().toISOString();

  // Insert or update in blocked_emails
  const { error } = await siteDb
    .from("blocked_emails")
    .upsert({
      email: normalizedEmail,
      status: "blocked",
      reason: input.reason?.trim() || "Bloqué manuellement par l'admin",
      handled_by_admin_label: input.adminLabel,
      blocked_at: nowIso,
      released_at: null,
      release_note: null
    }, { onConflict: "email" });

  if (error) {
    throw new Error(getSiteSetupMessage(error));
  }

  await enforcePermanentEmailBlock({
    email: normalizedEmail,
    reason: input.reason?.trim() || "Bloqué manuellement par l'admin",
    nowIso,
  });

  // Insert an audit log
  const { error: actionError } = await siteDb.from("user_moderation_actions").insert({
    target_email: normalizedEmail,
    report_type: "manual",
    action_type: "email_blocked",
    reason: input.reason?.trim() || "Bloqué manuellement",
    admin_actor_label: input.adminLabel,
    created_at: nowIso,
  });

  if (actionError) {
    throw new Error(getSiteSetupMessage(actionError));
  }
}
