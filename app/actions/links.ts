"use server";

import { createClient } from "@/lib/supabase/server";
import { getPublicUserIdByEmail } from "@/lib/db/users";

const MAX_URLS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_COMPANY_LENGTH = 200;

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function addLink(formData: FormData) {
  const rawCompany = (formData.get("company") as string) || "";
  const company =
    rawCompany.trim().slice(0, MAX_COMPANY_LENGTH) || "Unnamed";
  const urlsInput = (formData.get("urls") as string) ?? "";
  const urls = urlsInput
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return { error: "Add at least one URL." };
  }
  if (urls.length > MAX_URLS) {
    return { error: `Maximum ${MAX_URLS} URLs per link.` };
  }

  for (const u of urls) {
    if (u.length > MAX_URL_LENGTH) {
      return { error: "A URL is too long." };
    }
    if (!isValidHttpUrl(u)) {
      return { error: `Invalid URL: ${u.slice(0, 50)}${u.length > 50 ? "…" : ""}` };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const { error } = await supabase.from("links").insert({
    company,
    urls,
    user_id: userId,
  });

  if (error) return { error: error.message };
  return {};
}

export async function deleteLink(linkId: number) {
  if (!Number.isInteger(linkId) || linkId < 1) {
    return { error: "Invalid link." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const { data: link } = await supabase
    .from("links")
    .select("id")
    .eq("id", linkId)
    .eq("user_id", userId)
    .single();

  if (!link) {
    return { error: "Link not found or access denied." };
  }

  const { error } = await supabase
    .from("links")
    .delete()
    .eq("id", linkId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  return {};
}
