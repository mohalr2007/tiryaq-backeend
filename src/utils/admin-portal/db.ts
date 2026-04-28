import { randomUUID } from "crypto";
import type {
  AdminDoctorDocumentType,
  AdminDoctorVerificationFile,
  AdminPortalRole,
  AdminUserPublic,
} from "@/features/admin-page/types";
import type { AdminPortalJson } from "@/utils/supabase/adminPortal";
import { createAdminPortalClient } from "@/utils/supabase/adminPortal";
import { hashAdminPassword, verifyAdminPassword } from "./security";

type AdminUserRow = {
  id: string;
  username: string;
  full_name: string | null;
  password_hash: string;
  role: AdminPortalRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type AdminDoctorVerificationRow = {
  doctor_id: string;
  verification_status: "pending" | "approved" | "rejected";
  is_doctor_verified: boolean;
  verification_note: string | null;
  request_message: string | null;
  requested_at: string | null;
  submitted_by_site_user_id: string | null;
  verified_by_admin_user_id: string | null;
  verified_by_admin_label: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type PartialAdminDoctorVerificationRow = Partial<AdminDoctorVerificationRow> & {
  doctor_id: string;
  verification_status?: "pending" | "approved" | "rejected";
};

type AdminDoctorVerificationFileRow = {
  id: string;
  doctor_id: string;
  document_type: AdminDoctorDocumentType;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_bucket: string;
  storage_path: string;
  uploaded_by_site_user_id: string;
  uploaded_at: string;
  is_active: boolean;
};

type VerificationUploadInput = {
  doctorId: string;
  requestMessage: string | null;
  submittedBySiteUserId: string;
  files: Array<{
    documentType: AdminDoctorDocumentType;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    storagePath: string;
  }>;
};

declare global {
  var __tiryaqAdminPortalReady: Promise<void> | undefined;
}

const DEFAULT_ADMIN_USERNAME = "mohamed larabi";
const DEFAULT_ADMIN_PASSWORD = "30/04/2007";
const DEFAULT_ADMIN_FULL_NAME = "Mohamed Larabi";
const ADMIN_VERIFICATION_BUCKET = "doctor-verification-files";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    return [
      typeof candidate.message === "string" ? candidate.message : null,
      typeof candidate.details === "string" ? candidate.details : null,
      typeof candidate.hint === "string" ? candidate.hint : null,
      typeof candidate.code === "string" ? candidate.code : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  return String(error);
}

function getSetupMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lowered = message.toLowerCase();

  if (
    lowered.includes("admin_doctor_verification_files") ||
    lowered.includes("could not find the table 'public.admin_doctor_verification_files'")
  ) {
    return "La table admin_doctor_verification_files manque dans le projet Supabase admin. Relancez maintenant le script back/admin_page_external_db.sql mis à jour, puis réessayez l'envoi des fichiers.";
  }

  if (
    lowered.includes("doctor-verification-files") &&
    (lowered.includes("bucket") || lowered.includes("not found") || lowered.includes("does not exist"))
  ) {
    return "Le bucket storage doctor-verification-files n'existe pas encore dans le projet Supabase admin. Relancez le script back/admin_page_external_db.sql mis à jour dans ce projet admin.";
  }

  if (
    lowered.includes("admin_users") ||
    lowered.includes("admin_doctor_verifications") ||
    lowered.includes("relation") ||
    lowered.includes("schema cache")
  ) {
    return "La base Supabase admin n'est pas prête. Exécutez d'abord le script back/admin_page_external_db.sql dans le projet Supabase admin.";
  }

  return message;
}

function isMissingVerificationFilesTableError(error: unknown) {
  const message = getErrorMessage(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("admin_doctor_verification_files") ||
    lowered.includes("could not find the table 'public.admin_doctor_verification_files'") ||
    lowered.includes("schema cache")
  );
}

function mapAdminUser(row: AdminUserRow): AdminUserPublic {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function mapVerificationFile(
  row: AdminDoctorVerificationFileRow,
  signedUrl: string | null
): AdminDoctorVerificationFile {
  return {
    id: row.id,
    documentType: row.document_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedAt: row.uploaded_at,
    url: signedUrl,
  };
}

function normalizeVerificationRow(row: PartialAdminDoctorVerificationRow): AdminDoctorVerificationRow {
  return {
    doctor_id: row.doctor_id,
    verification_status: row.verification_status ?? "pending",
    is_doctor_verified: Boolean(row.is_doctor_verified),
    verification_note: row.verification_note ?? null,
    request_message: row.request_message ?? null,
    requested_at: row.requested_at ?? null,
    submitted_by_site_user_id: row.submitted_by_site_user_id ?? null,
    verified_by_admin_user_id: row.verified_by_admin_user_id ?? null,
    verified_by_admin_label: row.verified_by_admin_label ?? null,
    verified_at: row.verified_at ?? null,
    created_at: row.created_at ?? new Date(0).toISOString(),
    updated_at: row.updated_at ?? new Date(0).toISOString(),
  };
}

export function normalizeAdminUsername(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function ensureSeedAdminUser() {
  const client = createAdminPortalClient();
  const username = normalizeAdminUsername(process.env.ADMIN_DEFAULT_USERNAME ?? DEFAULT_ADMIN_USERNAME);
  const password = process.env.ADMIN_DEFAULT_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_DEFAULT_FULL_NAME ?? DEFAULT_ADMIN_FULL_NAME;

  const { count, error } = await client
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const passwordHash = await hashAdminPassword(password);
  const { error: insertError } = await client.from("admin_users").insert({
    id: randomUUID(),
    username,
    full_name: fullName,
    password_hash: passwordHash,
    role: "super_admin",
    is_active: true,
  });

  if (insertError) {
    throw new Error(getSetupMessage(insertError));
  }
}

export async function ensureAdminPortalDbReady() {
  // Retry once in the same request if we inherit a stale rejected promise
  // from an earlier server state before the admin DB was initialized.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!globalThis.__tiryaqAdminPortalReady) {
      globalThis.__tiryaqAdminPortalReady = ensureSeedAdminUser();
    }

    try {
      await globalThis.__tiryaqAdminPortalReady;
      return;
    } catch (error) {
      globalThis.__tiryaqAdminPortalReady = undefined;

      if (attempt === 1) {
        throw error;
      }
    }
  }
}

export async function authenticateAdminUser(username: string, password: string) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const normalizedUsername = normalizeAdminUsername(username);

  const { data, error } = await client
    .from("admin_users")
    .select("id, username, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at")
    .eq("username", normalizedUsername)
    .maybeSingle<AdminUserRow>();

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  if (!data) {
    return null;
  }

  if (!data.is_active) {
    throw new Error("Ce compte admin est désactivé.");
  }

  const passwordOk = await verifyAdminPassword(password, data.password_hash);
  if (!passwordOk) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await client
    .from("admin_users")
    .update({
      last_login_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", data.id);

  if (updateError) {
    throw new Error(getSetupMessage(updateError));
  }

  return mapAdminUser({
    ...data,
    last_login_at: nowIso,
    updated_at: nowIso,
  });
}

export async function listAdminUsers() {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const { data, error } = await client
    .from("admin_users")
    .select("id, username, full_name, role, is_active, created_at, updated_at, last_login_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return ((data ?? []) as Omit<AdminUserRow, "password_hash">[]).map((row) =>
    mapAdminUser({ ...row, password_hash: "" })
  );
}

export async function createAdminUser(input: {
  username: string;
  password: string;
  fullName: string | null;
  role: AdminPortalRole;
}) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const username = normalizeAdminUsername(input.username);

  if (!username) {
    throw new Error("Le username admin est obligatoire.");
  }

  const passwordHash = await hashAdminPassword(input.password);
  const fullName = input.fullName?.trim() || null;

  const { data, error } = await client
    .from("admin_users")
    .insert({
      id: randomUUID(),
      username,
      full_name: fullName,
      password_hash: passwordHash,
      role: input.role,
      is_active: true,
    })
    .select("id, username, full_name, role, is_active, created_at, updated_at, last_login_at")
    .single();

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return mapAdminUser({ ...(data as Omit<AdminUserRow, "password_hash">), password_hash: "" });
}

export async function countAdminUsers() {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const { count, error } = await client
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return count ?? 0;
}

export async function logAdminPortalActivity(input: {
  adminUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();

  const { error } = await client.from("admin_activity_logs").insert({
    admin_user_id: input.adminUserId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata: (input.metadata ?? {}) as AdminPortalJson,
  });

  if (error) {
    throw new Error(getSetupMessage(error));
  }
}

export async function listDoctorVerifications(doctorIds?: string[]) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();

  let query = client.from("admin_doctor_verifications").select("*");

  if (doctorIds && doctorIds.length > 0) {
    query = query.in("doctor_id", doctorIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return ((data ?? []) as PartialAdminDoctorVerificationRow[]).reduce((map, row) => {
    map.set(row.doctor_id, normalizeVerificationRow(row));
    return map;
  }, new Map<string, AdminDoctorVerificationRow>());
}

export async function listDoctorVerificationFilesByDoctorIds(doctorIds: string[]) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();

  if (doctorIds.length === 0) {
    return new Map<string, AdminDoctorVerificationFileRow[]>();
  }

  const { data, error } = await client
    .from("admin_doctor_verification_files")
    .select("id, doctor_id, document_type, file_name, mime_type, file_size_bytes, storage_bucket, storage_path, uploaded_by_site_user_id, uploaded_at, is_active")
    .in("doctor_id", doctorIds)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false });

  if (error) {
    if (isMissingVerificationFilesTableError(error)) {
      return new Map<string, AdminDoctorVerificationFileRow[]>();
    }
    throw new Error(getSetupMessage(error));
  }

  return ((data ?? []) as AdminDoctorVerificationFileRow[]).reduce((map, row) => {
    const current = map.get(row.doctor_id) ?? [];
    current.push(row);
    map.set(row.doctor_id, current);
    return map;
  }, new Map<string, AdminDoctorVerificationFileRow[]>());
}

