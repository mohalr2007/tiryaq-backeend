import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { handleCorsPreflight, withCors } from "@/utils/cors";

type VisitPrescriptionItem = {
  id: string;
  prescription_id?: string;
  line_number: number;
  medication_name: string;
  dosage: string | null;
  instructions: string | null;
  duration: string | null;
  created_at?: string;
  updated_at?: string;
};

type PublicPrescriptionRecord = {
  id: string;
  visit_id?: string | null;
  dossier_id?: string | null;
  doctor_id: string;
  patient_id: string | null;
  patient_registration_number?: string | null;
  prescription_number: string;
  public_token: string;
  prescription_date: string;
  patient_display_name: string;
  doctor_display_name: string;
  doctor_specialty: string | null;
  doctor_address: string | null;
  doctor_phone: string | null;
  signature_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items?: VisitPrescriptionItem[] | null;
  dossier?: { patient_registration_number: string | null } | { patient_registration_number: string | null }[] | null;
};

function sortPrescriptionItems<T extends { line_number: number }>(items: T[]) {
  return [...items].sort((left, right) => left.line_number - right.line_number);
}

function normalizePrescriptionRecord(record: PublicPrescriptionRecord) {
  const normalizedDossier = Array.isArray(record.dossier) ? (record.dossier[0] ?? null) : (record.dossier ?? null);

  return {
    ...record,
    visit_id: record.visit_id ?? null,
    dossier_id: record.dossier_id ?? null,
    patient_registration_number: record.patient_registration_number ?? normalizedDossier?.patient_registration_number ?? null,
    items: sortPrescriptionItems(record.items ?? []),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const admin = createAdminClient();

    const visitPrescriptionResult = await admin
      .from("visit_prescriptions")
      .select("id, visit_id, dossier_id, doctor_id, patient_id, prescription_number, public_token, prescription_date, patient_display_name, doctor_display_name, doctor_specialty, doctor_address, doctor_phone, signature_label, notes, created_at, updated_at, dossier:medical_dossiers!dossier_id(patient_registration_number), items:visit_prescription_items(id, prescription_id, line_number, medication_name, dosage, instructions, duration, created_at, updated_at)")
      .eq("public_token", token)
      .maybeSingle();

    const standalonePrescriptionResult = !visitPrescriptionResult.data
      ? await admin
          .from("standalone_prescriptions")
          .select("id, dossier_id, doctor_id, patient_id, patient_registration_number, prescription_number, public_token, prescription_date, patient_display_name, doctor_display_name, doctor_specialty, doctor_address, doctor_phone, signature_label, notes, created_at, updated_at, items:standalone_prescription_items(id, prescription_id, line_number, medication_name, dosage, instructions, duration, created_at, updated_at)")
          .eq("public_token", token)
          .maybeSingle()
      : { data: null, error: null };

    const data = visitPrescriptionResult.data ?? standalonePrescriptionResult.data;
    const error = visitPrescriptionResult.error ?? standalonePrescriptionResult.error;

    if (error) {
      return withCors(
        NextResponse.json({ error: "Prescription lookup failed." }, { status: 500 }),
        request,
      );
    }

    if (!data) {
      return withCors(
        NextResponse.json({ error: "Prescription not found." }, { status: 404 }),
        request,
      );
    }

    return withCors(NextResponse.json(normalizePrescriptionRecord(data as PublicPrescriptionRecord)), request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return withCors(NextResponse.json({ error: message }, { status: 500 }), request);
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET,OPTIONS");
}
