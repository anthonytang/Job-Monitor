import { createClient } from "@/lib/supabase/server";

export async function getOrCreatePublicUser(name: string, email: string) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (existing) return existing.id;

  const { data: inserted, error } = await supabase
    .from("users")
    .insert({ name, email })
    .select("id")
    .single();

  if (error) throw error;
  return inserted!.id;
}

export async function getPublicUserIdByEmail(email: string): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();
  return data?.id ?? null;
}
