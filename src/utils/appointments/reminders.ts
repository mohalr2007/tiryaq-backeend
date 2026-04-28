import { Resend } from "resend";
import { createAdminClient } from "@/utils/supabase/admin";

type AppointmentReminderDoctor = {
  full_name: string | null;
  specialty: string | null;
  address: string | null;
  google_maps_link: string | null;
};

type AppointmentReminderPatient = {
  full_name: string | null;
};

type AppointmentReminderRow = {
  id: string;
  appointment_date: string;
  status: string;
  patient_id: string;
  doctor_id: string;
  requested_date: string | null;
  requested_time: string | null;
  follow_up_time_pending: boolean | null;
  booking_selection_mode: string | null;
  reminder_24h_sent_at: string | null;
  reminder_24h_processing_at: string | null;
  doctor: AppointmentReminderDoctor | AppointmentReminderDoctor[] | null;
  patient: AppointmentReminderPatient | AppointmentReminderPatient[] | null;
};

type ReminderDispatchResult = {
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{
    appointmentId: string;
    message: string;
  }>;
};

declare global {
  var __tiryaqResendClient: Resend | undefined;
}

const DEFAULT_FROM_EMAIL = "TERIAQ <onboarding@resend.dev>";
const DEFAULT_TIMEZONE = "Africa/Algiers";
const DEFAULT_WINDOW_MINUTES = 90;
const DEFAULT_STALE_CLAIM_MINUTES = 30;

export function areAppointmentReminderEmailsEnabled() {
  return process.env.EMAIL_REMINDERS_ENABLED?.trim().toLowerCase() === "true";
}

function getEnvNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getReminderTimezone() {
  return process.env.APPOINTMENT_REMINDER_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
}

