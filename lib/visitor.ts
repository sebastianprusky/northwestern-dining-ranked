import { createHash, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { SITE_HOSTNAME } from "@/lib/site";

export const visitorCookieName = "ryme-visitor-id";
export const visitorTokenPrefix = "visitor-v1:";

const visitorCookieMaxAge = 60 * 60 * 24 * 365 * 2;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProductionTrackingRequest(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostname = (forwardedHost ?? request.nextUrl.hostname).split(":")[0].toLowerCase();
  return process.env.VERCEL_ENV === "production" && hostname === SITE_HOSTNAME;
}

export function getOrCreateVisitorId(request: NextRequest) {
  const existing = request.cookies.get(visitorCookieName)?.value;
  if (existing && uuidPattern.test(existing)) return existing;
  return randomUUID();
}

export function visitorTokenHash(visitorId: string) {
  return `${visitorTokenPrefix}${createHash("sha256").update(visitorId).digest("hex")}`;
}

export function setVisitorCookie(response: NextResponse, visitorId: string) {
  response.cookies.set(visitorCookieName, visitorId, {
    httpOnly: true,
    maxAge: visitorCookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  return response;
}
