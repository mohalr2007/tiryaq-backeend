import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { AdminPortalRole, AdminPortalSession } from "@/features/admin-page/types";
import { signAdminSessionPayload } from "./security";

export const ADMIN_PORTAL_COOKIE_NAME = "tiryaq_admin_portal_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type AdminCookiePayloadInput = {
  adminUserId: string;
  username: string;
  fullName: string | null;
  role: AdminPortalRole;
};

function shouldUseSecureCookies(request?: Request) {
  if (request) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (forwardedProto) {
      return forwardedProto.includes("https");
    }

    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  return process.env.NODE_ENV === "production";
}

function encodeSession(session: AdminPortalSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = signAdminSessionPayload(payload);
  return `${payload}.${signature}`;
}

function decodeSession(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signAdminSessionPayload(payload);
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminPortalSession;
    if (!parsed?.adminUserId || !parsed.username || !parsed.role || !parsed.exp) {
      return null;
    }

    if (parsed.exp <= Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getAdminPortalSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(ADMIN_PORTAL_COOKIE_NAME)?.value);
}

export function attachAdminPortalSession(
  response: NextResponse,
  sessionUser: AdminCookiePayloadInput,
  request?: Request
) {
  const session: AdminPortalSession = {
    ...sessionUser,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };

  response.cookies.set({
    name: ADMIN_PORTAL_COOKIE_NAME,
    value: encodeSession(session),
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(request),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return session;
}

export function clearAdminPortalSession(response: NextResponse, request?: Request) {
  response.cookies.set({
    name: ADMIN_PORTAL_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(request),
    path: "/",
    expires: new Date(0),
  });
}