function getReminderWindowMinutes() {
  return getEnvNumber(process.env.APPOINTMENT_REMINDER_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
}

function getStaleClaimMinutes() {
  return getEnvNumber(process.env.APPOINTMENT_REMINDER_STALE_CLAIM_MINUTES, DEFAULT_STALE_CLAIM_MINUTES);
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

function getResendFromEmail() {
  return process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
}

function getResendReplyTo() {
  return process.env.RESEND_REPLY_TO?.trim() || undefined;
}

function getResendClient() {
  if (globalThis.__tiryaqResendClient) {
    return globalThis.__tiryaqResendClient;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY n'est pas configuré. Ajoutez-le dans front/.env.local puis redémarrez le serveur.");
  }

  globalThis.__tiryaqResendClient = new Resend(apiKey);
  return globalThis.__tiryaqResendClient;
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatLocalizedDateTime(dateIso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: getReminderTimezone(),
  }).format(new Date(dateIso));
}

function buildMapsLink(doctor: AppointmentReminderDoctor | null) {
  const explicitLink = doctor?.google_maps_link?.trim();
  if (explicitLink) {
    return explicitLink;
  }

  const address = doctor?.address?.trim();
  if (!address) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildReminderEmail(input: {
  patientName: string;
  patientEmail: string;
  doctorName: string;
  doctorSpecialty: string | null;
  doctorAddress: string | null;
  appointmentIso: string;
  mapsLink: string | null;
}) {
  const frDate = formatLocalizedDateTime(input.appointmentIso, "fr-FR");
  const enDate = formatLocalizedDateTime(input.appointmentIso, "en-US");
  const arDate = formatLocalizedDateTime(input.appointmentIso, "ar-DZ");
  const appBaseUrl = getAppBaseUrl();
  const doctorLabel = input.doctorSpecialty
    ? `${input.doctorName} · ${input.doctorSpecialty}`
    : input.doctorName;
  const safeDoctorLabel = escapeHtml(doctorLabel);
  const safePatientName = escapeHtml(input.patientName);
  const safeAddress = input.doctorAddress ? escapeHtml(input.doctorAddress) : null;
  const safeMapsLink = input.mapsLink ? escapeHtml(input.mapsLink) : null;
  const safeDashboardUrl = escapeHtml(`${appBaseUrl}/patient-dashboard`);

  const subject = `Rappel rendez-vous demain - TERIAQ | Appointment reminder for tomorrow | تذكير بموعد الغد - TERIAQ`;

  const html = `
    <div style="font-family: Arial, sans-serif; background:#f6f8fc; padding:24px; color:#0f172a;">
      <div style="max-width:720px; margin:0 auto; background:#ffffff; border-radius:18px; overflow:hidden; border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#1d4ed8,#0f172a); color:#ffffff; padding:24px 28px;">
          <h1 style="margin:0; font-size:24px;">TERIAQ</h1>
          <p style="margin:8px 0 0; opacity:0.9;">Rappel automatique de rendez-vous · Automatic appointment reminder · تذكير تلقائي بالموعد</p>
        </div>

        <div style="padding:28px;">
          <section style="margin-bottom:24px;">
            <h2 style="margin:0 0 12px; color:#1d4ed8;">Français</h2>
            <p>Bonjour <strong>${safePatientName}</strong>,</p>
            <p>Nous vous rappelons que vous avez un rendez-vous demain avec <strong>${safeDoctorLabel}</strong>.</p>
            <p><strong>Date et heure :</strong> ${escapeHtml(frDate)}</p>
            ${safeAddress ? `<p><strong>Adresse :</strong> ${safeAddress}</p>` : ""}
            ${safeMapsLink ? `<p><a href="${safeMapsLink}" style="color:#1d4ed8;">Voir l'itinéraire sur la carte</a></p>` : ""}
            <p><a href="${safeDashboardUrl}" style="display:inline-block; background:#1d4ed8; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:12px;">Ouvrir mon dashboard</a></p>
          </section>

          <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />

          <section style="margin-bottom:24px;">
            <h2 style="margin:0 0 12px; color:#1d4ed8;">English</h2>
            <p>Hello <strong>${safePatientName}</strong>,</p>
            <p>This is a reminder that you have an appointment tomorrow with <strong>${safeDoctorLabel}</strong>.</p>
            <p><strong>Date and time:</strong> ${escapeHtml(enDate)}</p>
            ${safeAddress ? `<p><strong>Address:</strong> ${safeAddress}</p>` : ""}
            ${safeMapsLink ? `<p><a href="${safeMapsLink}" style="color:#1d4ed8;">Open directions on the map</a></p>` : ""}
            <p><a href="${safeDashboardUrl}" style="display:inline-block; background:#1d4ed8; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:12px;">Open my dashboard</a></p>
          </section>

          <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />

          <section dir="rtl" style="text-align:right;">
            <h2 style="margin:0 0 12px; color:#1d4ed8;">العربية</h2>
            <p>مرحباً <strong>${safePatientName}</strong>،</p>
            <p>نذكرك بأن لديك موعداً غداً مع <strong>${safeDoctorLabel}</strong>.</p>
            <p><strong>التاريخ والوقت:</strong> ${escapeHtml(arDate)}</p>
            ${safeAddress ? `<p><strong>العنوان:</strong> ${safeAddress}</p>` : ""}
            ${safeMapsLink ? `<p><a href="${safeMapsLink}" style="color:#1d4ed8;">فتح المسار على الخريطة</a></p>` : ""}
            <p><a href="${safeDashboardUrl}" style="display:inline-block; background:#1d4ed8; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:12px;">فتح لوحة المريض</a></p>
          </section>
        </div>
      </div>
    </div>
  `;

  const text = [
    "TERIAQ",
    "",
    "FR",
    `Bonjour ${input.patientName},`,
    `Rappel: vous avez un rendez-vous demain avec ${doctorLabel}.`,
    `Date et heure: ${frDate}`,
    input.doctorAddress ? `Adresse: ${input.doctorAddress}` : null,
    input.mapsLink ? `Carte: ${input.mapsLink}` : null,
    `Dashboard: ${appBaseUrl}/patient-dashboard`,
    "",
    "EN",
    `Hello ${input.patientName},`,
    `Reminder: you have an appointment tomorrow with ${doctorLabel}.`,
    `Date and time: ${enDate}`,
    input.doctorAddress ? `Address: ${input.doctorAddress}` : null,
    input.mapsLink ? `Map: ${input.mapsLink}` : null,
    `Dashboard: ${appBaseUrl}/patient-dashboard`,
    "",
    "AR",
    `مرحباً ${input.patientName}`,
    `تذكير: لديك موعد غداً مع ${doctorLabel}.`,
    `التاريخ والوقت: ${arDate}`,
    input.doctorAddress ? `العنوان: ${input.doctorAddress}` : null,
    input.mapsLink ? `الخريطة: ${input.mapsLink}` : null,
    `لوحة المريض: ${appBaseUrl}/patient-dashboard`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

async function getUserEmailById(userId: string) {
  const siteDb = createAdminClient();
  const { data, error } = await siteDb.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(`Impossible de charger l'email auth pour l'utilisateur ${userId}: ${error.message}`);
  }

  return data.user.email?.trim().toLowerCase() ?? null;
}

async function clearStaleReminderClaims() {
  const siteDb = createAdminClient();
  const staleThreshold = new Date(Date.now() - getStaleClaimMinutes() * 60 * 1000).toISOString();

  const { error } = await siteDb
    .from("appointments")
    .update({
      reminder_24h_processing_at: null,
      reminder_24h_processing_token: null,
    })
    .is("reminder_24h_sent_at", null)
    .lt("reminder_24h_processing_at", staleThreshold);

  if (error) {
    throw new Error(`Impossible de nettoyer les verrous de rappel expirés: ${error.message}`);
  }
}

async function listReminderCandidates() {
  const siteDb = createAdminClient();
  const now = Date.now();
  const windowMinutes = getReminderWindowMinutes();
  const rangeStart = new Date(now + (24 * 60 - windowMinutes / 2) * 60 * 1000).toISOString();
  const rangeEnd = new Date(now + (24 * 60 + windowMinutes / 2) * 60 * 1000).toISOString();

  const { data, error } = await siteDb
    .from("appointments")
    .select(
      "id, appointment_date, status, patient_id, doctor_id, requested_date, requested_time, follow_up_time_pending, booking_selection_mode, reminder_24h_sent_at, reminder_24h_processing_at, doctor:profiles!doctor_id(full_name, specialty, address, google_maps_link), patient:profiles!patient_id(full_name)"
    )
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", rangeStart)
    .lte("appointment_date", rangeEnd)
    .is("reminder_24h_sent_at", null)
    .is("reminder_24h_processing_at", null)
    .eq("follow_up_time_pending", false)
    .not("requested_time", "is", null)
    .order("appointment_date", { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les rendez-vous à rappeler: ${error.message}`);
  }

  return (data ?? []) as AppointmentReminderRow[];
}

