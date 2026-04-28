import { supabase } from "@/utils/supabase/client";

export type DoctorVacationLike = {
  vacation_start?: string | null;
  vacation_end?: string | null;
  is_on_vacation?: boolean | null;
};

function parseDateBoundary(value: string | null | undefined, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

export function normalizeTimeValue(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return fallback;
  }

  return `${match[1]}:${match[2]}`;
}

export function getLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function hasDoctorVacationExpired(doctor: DoctorVacationLike | null | undefined, now = new Date()) {
  if (!doctor?.vacation_end) {
    return false;
  }

  const vacationEnd = parseDateBoundary(doctor.vacation_end, true);
  if (!vacationEnd) {
    return false;
  }

  return now.getTime() > vacationEnd.getTime();
}

export function isDoctorOnVacation(doctor: DoctorVacationLike | null | undefined, now = new Date()) {
  if (!doctor) {
    return false;
  }

  if (hasDoctorVacationExpired(doctor, now)) {
    return false;
  }

  if (doctor.is_on_vacation) {
    return true;
  }

  const vacationStart = parseDateBoundary(doctor.vacation_start);
  const vacationEnd = parseDateBoundary(doctor.vacation_end, true);
  if (!vacationStart || !vacationEnd) {
    return false;
  }

  return now.getTime() >= vacationStart.getTime() && now.getTime() <= vacationEnd.getTime();
}

export function clearExpiredVacationFlag<T extends DoctorVacationLike>(doctor: T): T {
  if (!hasDoctorVacationExpired(doctor)) {
    return doctor;
  }

  return {
    ...doctor,
    is_on_vacation: false,
  };
}

export async function syncExpiredDoctorVacations() {
  // Local fallback logic already keeps the UI correct.
  // We intentionally avoid the RPC here because some deployed databases
  // do not have the optional migration yet, which causes noisy 404 errors
  // in the browser console.
  void supabase;
}
