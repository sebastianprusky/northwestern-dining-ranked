import { NextRequest, NextResponse } from "next/server";
import { hasSupabaseConfig, supabaseFetch } from "@/lib/supabase-server";
import {
  getOrCreateVisitorId,
  isProductionTrackingRequest,
  setVisitorCookie,
  visitorTokenHash,
} from "@/lib/visitor";

export const dynamic = "force-dynamic";

const schoolId = "northwestern";

export async function POST(request: NextRequest) {
  if (!hasSupabaseConfig()) return NextResponse.json({ tracked: false, mode: "demo" });
  if (!isProductionTrackingRequest(request)) {
    return NextResponse.json({ tracked: false, mode: "non-production" });
  }

  const visitorId = getOrCreateVisitorId(request);
  const response = await supabaseFetch("sessions?on_conflict=school_id,token_hash", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      school_id: schoolId,
      token_hash: visitorTokenHash(visitorId),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Could not record visitor" }, { status: 500 });
  }

  return setVisitorCookie(NextResponse.json({ tracked: true, mode: "production" }), visitorId);
}
