import { NextResponse } from "next/server";
import { clearAdminPortalSession } from "@/utils/admin-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  clearAdminPortalSession(response, request);
  return response;
}
