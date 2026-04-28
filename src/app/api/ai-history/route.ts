import { NextRequest, NextResponse } from "next/server";
import { aiDb } from "@/utils/supabase/ai-server-client";

// ── GET /api/ai-history?patient_id=xxx → load sessions list
// ── GET /api/ai-history?session_id=xxx → load full session messages
// ── POST /api/ai-history → create/update session or append message
// ── DELETE /api/ai-history?session_id=xxx → delete session

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patient_id");
  const sessionId = searchParams.get("session_id");

  try {
    if (sessionId) {
      // Load messages for a specific session
      const { data, error } = await aiDb
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return NextResponse.json({ messages: data ?? [] });
    }

    if (patientId) {
      // Load last 20 sessions for this patient
      const { data, error } = await aiDb
        .from("chat_sessions")
        .select("id, title, specialty, body_zone, is_emergency, created_at, updated_at")
        .eq("patient_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return NextResponse.json({ sessions: data ?? [] });
    }

    return NextResponse.json({ error: "Missing patient_id or session_id" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
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

    if (body.action === "create_session") {
      const { data, error } = await aiDb
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
      return NextResponse.json({ session_id: data.id });
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

      const { error } = await aiDb
        .from("chat_sessions")
        .update(updatePayload)
        .eq("id", body.session_id);

      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "append_message") {
      const { error } = await aiDb
        .from("chat_messages")
        .insert({
          session_id: body.session_id,
          role: body.role,
          content: body.content,
        });

      // Also bump session updated_at
      await aiDb
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", body.session_id);

      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  try {
    const { error } = await aiDb
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
