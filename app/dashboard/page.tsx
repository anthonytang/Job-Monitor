import { createClient } from "@/lib/supabase/server";
import { getPublicUserIdByEmail } from "@/lib/db/users";
import { DashboardContent } from "./DashboardContent";

// Allow long-running scrapes when "Get monitor results" runs (Vercel: up to plan limit, e.g. 300s)
export const maxDuration = 120;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const userId = await getPublicUserIdByEmail(user.email);
  const { data: links } = await supabase
    .from("links")
    .select("id, company, urls, created_at")
    .eq("user_id", userId ?? 0)
    .order("created_at", { ascending: false });

  return (
    <DashboardContent
      initialLinks={(links ?? []).map((l) => ({
        id: l.id,
        company: l.company,
        urls: (l.urls ?? []) as string[],
        created_at: l.created_at,
      }))}
    />
  );
}
