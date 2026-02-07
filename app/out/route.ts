import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicUserIdByEmail } from "@/lib/db/users";

const DASHBOARD = "/dashboard";

/**
 * Safe redirect: only redirect to a URL that the current user has saved in their links.
 * Prevents open-redirect attacks (e.g. /out?url=https://evil.com).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || url.length > 2048) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url));
  }

  try {
    const dest = new URL(url);
    if (dest.protocol !== "http:" && dest.protocol !== "https:") {
      return NextResponse.redirect(new URL(DASHBOARD, request.url));
    }
  } catch {
    return NextResponse.redirect(new URL(DASHBOARD, request.url));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url));
  }

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url));
  }

  const { data: links } = await supabase
    .from("links")
    .select("urls")
    .eq("user_id", userId);

  const allowedUrls = new Set<string>();
  for (const row of links ?? []) {
    const urls = (row.urls ?? []) as string[];
    for (const u of urls) {
      if (typeof u !== "string" || !u) continue;
      try {
        allowedUrls.add(new URL(u).href);
      } catch {
        allowedUrls.add(u);
      }
    }
  }

  const normalizedRequest = new URL(url).href;
  if (!allowedUrls.has(normalizedRequest)) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url));
  }

  return NextResponse.redirect(url);
}

