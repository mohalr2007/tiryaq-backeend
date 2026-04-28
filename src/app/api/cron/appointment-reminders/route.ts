import { NextRequest, NextResponse } from "next/server";
import {
  areAppointmentReminderEmailsEnabled,
  dispatchAppointmentReminderEmails,
} from "@/utils/appointments/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    throw new Error("CRON_SECRET n'est pas configuré. Ajoutez-le dans front/.env.local ou dans vos variables de production.");
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) {
    return true;
  }

  const querySecret = request.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

async function handleCron(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!areAppointmentReminderEmailsEnabled()) {
      return NextResponse.json(
        {
          ok: true,
          disabled: true,
          reason: "Appointment reminder emails are disabled.",
        },
        { status: 200 }
      );
    }

    const result = await dispatchAppointmentReminderEmails();
    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron appointment-reminders failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
