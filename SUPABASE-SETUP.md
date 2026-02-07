# Supabase auth setup (fix "Email not confirmed" and rate limits)

## 1. Disable "Confirm email" (recommended for local testing)

So you can sign in right after sign-up without clicking an email link:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **Authentication** → **Providers** → **Email**.
3. Turn **OFF** "Confirm email" (or "Enable email confirmations").
4. Save.

After this, new sign-ups can sign in immediately. You can turn it back on for production.

---

## 2. Fix your current account (so you can sign in now)

You already have a user in `auth.users` but:
- They’re unconfirmed, so sign-in says "Email not confirmed".
- They may not have a row in `public.users`.

Do **one** of the following.

### Option A: Confirm the user and backfill `public.users` (keep this account)

Run this in **SQL Editor** (replace `'your@email.com'` with the email you used to sign up):

```sql
-- Confirm the user so they can sign in
update auth.users
set email_confirmed_at = now()
where email = 'your@email.com' and email_confirmed_at is null;

-- Ensure they have a row in public.users (for dashboard/links)
insert into public.users (email, name)
select email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
from auth.users
where email = 'your@email.com'
  and email not in (select email from public.users);
```

Then sign in with that email and password.

### Option B: Delete the user and sign up again (after disabling confirm email)

1. In Supabase: **Authentication** → **Users** → find the user → **⋮** → **Delete user**.
2. In **SQL Editor**, remove their row from `public.users` if it exists:
   ```sql
   delete from public.users where email = 'your@email.com';
   ```
3. In **Authentication** → **Providers** → **Email**, turn **OFF** "Confirm email" (see step 1).
4. Wait **at least 10–15 minutes** (rate limit), then sign up again with the same or a new email.

---

## 3. "Email rate limit exceeded"

Supabase limits how many auth emails (sign-up, reset, etc.) can be sent in a short time.

- **Short term:** Wait **10–15 minutes** (or up to an hour) before signing up again with the same email.
- **Easier for testing:** Disable "Confirm email" (step 1). Then sign-up doesn’t send a confirmation email, so you avoid hitting the limit while testing.
- **Alternative:** Use a different email address to sign up (e.g. another Gmail or a test address).

---

## 4. Make sure the auth trigger is installed

So every **new** sign-up gets a row in `public.users`:

1. **SQL Editor** → New query.
2. Paste and run the full contents of **`supabase-auth-trigger.sql`** in this repo.

After that, new sign-ups will automatically get a row in `public.users`.
