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

## Why do I get jobs for all links locally but only some on the deployed site?

When you run the app **locally**, requests use your home or office IP. When you run it **on Vercel**, requests use that provider's **datacenter IP**.

- **Bot blocking / different content**  
  Many job and career sites (ATS, hospital career pages, etc.) treat datacenter traffic differently: they may block it, show a captcha, or serve a minimal page with no job list. The scraper then "succeeds" but gets HTML with zero job titles.  
  Locally, the same sites often allow your IP and return the full page, so you see jobs for all 5 links. On the deployed app, some domains don't block Vercel's IP (so you get jobs for e.g. MD Anderson - MA and PCT) and others return blocked or empty pages → 0 jobs. That's the main reason you see "all 5 locally, only 2 on deployed."

- **Timeouts**  
  Each link is scraped in a separate serverless call. A single scrape can take 30–90+ seconds (page load, network idle, extraction). If the host's function timeout (e.g. 10–60s) is hit, that run is cut off and may return empty. Slower pages can show 0 jobs on the deployed app even when they work locally. You can raise the limit (e.g. `maxDuration` in Vercel) to give each scrape more time.

- **What you can do**  
  For the most reliable results across all links, run "Get monitor results" **locally**. The UI now shows every link's result (including "0 jobs") so you can see which links work on the deployed site.

### How to fix it on the deployed site

1. **Use a remote browser (recommended on Vercel)**  
   Vercel’s serverless runtime doesn’t include system libraries (e.g. `libnss3`) that Chromium needs, so running Chromium *on* Vercel fails with “libnss3.so: not found”. Use a **remote browser** so the browser runs elsewhere and the app connects over the network:
   - Sign up for [Browserless](https://www.browserless.io/) (or another Playwright-compatible CDP host).
   - Get your WebSocket URL (e.g. `wss://production-sfo.browserless.io?token=YOUR_API_TOKEN`).
   - In Vercel: Project → Settings → Environment Variables, add:
     - **Name:** `PLAYWRIGHT_REMOTE_WS_URL`  
     - **Value:** your WebSocket URL (e.g. `wss://production-sfo.browserless.io?token=...`)
   - Redeploy. Scraping will use the remote browser; no local Chromium on Vercel.

2. **Give scrapes more time**  
   The dashboard is configured with `maxDuration = 120` so each link has up to 2 minutes. On Vercel Pro you can raise this (e.g. 300) in `app/dashboard/page.tsx` if needed.

3. **Use a residential proxy (if some links still return 0 jobs)**  
   So job sites see a normal-looking IP instead of a datacenter:
   - Sign up with a provider that offers **residential** or “real user” proxies (e.g. Bright Data, Oxylabs, Smartproxy). Datacenter proxies are often blocked too.
   - Get a proxy URL (often `http://user:pass@gate.example.com:port`).
   - In Vercel: Project → Settings → Environment Variables, add:
     - **Name:** `PLAYWRIGHT_PROXY_URL`  
     - **Value:** your proxy URL (e.g. `http://user:pass@residential.example.com:8080`)
   - Redeploy. All scraping will go through the proxy, so you’ll usually get jobs for all links as on local.

   Leave `PLAYWRIGHT_PROXY_URL` unset locally if you don’t need it there.

## Security (Vercel / production)

- **Secrets:** Never commit `.env.local`. In Vercel, set env vars in Project → Settings → Environment Variables. Use only the Supabase **anon** key; RLS protects data.
- **Redirects:** "Open link" uses `/out?url=...`; redirects are allowed only to URLs the current user has saved (no open-redirect).
- **Headers:** Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP) are set in `next.config.ts`.
- **Input:** Auth and Add URLs validate and limit input; delete link checks ownership.
# Job-Monitor
