import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const siteDb = createAdminClient();
    
    const postReportsResult = await siteDb
      .from("community_post_reports")
      .select(
        "id, post_id, reason, status, created_at, reviewed_at, reporter:profiles!reporter_id(id, full_name), post:community_posts!post_id(id, title, doctor_id, is_hidden, content)"
      );

    const commentReportsResult = await siteDb
      .from("community_comment_reports")
      .select(
        "id, comment_id, reason, status, created_at, reviewed_at, reporter:profiles!reporter_id(id, full_name), comment:community_post_comments!comment_id(id, content, user_id, is_hidden, post_id)"
      );

    return NextResponse.json({
      postError: postReportsResult.error,
      commentError: commentReportsResult.error,
      postData: postReportsResult.data,
      commentData: commentReportsResult.data
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
