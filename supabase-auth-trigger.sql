-- Run this in Supabase SQL Editor to fix sign-up (42501).
-- When someone signs up via Auth, this trigger creates their row in public.users
-- so the app doesn't need to insert (which was failing due to RLS/session timing).

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (email, name)
  values (
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (email) do nothing;
  return new;
end;
$$;

-- Drop trigger if it exists so we can recreate it
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
