import { Buffer } from "buffer";
import { NextResponse } from "next/server";
import { getDoctorVerificationRequestState, submitDoctorVerificationRequest } from "@/utils/admin-portal/site";
import { uploadVerificationFileToAdminBucket } from "@/utils/admin-portal/db";
import { withCors, handleCorsPreflight } from "@/utils/cors";
import { resolveRequestSupabaseClient } from "@/utils/requestSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

type UploadedVerificationFile = {
  documentType: "clinic_document" | "medical_certificate" | "other";
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function asFiles(value: FormDataEntryValue[]) {
  return value.filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

function resolveMimeType(file: File) {
  const declaredType = file.type?.trim().toLowerCase();
  if (declaredType) {
    return declaredType;
  }

  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

async function handleUploadFiles(
  doctorId: string,
  documentType: "clinic_document" | "medical_certificate" | "other",
  files: File[]
) {
  const uploaded: UploadedVerificationFile[] = [];

  for (const file of files) {
    const mimeType = resolveMimeType(file);

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Type de fichier refusé: ${file.name}`);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Fichier trop volumineux: ${file.name}. Maximum 15 MB.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await uploadVerificationFileToAdminBucket({
      doctorId,
      category: documentType,
      fileName: file.name,
      contentType: mimeType,
      buffer,
    });

    uploaded.push({
      documentType,
      fileName: file.name,
      mimeType,
      fileSizeBytes: file.size,
      storagePath: stored.storagePath,
    });
  }

  return uploaded;
}

export async function POST(request: Request) {
  try {
    const { client: supabase, user, authError } = await resolveRequestSupabaseClient(request);

    if (authError || !user) {
      return withCors(
        NextResponse.json({ error: "Session docteur introuvable." }, { status: 401 }),
        request,
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, account_type")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.account_type !== "doctor") {
      return withCors(
        NextResponse.json({ error: "Seuls les docteurs peuvent envoyer une demande de validation." }, { status: 403 }),
        request,
      );
    }

    const formData = await request.formData();
    const requestMessage = String(formData.get("requestMessage") ?? "").trim() || null;
    const clinicDocuments = asFiles(formData.getAll("clinicDocuments"));
    const medicalCertificates = asFiles(formData.getAll("medicalCertificates"));
    const otherDocuments = asFiles(formData.getAll("otherDocuments"));

    if (clinicDocuments.length === 0 || medicalCertificates.length === 0) {
      return withCors(
        NextResponse.json(
          { error: "Ajoutez au moins un papier de clinique et un certificat médical." },
          { status: 400 }
        ),
        request,
      );
    }

    const verificationState = await getDoctorVerificationRequestState(user.id);
    const currentStatus =
      verificationState.verification?.verificationStatus ??
      verificationState.profile.doctor_verification_status;
    const hasActiveFiles = verificationState.files.length > 0;
    const hasPendingRequest = Boolean(
      verificationState.verification?.requestedAt ??
        verificationState.profile.doctor_verification_requested_at
    );

    if (currentStatus === "approved") {
      return withCors(
        NextResponse.json(
          { error: "Ce docteur est déjà validé. Aucune nouvelle demande n'est nécessaire." },
          { status: 409 }
        ),
        request,
      );
    }

    if (currentStatus === "pending" && hasPendingRequest && hasActiveFiles) {
      return withCors(
        NextResponse.json(
          { error: "Une demande de validation est déjà en attente. Patientez jusqu'à la décision de l'admin." },
          { status: 409 }
        ),
        request,
      );
    }

    const [clinicUploads, medicalUploads, otherUploads] = await Promise.all([
      handleUploadFiles(user.id, "clinic_document", clinicDocuments),
      handleUploadFiles(user.id, "medical_certificate", medicalCertificates),
      handleUploadFiles(user.id, "other", otherDocuments),
    ]);

    const verification = await submitDoctorVerificationRequest({
      doctorId: user.id,
      submittedBySiteUserId: user.id,
      requestMessage,
      files: [...clinicUploads, ...medicalUploads, ...otherUploads],
    });

    return withCors(
      NextResponse.json({
        ok: true,
        verification,
        uploadedFiles: clinicUploads.length + medicalUploads.length + otherUploads.length,
      }),
      request,
    );
  } catch (error) {
    return withCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Impossible d'envoyer la demande de validation." },
        { status: 500 }
      ),
      request,
    );
  }
}

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}