export async function getDoctorVerificationFiles(
  doctorId: string,
  options?: { includeSignedUrls?: boolean }
) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const { data, error } = await client
    .from("admin_doctor_verification_files")
    .select("id, doctor_id, document_type, file_name, mime_type, file_size_bytes, storage_bucket, storage_path, uploaded_by_site_user_id, uploaded_at, is_active")
    .eq("doctor_id", doctorId)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false });

  if (error) {
    if (isMissingVerificationFilesTableError(error)) {
      return [];
    }
    throw new Error(getSetupMessage(error));
  }

  const files = (data ?? []) as AdminDoctorVerificationFileRow[];
  if (!options?.includeSignedUrls) {
    return files.map((row) => mapVerificationFile(row, null));
  }

  const signedResults = await Promise.all(
    files.map(async (row) => {
      const { data: signed, error: signedError } = await client.storage
        .from(row.storage_bucket || ADMIN_VERIFICATION_BUCKET)
        .createSignedUrl(row.storage_path, 60 * 20);

      if (signedError) {
        return mapVerificationFile(row, null);
      }

      return mapVerificationFile(row, signed?.signedUrl ?? null);
    })
  );

  return signedResults;
}

export async function upsertDoctorVerification(input: {
  doctorId: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  adminUserId: string;
  adminLabel: string;
}) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const nowIso = new Date().toISOString();
  const verifiedAt = input.status === "approved" ? nowIso : input.status === "rejected" ? nowIso : null;

  const { data, error } = await client
    .from("admin_doctor_verifications")
    .upsert(
      {
        doctor_id: input.doctorId,
        verification_status: input.status,
        is_doctor_verified: input.status === "approved",
        verification_note: input.note,
        verified_by_admin_user_id: input.adminUserId,
        verified_by_admin_label: input.adminLabel,
        verified_at: verifiedAt,
        updated_at: nowIso,
      },
      { onConflict: "doctor_id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return normalizeVerificationRow(data as PartialAdminDoctorVerificationRow);
}

export async function replaceDoctorVerificationSubmission(input: VerificationUploadInput) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await client
    .from("admin_doctor_verifications")
    .select("doctor_id, verification_status, is_doctor_verified, verification_note, request_message, requested_at, submitted_by_site_user_id, verified_by_admin_user_id, verified_by_admin_label, verified_at, created_at, updated_at")
    .eq("doctor_id", input.doctorId)
    .maybeSingle<AdminDoctorVerificationRow>();

  if (existingError) {
    throw new Error(getSetupMessage(existingError));
  }

  const { count: activeFilesCount, error: activeFilesError } = await client
    .from("admin_doctor_verification_files")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", input.doctorId)
    .eq("is_active", true);

  if (activeFilesError) {
    throw new Error(getSetupMessage(activeFilesError));
  }

  if (existing?.verification_status === "approved") {
    throw new Error("Ce docteur est déjà validé. Aucune nouvelle demande n'est nécessaire.");
  }

  if (existing?.verification_status === "pending" && existing?.requested_at && (activeFilesCount ?? 0) > 0) {
    throw new Error("Une demande de validation est déjà en attente. Patientez jusqu'à la décision de l'admin.");
  }

  const { error: archiveError } = await client
    .from("admin_doctor_verification_files")
    .update({ is_active: false })
    .eq("doctor_id", input.doctorId)
    .eq("is_active", true);

  if (archiveError) {
    throw new Error(getSetupMessage(archiveError));
  }

  const { error: verificationError } = await client
    .from("admin_doctor_verifications")
    .upsert(
      {
        doctor_id: input.doctorId,
        verification_status: "pending",
        is_doctor_verified: false,
        request_message: input.requestMessage,
        requested_at: nowIso,
        submitted_by_site_user_id: input.submittedBySiteUserId,
        verified_by_admin_user_id: null,
        verified_by_admin_label: null,
        verified_at: null,
        updated_at: nowIso,
      },
      { onConflict: "doctor_id" }
    );

  if (verificationError) {
    throw new Error(getSetupMessage(verificationError));
  }

  const { error: filesError } = await client.from("admin_doctor_verification_files").insert(
    input.files.map((file) => ({
      id: randomUUID(),
      doctor_id: input.doctorId,
      document_type: file.documentType,
      file_name: file.fileName,
      mime_type: file.mimeType,
      file_size_bytes: file.fileSizeBytes,
      storage_bucket: ADMIN_VERIFICATION_BUCKET,
      storage_path: file.storagePath,
      uploaded_by_site_user_id: input.submittedBySiteUserId,
      uploaded_at: nowIso,
      is_active: true,
    }))
  );

  if (filesError) {
    throw new Error(getSetupMessage(filesError));
  }

  const refreshedMap = await listDoctorVerifications([input.doctorId]);
  return refreshedMap.get(input.doctorId) ?? null;
}

export async function uploadVerificationFileToAdminBucket(input: {
  doctorId: string;
  category: AdminDoctorDocumentType;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${input.doctorId}/${Date.now()}-${input.category}-${safeName}`;

  const { error } = await client.storage
    .from(ADMIN_VERIFICATION_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: input.contentType,
      upsert: true,
      cacheControl: "3600",
    });

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return {
    bucket: ADMIN_VERIFICATION_BUCKET,
    storagePath,
  };
}

export async function getApprovedDoctorIds() {
  await ensureAdminPortalDbReady();
  const client = createAdminPortalClient();
  const { data, error } = await client
    .from("admin_doctor_verifications")
    .select("doctor_id")
    .eq("verification_status", "approved")
    .eq("is_doctor_verified", true);

  if (error) {
    throw new Error(getSetupMessage(error));
  }

  return ((data ?? []) as { doctor_id: string }[]).map((row) => row.doctor_id);
}
