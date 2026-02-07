# JobMonitor

Monitor job search pages. Add filtered job URLs (LinkedIn, Indeed, company career pages), then run a check to see which links have new listings and view job titles.

## Setup

1. **Environment**  
   Copy `.env.example` to `.env.local` in this directory and set:
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL  
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` — your Supabase publishable/anon key  

2. **Database**  
   In Supabase you need:
   - `users` and `links` tables (as in your schema).  
   - Run the SQL in `supabase-migrations.sql` in the Supabase SQL Editor to create `scrape_results` and RLS policies (and optional `users.email` unique constraint).

3. **Auth**  
   In Supabase Dashboard → Authentication → Providers, enable **Email** and configure as you like (e.g. disable “Confirm email” for local testing).

4. **Install Playwright browsers** (for JavaScript-rendered job pages)  
   After `npm install`, run:
   ```bash
   npx playwright install chromium
   ```
   This downloads the Chromium browser (~170MB) needed for scraping JS-heavy sites.

5. **Run**  
   From this directory:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Flow

- **Hero** → Sign up / Sign in (email + password).  
- **Dashboard** → Add job page URLs (one per line or comma-separated; optional label).  
- **Get monitor results** → Scrapes all saved URLs, compares with the previous run, and shows links that have new jobs.  
- For each such link you can open **More info** (job titles) and **Open link** (navigate to the page).

**Scraping:** Uses Playwright (headless Chromium) to render JavaScript-heavy pages, then extracts job titles using common HTML patterns. Falls back to simple fetch for static pages. Results depend on each site’s HTML structure—some sites may need custom selectors.

## Security (Vercel / production)

- **Secrets:** Never commit `.env.local`. In Vercel, set env vars in Project → Settings → Environment Variables. Use only the Supabase **anon** key; RLS protects data.
- **Redirects:** "Open link" uses `/out?url=...`; redirects are allowed only to URLs the current user has saved (no open-redirect).
- **Headers:** Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP) are set in `next.config.ts`.
- **Input:** Auth and Add URLs validate and limit input; delete link checks ownership.
# Job-Monitor
