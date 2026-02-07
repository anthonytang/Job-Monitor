"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrCreatePublicUser } from "@/lib/db/users";
import { redirect } from "next/navigation";

const MAX_EMAIL_LENGTH = 320;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 512;
const MAX_NAME_LENGTH = 200;

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= MAX_EMAIL_LENGTH;
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const nameInput = formData.get("name");
  const rawName = String(nameInput ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const name = rawName || email.split("@")[0];

  if (!isValidEmail(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: "Password must be at least 6 characters." };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: "Invalid request." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: name || email.split("@")[0] } },
  });

  if (error) {
    return { error: error.message };
  }

  // public.users row is created by DB trigger on auth.users; no app insert needed
  redirect("/dashboard");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!isValidEmail(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: "Invalid email or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  const signInNameInput = formData.get("name");
  const signInRawName = String(signInNameInput ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const name = signInRawName || email.split("@")[0];
  await getOrCreatePublicUser(name, email);
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