async function claimReminderCandidate(appointmentId: string, claimToken: string) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await siteDb
    .from("appointments")
    .update({
      reminder_24h_processing_at: nowIso,
      reminder_24h_processing_token: claimToken,
    })
    .eq("id", appointmentId)
    .is("reminder_24h_sent_at", null)
    .is("reminder_24h_processing_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Impossible de verrouiller le rappel du rendez-vous ${appointmentId}: ${error.message}`);
  }

  return Boolean(data);
}

async function markReminderSuccess(input: {
  appointmentId: string;
  claimToken: string;
  deliveryId: string | null;
  recipientEmail: string;
}) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();

  const { error } = await siteDb
    .from("appointments")
    .update({
      reminder_24h_sent_at: nowIso,
      reminder_24h_delivery_id: input.deliveryId,
      reminder_24h_recipient_email: input.recipientEmail,
      reminder_24h_error: null,
      reminder_24h_error_at: null,
      reminder_24h_processing_at: null,
      reminder_24h_processing_token: null,
    })
    .eq("id", input.appointmentId)
    .eq("reminder_24h_processing_token", input.claimToken);

  if (error) {
    throw new Error(`Impossible d'enregistrer le succès du rappel ${input.appointmentId}: ${error.message}`);
  }
}

async function markReminderFailure(input: {
  appointmentId: string;
  claimToken: string;
  message: string;
}) {
  const siteDb = createAdminClient();
  const nowIso = new Date().toISOString();

  const { error } = await siteDb
    .from("appointments")
    .update({
      reminder_24h_error: input.message.slice(0, 1000),
      reminder_24h_error_at: nowIso,
      reminder_24h_processing_at: null,
      reminder_24h_processing_token: null,
    })
    .eq("id", input.appointmentId)
    .eq("reminder_24h_processing_token", input.claimToken);

  if (error) {
    throw new Error(`Impossible d'enregistrer l'échec du rappel ${input.appointmentId}: ${error.message}`);
  }
}

export async function dispatchAppointmentReminderEmails(): Promise<ReminderDispatchResult> {
  if (!areAppointmentReminderEmailsEnabled()) {
    return {
      scanned: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };
  }

  const resend = getResendClient();
  await clearStaleReminderClaims();
  const candidates = await listReminderCandidates();

  const result: ReminderDispatchResult = {
    scanned: candidates.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const appointment of candidates) {
    const claimToken = crypto.randomUUID();
    const claimed = await claimReminderCandidate(appointment.id, claimToken);

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    result.claimed += 1;

    try {
      const patientEmail = await getUserEmailById(appointment.patient_id);
      if (!patientEmail) {
        throw new Error("Aucun email patient n'est disponible dans Supabase Auth pour ce rendez-vous.");
      }

      const doctor = unwrapRelation(appointment.doctor);
      const patient = unwrapRelation(appointment.patient);
      const patientName = patient?.full_name?.trim() || patientEmail;
      const doctorName = doctor?.full_name?.trim() || "votre médecin";
      const doctorSpecialty = doctor?.specialty?.trim() || null;
      const doctorAddress = doctor?.address?.trim() || null;
      const mapsLink = buildMapsLink(doctor);
      const email = buildReminderEmail({
        patientName,
        patientEmail,
        doctorName,
        doctorSpecialty,
        doctorAddress,
        appointmentIso: appointment.appointment_date,
        mapsLink,
      });

      const { data, error } = await resend.emails.send({
        from: getResendFromEmail(),
        to: patientEmail,
        replyTo: getResendReplyTo(),
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      if (error) {
        throw new Error(error.message);
      }

      await markReminderSuccess({
        appointmentId: appointment.id,
        claimToken,
        deliveryId: data?.id ?? null,
        recipientEmail: patientEmail,
      });

      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue lors de l'envoi du rappel.";
      await markReminderFailure({
        appointmentId: appointment.id,
        claimToken,
        message,
      });
      result.failed += 1;
      result.errors.push({
        appointmentId: appointment.id,
        message,
      });
    }
  }

  return result;
}
