import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const envText = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const splitAt = line.indexOf("=");
      return [line.slice(0, splitAt), line.slice(splitAt + 1)];
    }),
);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are missing.");
}

const appUrl = process.env.APP_URL ?? "https://rank-your-meal-exchanges.vercel.app";
let tokenHash;
let testRowCreated = false;

const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

try {
  const before = await fetch(`${appUrl}/api/leaderboard`).then((response) => response.json());
  if (before.mode !== "live") throw new Error("Leaderboard is not in live mode.");

  const visitorResponse = await fetch(`${appUrl}/api/visitor`, { method: "POST" });
  const visitor = await visitorResponse.json();
  const setCookie = visitorResponse.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  const visitorId = cookie?.split("=", 2)[1];
  if (!visitorResponse.ok || !visitor.tracked || !cookie || !visitorId) {
    throw new Error("Production visitor tracking failed.");
  }
  tokenHash = `visitor-v1:${createHash("sha256").update(visitorId).digest("hex")}`;
  testRowCreated = true;

  const writeResponse = await fetch(`${appUrl}/api/leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      rankings: [
        { vendorId: "shake-smart", bucket: "liked", withinBucketRank: 1, computedScore: 10 },
        { vendorId: "forno-pizza-co", bucket: "liked", withinBucketRank: 2, computedScore: 6.7 },
        { vendorId: "wildcat-deli", bucket: "fine", withinBucketRank: 1, computedScore: 5 },
        { vendorId: "tech-express", bucket: "disliked", withinBucketRank: 1, computedScore: 1.7 },
      ],
      favoriteDish: { vendorId: "shake-smart", dishName: "PB Squared" },
    }),
  });
  const write = await writeResponse.json();
  if (!writeResponse.ok || write.mode !== "live") throw new Error("Live write failed.");

  const afterWrite = await fetch(`${appUrl}/api/leaderboard`).then((response) => response.json());
  const shakeSmart = afterWrite.entries.find((entry) => entry.vendorId === "shake-smart");
  if (
    afterWrite.uniqueVisitorCount !== before.uniqueVisitorCount + 1
    || afterWrite.completionCount !== before.completionCount + 1
    || shakeSmart?.favoriteDish !== "PB Squared"
  ) {
    throw new Error("Live read did not return the test ranking.");
  }

  console.log(
    `Live visitor and ranking write/read verified (${before.uniqueVisitorCount} → ${afterWrite.uniqueVisitorCount} visitors; ${before.completionCount} → ${afterWrite.completionCount} rankings).`,
  );
} finally {
  if (testRowCreated && tokenHash) {
    const cleanupResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/sessions?token_hash=eq.${tokenHash}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
    });
    if (!cleanupResponse.ok) throw new Error("Could not remove the verification row.");

    const afterCleanup = await fetch(`${appUrl}/api/leaderboard`).then((response) => response.json());
    console.log(
      `Verification visitor removed (${afterCleanup.uniqueVisitorCount} visitors and ${afterCleanup.completionCount} rankings remain).`,
    );
  }
}
