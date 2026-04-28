let approvedDoctorIdsPromise: Promise<Set<string> | null> | null = null;

async function fetchApprovedDoctorIds() {
  try {
    const response = await fetch("/api/doctor-approvals", {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const payload = (await response.json().catch(() => null)) as { doctorIds?: string[] } | null;
    if (!response.ok || !payload?.doctorIds) {
      return null;
    }

    return new Set(payload.doctorIds);
  } catch {
    return null;
  }
}

export async function getApprovedDoctorIdsSet() {
  if (!approvedDoctorIdsPromise) {
    approvedDoctorIdsPromise = fetchApprovedDoctorIds().finally(() => {
      window.setTimeout(() => {
        approvedDoctorIdsPromise = null;
      }, 10_000);
    });
  }

  return approvedDoctorIdsPromise;
}

export function filterApprovedDoctors<T extends { id: string }>(
  doctors: T[],
  approvedIds: Set<string> | null
) {
  if (!approvedIds) {
    return [];
  }

  return doctors.filter((doctor) => approvedIds.has(doctor.id));
}
