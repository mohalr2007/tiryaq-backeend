import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAiDb } from "@/utils/supabase/ai-server-client";
import { handleCorsPreflight, withCors } from "@/utils/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const parts = [
      typeof candidate.message === "string" ? candidate.message : null,
      typeof candidate.details === "string" ? candidate.details : null,
      typeof candidate.hint === "string" ? candidate.hint : null,
      typeof candidate.code === "string" ? candidate.code : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return "Unexpected AI history error.";
}

// ── GET /api/ai-history?patient_id=xxx → load sessions list
// ── GET /api/ai-history?session_id=xxx → load full session messages
// ── POST /api/ai-history → create/update session or append message
// ── DELETE /api/ai-history?session_id=xxx → delete session

export async function GET(req: NextRequest) {
  const aiDb = getAiDb();
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patient_id");
  const sessionId = searchParams.get("session_id");

  try {
    if (!aiDb) {
      if (sessionId) {
        return withCors(NextResponse.json({ messages: [], persisted: false }), req);
      }

      if (patientId) {
        return withCors(NextResponse.json({ sessions: [], persisted: false }), req);
      }
    }

    const db = aiDb;

    if (sessionId) {
      // Load messages for a specific session
      const { data, error } = await db!
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return withCors(NextResponse.json({ messages: data ?? [] }), req);
    }

    if (patientId) {
      // Load last 20 sessions for this patient
      const { data, error } = await db!
        .from("chat_sessions")
        .select("id, title, specialty, body_zone, is_emergency, created_at, updated_at")
        .eq("patient_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return withCors(NextResponse.json({ sessions: data ?? [] }), req);
    }

    return withCors(
      NextResponse.json({ error: "Missing patient_id or session_id" }, { status: 400 }),
      req,
    );
  } catch (err) {
    return withCors(
      NextResponse.json({ error: getErrorMessage(err) }, { status: 500 }),
      req,
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const aiDb = getAiDb();
    const body = await req.json() as {
      action: "create_session" | "update_session" | "append_message";
      patient_id?: string;
      session_id?: string;
      title?: string;
      specialty?: string;
      body_zone?: string;
      is_emergency?: boolean;
      role?: "user" | "assistant";
      content?: string;
    };

    if (!aiDb) {
      if (body.action === "create_session") {
        return withCors(
          NextResponse.json({
            session_id: body.session_id ?? `local-${randomUUID()}`,
            persisted: false,
          }),
          req,
        );
      }

      if (body.action === "update_session" || body.action === "append_message") {
        return withCors(NextResponse.json({ ok: true, persisted: false }), req);
      }
    }

    const db = aiDb;

    if (body.action === "create_session") {
      const { data, error } = await db!
        .from("chat_sessions")
        .insert({
          patient_id: body.patient_id,
          title: body.title ?? "New conversation",
          specialty: body.specialty ?? null,
          body_zone: body.body_zone ?? null,
          is_emergency: body.is_emergency ?? false,
        })
        .select("id")
        .single();

      if (error) throw error;
      return withCors(NextResponse.json({ session_id: data.id }), req);
    }

    if (body.action === "update_session") {
      const updatePayload: {
        specialty?: string;
        body_zone?: string;
        is_emergency?: boolean;
        updated_at: string;
        title?: string;
      } = {
        specialty: body.specialty,
        body_zone: body.body_zone,
        is_emergency: body.is_emergency,
        updated_at: new Date().toISOString(),
      };
      if (body.title) updatePayload.title = body.title;

      const { error } = await db!
        .from("chat_sessions")
        .update(updatePayload)
        .eq("id", body.session_id);

      if (error) throw error;
      return withCors(NextResponse.json({ ok: true }), req);
    }

    if (body.action === "append_message") {
      const { error } = await db!
        .from("chat_messages")
        .insert({
          session_id: body.session_id,
          role: body.role,
          content: body.content,
        });

      // Also bump session updated_at
      await db!
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", body.session_id);

      if (error) throw error;
      return withCors(NextResponse.json({ ok: true }), req);
    }

    return withCors(NextResponse.json({ error: "Unknown action" }, { status: 400 }), req);
  } catch (err) {
    return withCors(
      NextResponse.json({ error: getErrorMessage(err) }, { status: 500 }),
      req,
    );
  }
}

export async function DELETE(req: NextRequest) {
  const aiDb = getAiDb();
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return withCors(NextResponse.json({ error: "Missing session_id" }, { status: 400 }), req);
  }

  try {
    if (!aiDb) {
      return withCors(NextResponse.json({ ok: true, persisted: false }), req);
    }

    const db = aiDb;

    const { error } = await db
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) throw error;
    return withCors(NextResponse.json({ ok: true }), req);
  } catch (err) {
    return withCors(
      NextResponse.json({ error: getErrorMessage(err) }, { status: 500 }),
      req,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request, "GET,POST,DELETE,OPTIONS");
}
