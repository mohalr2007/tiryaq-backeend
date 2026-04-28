"use client";

export type SupportedLocationLanguage = "fr" | "en" | "ar";

type NominatimAddress = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  region?: string;
  postcode?: string;
  country?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
};

export type ResolvedBrowserLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  rawAddress: string | null;
};

export type ResolvedAddressLocation = {
  latitude: number;
  longitude: number;
  address: string | null;
  rawAddress: string | null;
};

const HIGH_ACCURACY_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0,
};

const FALLBACK_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 15000,
  maximumAge: 300000,
};

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function uniqueParts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    values.push(normalized);
  }

  return values;
}

export function formatNominatimAddress(result: NominatimResult | null | undefined) {
  if (!result) {
    return null;
  }

  const address = result.address ?? {};
  const street = uniqueParts([
    [address.house_number, address.road ?? address.pedestrian ?? address.footway ?? address.path]
      .filter(Boolean)
      .join(" "),
  ]);
  const locality = uniqueParts([
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.city_district,
    address.hamlet,
  ]);
  const region = uniqueParts([
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.county,
    address.postcode,
    address.state,
    address.region,
    address.country,
  ]);

  const formatted = uniqueParts([...street, ...locality, ...region]);
  if (formatted.length > 0) {
    return formatted.join(", ");
  }

  const fallback = normalizeText(result.display_name);
  return fallback || null;
}

function getCurrentPosition(options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getBestAvailablePosition() {
  let bestPosition: GeolocationPosition | null = null;
  let highAccuracyError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const position = await getCurrentPosition(HIGH_ACCURACY_OPTIONS);
      if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
        bestPosition = position;
      }

      if (position.coords.accuracy <= 120) {
        return position;
      }
    } catch (error) {
      highAccuracyError = error;
      break;
    }
  }

  if (bestPosition) {
    return bestPosition;
  }

  try {
    return await getCurrentPosition(FALLBACK_OPTIONS);
  } catch (fallbackError) {
    throw highAccuracyError ?? fallbackError;
  }
}

async function fetchNominatim<T>(url: string, language: SupportedLocationLanguage) {
  const response = await fetch(url, {
    headers: {
      "Accept-Language": language,
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  language: SupportedLocationLanguage = "fr"
) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
    addressdetails: "1",
    "accept-language": language,
  });

  const result = await fetchNominatim<NominatimResult>(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    language
  );

  return {
    address: formatNominatimAddress(result),
    rawAddress: normalizeText(result.display_name) || null,
  };
}

export async function searchAddressLocation(
  query: string,
  language: SupportedLocationLanguage = "fr"
): Promise<ResolvedAddressLocation> {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    throw new Error("Address query is empty");
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    q: normalizedQuery,
    limit: "1",
    addressdetails: "1",
    "accept-language": language,
  });

  const results = await fetchNominatim<NominatimResult[]>(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    language
  );

  const firstResult = results[0];
  if (!firstResult?.lat || !firstResult?.lon) {
    throw new Error("Address not found");
  }

  return {
    latitude: Number(firstResult.lat),
    longitude: Number(firstResult.lon),
    address: formatNominatimAddress(firstResult),
    rawAddress: normalizeText(firstResult.display_name) || null,
  };
}

export async function getBrowserLocation(
  language: SupportedLocationLanguage = "fr"
): Promise<ResolvedBrowserLocation> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    throw new Error("Geolocation is not supported");
  }

  const position = await getBestAvailablePosition();
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;

  try {
    const reverse = await reverseGeocodeCoordinates(latitude, longitude, language);
    return {
      latitude,
      longitude,
      accuracy,
      address: reverse.address,
      rawAddress: reverse.rawAddress,
    };
  } catch {
    return {
      latitude,
      longitude,
      accuracy,
      address: null,
      rawAddress: null,
    };
  }
}
