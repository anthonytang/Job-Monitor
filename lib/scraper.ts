import * as cheerio from "cheerio";
import { chromium, type Page } from "playwright";
import type { JobRecord } from "@/lib/db/types";

/** Phrases/substrings to exclude (nav, footer, buttons, categories, cookie text) */
const BLOCKLIST = [
  "opens in a new tab",
  "search jobs",
  "already applied",
  "current employee",
  "be more at",
  "view details and apply", // button text, not job title
  "here",
  "job id:",
  "employment type:",
  "location:",
  "back to",
  "sign in",
  "create account",
  "careers home",
  "job search",
  "benefits",
  "about us",
  "filter results",
  "open jobs",
  "talent community",
  "we use cookies",
  "cookie list",
  "digital privacy policy",
  "disclaimer",
  "terms of use",
  "accept our",
  "give you the best website",
  "by using our site",
  "technician jobs at",
  "jobs at houston methodist at",
  "about technician jobs",
  "create your candidate profile",
];

// Cache origins where /Search/SearchResults is confirmed to work.
// Best-effort only (may not persist in serverless).
const KNOWN_SEARCH_RESULTS_ORIGINS = new Set<string>();

function stripHtml(input: string): string {
  const s = input.trim();
  if (!s) return s;
  // If it looks like HTML, use cheerio to decode/strip tags.
  if (s.includes("<") && s.includes(">")) {
    const $ = cheerio.load(s);
    return $.root().text().trim().replace(/\s+/g, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function isBlocklisted(text: string): boolean {
  const lower = text.toLowerCase().trim().replace(/^[\s•·\-*]+\s*|\s*[\s•·\-*]+$/g, "").trim();
  // Block exact match, or phrase at start/end
  if (BLOCKLIST.some((b) => lower === b || lower.startsWith(b + " ") || lower.endsWith(" " + b))) return true;
  // Block if text contains any of these longer phrases (cookie/nav text, not substrings of real job titles)
  const containsBlocklist = [
    "we use cookies",
    "digital privacy policy",
    "terms of use",
    "by using our site",
    "give you the best website",
    "cookie list",
  ];
  if (containsBlocklist.some((b) => lower.includes(b))) return true;
  // Block page/category title pattern: "X Jobs at Y at Z" (e.g. "Technician Jobs at Houston Methodist at Houston Methodist Hospital")
  if (/\bjobs\s+at\s+/.test(lower) && (lower.match(/\s+at\s+/g)?.length ?? 0) >= 2) return true;
  // Reject very short single words that are clearly nav (but allow longer ones like "Nurse")
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1 && text.length < 4) return true;
  return false;
}

function looksLikeJobTitle(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 250) return false;
  
  const words = t.split(/\s+/).filter(Boolean);
  
  // Single word: must be at least 4 chars and not blocklisted (allows "Nurse", "Engineer", etc.)
  if (words.length === 1) {
    if (t.length < 4) return false; // too short
    if (isBlocklisted(t)) return false;
    return true;
  }
  
  // Multiple words: at least 8 chars total (allows "Nurse Manager", "Data Engineer", etc.)
  if (words.length >= 2) {
    if (t.length < 8) return false; // too short for multi-word
    if (isBlocklisted(t)) return false;
    return true;
  }
  
  return false;
}

/** Oracle ADF recruitingCEJobRequisitions: items[0] is finder; actual jobs in items[0].requisitionList[] */
function extractOracleAdfRequisitionTitles(
  data: unknown,
  out: string[],
  depth = 0,
  outJobs?: JobRecord[]
): void {
  if (depth > 5 || data == null || typeof data !== "object") return;
  const obj = data as Record<string, unknown>;

  const pushTitle = (rec: Record<string, unknown>) => {
    const title =
      (typeof rec.RequisitionTitle === "string" && rec.RequisitionTitle) ||
      (typeof rec.requisitionTitle === "string" && rec.requisitionTitle) ||
      (typeof rec.title === "string" && rec.title) ||
      (typeof rec.Title === "string" && rec.Title) ||
      (typeof rec.JobTitle === "string" && rec.JobTitle) ||
      (typeof rec.jobTitle === "string" && rec.jobTitle) ||
      (rec.Information != null && typeof rec.Information === "object" && typeof (rec.Information as Record<string, unknown>).RequisitionTitle === "string" && (rec.Information as Record<string, unknown>).RequisitionTitle);
    if (title && typeof title === "string" && title.length >= 2 && title.length <= 300) {
      out.push(title);
      const id =
        (typeof rec.RequisitionId === "string" && rec.RequisitionId) ||
        (typeof rec.requisitionId === "string" && rec.requisitionId) ||
        (typeof rec.Id === "string" && rec.Id) ||
        (typeof rec.id === "string" && rec.id) ||
        undefined;
      if (outJobs) outJobs.push(id ? { title, id } : { title });
    }
  };

  // Top-level items array (first item is often finder/search; jobs in items[0].requisitionList or items[1..n])
  const items = Array.isArray(obj.items) ? obj.items : null;
  if (items) {
    for (const item of items) {
      if (item == null || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      pushTitle(rec);
      // Nested requisitionList (Oracle returns finder in items[0], jobs in items[0].requisitionList or items[0].requisitionList.items)
      const reqList =
        rec.requisitionList ?? rec.RequisitionList ?? rec.requisitions ?? rec.results;
      if (Array.isArray(reqList)) {
        for (const req of reqList) {
          if (req != null && typeof req === "object") {
            pushTitle(req as Record<string, unknown>);
            extractOracleAdfRequisitionTitles(req, out, depth + 1, outJobs);
          }
        }
      } else if (reqList != null && typeof reqList === "object") {
        const r = reqList as Record<string, unknown>;
        // Oracle ADF often wraps the array: requisitionList = { items: [ { RequisitionTitle: "..." }, ... ] }
        const inner = Array.isArray(r.items) ? r.items : (Array.isArray(r.requisitionList) ? r.requisitionList : null);
        if (inner) {
          for (const req of inner) {
            if (req != null && typeof req === "object") pushTitle(req as Record<string, unknown>);
          }
        } else {
          extractOracleAdfRequisitionTitles(reqList, out, depth + 1, outJobs);
        }
      }
      // Fallback: any array property on this item might hold requisitions (e.g. different casing)
      for (const [key, value] of Object.entries(rec)) {
        if (key === "requisitionList" || key === "RequisitionList" || key === "requisitions" || key === "results") continue;
        if (Array.isArray(value) && value.length > 0 && value[0] != null && typeof value[0] === "object") {
          const first = value[0] as Record<string, unknown>;
          if ("RequisitionTitle" in first || "requisitionTitle" in first || "title" in first || "JobTitle" in first) {
            for (const req of value) {
              if (req != null && typeof req === "object") pushTitle(req as Record<string, unknown>);
            }
          }
        }
      }
    }
    return;
  }

  const reqListTop =
    (Array.isArray(obj.requisitionList) && obj.requisitionList) ||
    (Array.isArray(obj.RequisitionList) && obj.RequisitionList);
  if (reqListTop) {
    for (const req of reqListTop) {
      if (req != null && typeof req === "object") pushTitle(req as Record<string, unknown>);
    }
    return;
  }

  if (typeof obj.RequisitionTitle === "string" || typeof obj.requisitionTitle === "string") {
    pushTitle(obj);
  }
  for (const value of Object.values(obj)) {
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      extractOracleAdfRequisitionTitles(value, out, depth + 1, outJobs);
    } else if (Array.isArray(value)) {
      for (const elem of value) {
        if (elem != null && typeof elem === "object") {
          extractOracleAdfRequisitionTitles(elem, out, depth + 1, outJobs);
        }
      }
    }
  }
}

function collectJsonTitles(input: unknown, out: string[]) {
  const MAX_OUT = 200;
  const MAX_DEPTH = 8;
  const seen = new Set<unknown>();

  function walk(node: unknown, depth: number) {
    if (out.length >= MAX_OUT) return;
    if (depth > MAX_DEPTH) return;
    if (node == null) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    const title =
      (typeof obj.jobTitle === "string" && obj.jobTitle) ||
      (typeof obj.title === "string" && obj.title) ||
      (typeof obj.positionTitle === "string" && obj.positionTitle) ||
      (typeof obj.position_title === "string" && obj.position_title) ||
      (typeof obj.jobOpeningTitle === "string" && obj.jobOpeningTitle) ||
      (typeof obj.JobTitle === "string" && obj.JobTitle) ||
      (typeof obj.Position === "string" && obj.Position) ||
      (typeof obj.JobOpeningTitle === "string" && obj.JobOpeningTitle) ||
      (typeof obj.jobRequisitionTitle === "string" && obj.jobRequisitionTitle) ||
      (typeof obj.JobRequisitionTitle === "string" && obj.JobRequisitionTitle) ||
      (typeof obj.RequisitionTitle === "string" && obj.RequisitionTitle) ||
      (typeof obj.requisitionTitle === "string" && obj.requisitionTitle) ||
      (typeof obj.name === "string" && obj.name && obj.name.length >= 6 && obj.name.length <= 120);

    const jobId =
      (typeof obj.jobId === "number" && obj.jobId) ||
      (typeof obj.job_id === "number" && obj.job_id) ||
      (typeof obj.requisitionId === "number" && obj.requisitionId) ||
      (typeof obj.requisition_id === "number" && obj.requisition_id) ||
      (typeof obj.JobOpeningId === "number" && obj.JobOpeningId) ||
      (typeof obj.JobOpeningId === "string" && /^\d+$/.test(String(obj.JobOpeningId))) ||
      (typeof obj.id === "number" && obj.id);

    // If it looks like a job record, collect its title. For "name" require job-like context.
    const hasJobSignal =
      jobId ||
      /\b\d{5,7}\b/.test(JSON.stringify(obj).slice(0, 5000)) ||
      (typeof obj.location === "string" && obj.location.length > 2) ||
      (typeof obj.JobOpeningId === "string" && /^\d+$/.test(String(obj.JobOpeningId)));
    if (title && hasJobSignal) {
      out.push(String(title));
    }

    for (const v of Object.values(obj)) walk(v, depth + 1);
  }

  walk(input, 0);
}

async function tryDirectSearchResultsApi(
  url: string
): Promise<{ titles: string[]; debug?: Partial<ScrapeDebug> } | null> {
  try {
    const u = new URL(url);
    // Many Activate/TalentEgy-hosted job sites use:
    //   <origin>/Search/SearchResults?...&jtStartIndex=0&jtPageSize=...
    // Their search pages usually look like:
    //   <origin>/search/searchjobs?...
    if (u.pathname.toLowerCase().includes("/search/searchjobs")) {
      const origin = u.origin;
      const api = new URL("/Search/SearchResults", origin);
      // copy query params from the search page URL
      u.searchParams.forEach((v, k) => api.searchParams.set(k, v));
      api.searchParams.set("jtStartIndex", "0");
      api.searchParams.set("jtPageSize", "50");

      const res = await fetch(api.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
        },
        cache: "no-store",
      });

      if (!res.ok) return null;

      const data = (await res.json()) as {
        Records?: Array<{ Title?: string }>;
      };
      const titles = cleanAndFilterTitles((data.Records ?? []).map((r) => r.Title ?? ""));
      if (titles.length > 0) KNOWN_SEARCH_RESULTS_ORIGINS.add(origin);
      return {
        titles,
        debug: { blockedHint: titles.length ? "direct_api: SearchResults" : "direct_api_empty" },
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function extractTitlesFromHtml(html: string): string[] {
  const titles: string[] = [];
  const $ = cheerio.load(html);

  // Prefer selectors inside job cards / listing blocks, then headings
  const jobSelectors = [
    '[class*="job-title"]',
    '[class*="job_title"]',
    '[class*="position-title"]',
    '[class*="listing-title"]',
    '[class*="opening-title"]',
    '[class*="role-title"]',
    '[data-job-title]',
    '[class*="job-card"] h2',
    '[class*="job-card"] h3',
    '[class*="job-card"] h4',
    '[class*="job-card"] [class*="title"]',
    '[class*="job-card"] a', // links inside job cards often have the title
    '[class*="position-card"] h2',
    '[class*="position-card"] h3',
    '[class*="listing-card"] h2',
    '[class*="listing-card"] h3',
    '[class*="job-listing"] h2',
    '[class*="job-listing"] h3',
    '[class*="job"] h2',
    '[class*="job"] h3',
    '[class*="position"] h2',
    '[class*="position"] h3',
    "article h2",
    "article h3",
    "main h2",
    "main h3",
    // Look for common patterns: headings that are likely job titles
    'h2:not([class*="nav"]):not([class*="menu"]):not([class*="header"])',
    'h3:not([class*="nav"]):not([class*="menu"]):not([class*="header"])',
  ];

  for (const sel of jobSelectors) {
    $(sel).each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (looksLikeJobTitle(text)) titles.push(text);
    });
  }

  // Links that look like job detail links (often have the title as text)
  // Prefer singular /job/123/... (detail page) over /jobs/category/... (category page)
  // Skip links inside featured/recommended/etc. section to avoid duplicates
  $('a[href*="/job/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.includes("/jobs/")) return; // category link, not job detail
    if ($(el).closest("[class*='featured'], [id*='featured'], [class*='recommended'], [class*='highlighted'], [class*='spotlight'], [class*='similar-jobs'], [class*='related-jobs'], [aria-label*='featured'], [aria-label*='Featured']").length > 0) return;
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (looksLikeJobTitle(text)) titles.push(text);
  });
  $('a[href*="/jobs/"], a[href*="/position/"], a[href*="/openings/"]').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (looksLikeJobTitle(text)) titles.push(text);
  });

  return titles;
}

/** Clean and filter titles (no deduplication - keep all occurrences). */
function cleanAndFilterTitles(titles: string[]): string[] {
  const out: string[] = [];
  for (const t of titles) {
    const cleaned = stripHtml(t);
    if (!cleaned) continue;
    if (!looksLikeJobTitle(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

async function extractTitlesWithPlaywright(page: Page) {
  // Heuristic: on many ATS pages, each job card has an "Apply" / "View Details" CTA.
  // We anchor on those CTAs and grab the nearest heading-like text within the card.
  const titles = await page.evaluate(() => {
    const CTA_REGEX = /(view\s+details\s+and\s+apply|view\s+details|apply\s+now|apply)/i;
    const BAD_REGEX =
      /(opens in a new tab|already applied|current employee|search jobs|job id|employment type|location|filter results|open jobs|talent community|about us|we use cookies|cookie|privacy policy|terms of use|disclaimer|jobs\s+at\s+.+\s+at\s+|technician jobs at|create your candidate profile)/i;
    function isInsideExcludedSection(el: Element | null): boolean {
      let n: Element | null = el;
      for (let i = 0; i < 20 && n; i++) {
        const c = (n as HTMLElement).className?.toString?.() ?? "";
        const id = (n as HTMLElement).id ?? "";
        const aria = (n.getAttribute?.("aria-label") ?? "") + (n.getAttribute?.("aria-labelledby") ?? "");
        const combined = c + " " + id + " " + aria;
        if (/featured|recommended|highlighted|spotlight|similar-jobs|related-jobs/i.test(combined)) return true;
        n = n.parentElement;
      }
      return false;
    }

    const headingSelectors = [
      "h1",
      "h2",
      "h3",
      "h4",
      "[role='heading']",
      "[class*='title']",
      "[class*='job-title']",
      "[class*='job_title']",
      "[data-job-title]",
    ];

    function textOf(el: Element | null | undefined) {
      if (!el) return "";
      return (el as HTMLElement).innerText?.trim?.() ?? "";
    }

    function scoreAsJobCard(card: Element): number {
      const raw = (card as HTMLElement).innerText || "";
      let score = 0;
      if (CTA_REGEX.test(raw)) score += 2;
      if (/\b\d{5,7}\b/.test(raw)) score += 2; // job id-like numbers in screenshot
      if (/(houston|tx|full[-\s]?time|part[-\s]?time)/i.test(raw)) score += 1;
      if (raw.length > 100 && raw.length < 2000) score += 1;
      return score;
    }

    function findTitleInCard(card: Element): string | null {
      // Gather all heading candidates and pick the best-looking one (avoid grabbing a page section header)
      const candidates: string[] = [];
      for (const sel of headingSelectors) {
        card.querySelectorAll(sel).forEach((el) => {
          const t = textOf(el).replace(/\s+/g, " ").trim();
          if (t && !BAD_REGEX.test(t) && t.length >= 4 && t.length <= 250) candidates.push(t);
        });
      }
      // Prefer longer, job-title-ish strings
      candidates.sort((a, b) => b.length - a.length);
      if (candidates.length) return candidates[0]!;

      // Fallback: pick the first non-metadata line near the top of the card
      const raw = (card as HTMLElement).innerText || "";
      const lines = raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !CTA_REGEX.test(s))
        .filter((s) => !BAD_REGEX.test(s))
        .filter((s) => !/^\d{3,}$/.test(s))
        .filter((s) => !/(full[-\s]?time|part[-\s]?time)/i.test(s))
        .filter((s) => s.length >= 4 && s.length <= 250);

      return lines[0] ?? null;
    }

    // Prefer job-detail links only (e.g. Houston Methodist): one title per link, no double-count with CTA cards
    const linkTitles: string[] = [];
    document.querySelectorAll('a[href*="/job/"]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href || "";
      if (href.includes("/jobs/")) return;
      if (isInsideExcludedSection(a)) return;
      const t = textOf(a).replace(/\s+/g, " ").trim();
      if (t && !BAD_REGEX.test(t) && t.length >= 4 && t.length <= 250) linkTitles.push(t);
    });
    if (linkTitles.length > 0) return linkTitles;

    // Fallback: CTA-based card extraction
    const ctas = Array.from(document.querySelectorAll("a,button,input[type='submit']"));
    const found: string[] = [];
    for (const cta of ctas) {
      const label =
        (cta instanceof HTMLInputElement ? cta.value : (cta as HTMLElement).innerText) || "";
      const text = label.trim();
      if (!text) continue;
      if (!CTA_REGEX.test(text)) continue;
      let node: Element | null = cta;
      let best: { el: Element; score: number } | null = null;
      for (let i = 0; i < 10 && node; i++) {
        const score = scoreAsJobCard(node);
        if (!best || score > best.score) best = { el: node, score };
        node = node.parentElement;
      }
      if (best && best.score >= 3 && !isInsideExcludedSection(best.el)) {
        const title = findTitleInCard(best.el);
        if (title) found.push(title);
      }
    }
    return found;
  });

  return cleanAndFilterTitles(titles);
}

function detectBlocked(content: string): string | null {
  const lower = content.toLowerCase();
  if (lower.includes("access denied") || lower.includes("request blocked")) return "access_denied";
  if (lower.includes("captcha") || lower.includes("are you human")) return "captcha";
  if (lower.includes("robot") || lower.includes("automated")) return "bot_check";
  return null;
}

async function tryClickConsent(page: Page) {
  const candidates = [/accept all/i, /accept/i, /i agree/i, /agree/i, /ok/i, /got it/i];
  for (const re of candidates) {
    const loc = page.getByRole("button", { name: re }).first();
    try {
      if (await loc.isVisible({ timeout: 800 })) {
        await loc.click({ timeout: 1500 });
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // ignore
    }
  }
}

async function countCtasInAllFrames(page: Page): Promise<number> {
  const CTA_REGEX = /(view\s+details\s+and\s+apply|view\s+details|apply\s+now|apply)/i;
  let count = 0;
  for (const frame of page.frames()) {
    try {
      count += await frame.evaluate((reSource) => {
        const re = new RegExp(reSource, "i");
        const els = Array.from(document.querySelectorAll("a,button,input[type='submit']"));
        return els.filter((el) => {
          const label =
            el instanceof HTMLInputElement ? el.value : (el as HTMLElement).innerText;
          return !!label && re.test(label.trim());
        }).length;
      }, CTA_REGEX.source);
    } catch {
      // ignore cross-origin frames
    }
  }
  return count;
}

async function extractTitlesFromAllFrames(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const frame of page.frames()) {
    try {
      const titles = await frame.evaluate(() => {
        const CTA_REGEX = /(view\s+details\s+and\s+apply|view\s+details|apply\s+now|apply)/i;
        const BAD_REGEX =
          /(opens in a new tab|already applied|current employee|search jobs|job id|employment type|location|filter results|open jobs|talent community|about us|we use cookies|cookie|privacy policy|terms of use|disclaimer|jobs\s+at\s+.+\s+at\s+|technician jobs at|create your candidate profile)/i;
        function isInsideExcludedSection(el: Element | null): boolean {
          let n: Element | null = el;
          for (let i = 0; i < 20 && n; i++) {
            const c = (n as HTMLElement).className?.toString?.() ?? "";
            const id = (n as HTMLElement).id ?? "";
            const aria = (n.getAttribute?.("aria-label") ?? "") + (n.getAttribute?.("aria-labelledby") ?? "");
            const combined = c + " " + id + " " + aria;
            if (/featured|recommended|highlighted|spotlight|similar-jobs|related-jobs/i.test(combined)) return true;
            n = n.parentElement;
          }
          return false;
        }

        const headingSelectors = [
          "h1",
          "h2",
          "h3",
          "h4",
          "[role='heading']",
          "[class*='title']",
          "[class*='job-title']",
          "[class*='job_title']",
          "[data-job-title]",
        ];

        function textOf(el: Element | null | undefined) {
          if (!el) return "";
          return (el as HTMLElement).innerText?.trim?.() ?? "";
        }

        function scoreAsJobCard(card: Element): number {
          const raw = (card as HTMLElement).innerText || "";
          let score = 0;
          if (CTA_REGEX.test(raw)) score += 2;
          if (/\b\d{5,7}\b/.test(raw)) score += 2;
          if (/(houston|tx|full[-\s]?time|part[-\s]?time)/i.test(raw)) score += 1;
          if (raw.length > 100 && raw.length < 2000) score += 1;
          return score;
        }

        function findTitleInCard(card: Element): string | null {
          const candidates: string[] = [];
          for (const sel of headingSelectors) {
            card.querySelectorAll(sel).forEach((el) => {
              const t = textOf(el).replace(/\s+/g, " ").trim();
              if (t && !BAD_REGEX.test(t) && t.length >= 4 && t.length <= 250) candidates.push(t);
            });
          }
          candidates.sort((a, b) => b.length - a.length);
          if (candidates.length) return candidates[0]!;

          const raw = (card as HTMLElement).innerText || "";
          const lines = raw
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((s) => !CTA_REGEX.test(s))
            .filter((s) => !BAD_REGEX.test(s))
            .filter((s) => !/^\d{3,}$/.test(s))
            .filter((s) => !/(full[-\s]?time|part[-\s]?time)/i.test(s))
            .filter((s) => s.length >= 4 && s.length <= 250);

          return lines[0] ?? null;
        }

        const linkTitles: string[] = [];
        document.querySelectorAll('a[href*="/job/"]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href || "";
          if (href.includes("/jobs/")) return;
          if (isInsideExcludedSection(a)) return;
          const t = textOf(a).replace(/\s+/g, " ").trim();
          if (t && !BAD_REGEX.test(t) && t.length >= 4 && t.length <= 250) linkTitles.push(t);
        });
        if (linkTitles.length > 0) return linkTitles;

        const ctas = Array.from(document.querySelectorAll("a,button,input[type='submit']"));
        const found: string[] = [];
        for (const cta of ctas) {
          const label =
            (cta instanceof HTMLInputElement ? cta.value : (cta as HTMLElement).innerText) || "";
          const text = label.trim();
          if (!text) continue;
          if (!CTA_REGEX.test(text)) continue;
          let node: Element | null = cta;
          let best: { el: Element; score: number } | null = null;
          for (let i = 0; i < 10 && node; i++) {
            const score = scoreAsJobCard(node);
            if (!best || score > best.score) best = { el: node, score };
            node = node.parentElement;
          }
          if (best && best.score >= 3 && !isInsideExcludedSection(best.el)) {
            const title = findTitleInCard(best.el);
            if (title) found.push(title);
          }
        }
        return found;
      });
      out.push(...titles);
    } catch {
      // ignore cross-origin frames
    }
  }
  return cleanAndFilterTitles(out);
}

/** Oracle HCM Candidate Experience: job list in data attributes, table rows, or link structure. Runs in main page and all frames. */
async function extractOracleTitlesFromPage(page: Page): Promise<string[]> {
  const BAD =
    /(filter results|open jobs|talent community|search jobs|sign in|create account|job id|location|employment type|view details|apply now|create your candidate profile)/i;
  const allTitles: string[] = [];

  const titlesMain = await page.evaluate((badSource: string) => {
    const bad = new RegExp(badSource, "i");
    const out: string[] = [];
    const textOf = (el: Element) => (el as HTMLElement).innerText?.trim?.() ?? "";
    const add = (t: string) => {
      const s = t.replace(/\s+/g, " ").trim();
      if (s && !bad.test(s) && s.length >= 4 && s.length <= 200) out.push(s);
    };
    "[data-automation-id*='job'],[data-automation-id*='Job'],[class*='JobCard'],[class*='job-card'],[class*='searchResult'],[class*='SearchResult']".split(",").forEach((sel) => {
      document.querySelectorAll(sel.trim()).forEach((card) => {
        card.querySelectorAll("h1,h2,h3,h4,[role='heading'],a").forEach((el) => add(textOf(el)));
      });
    });
    document.querySelectorAll("a[href*='JobOpening'],a[href*='jobOpening'],a[href*='JobOpeningId'],a[href*='/job/']").forEach((a) => {
      const href = (a as HTMLAnchorElement).href || "";
      if (!href.includes("/jobs/")) add(textOf(a));
    });
    document.querySelectorAll("tr[role='row'], table tbody tr").forEach((row) => {
      const first = row.querySelector("td, [role='cell']");
      if (first) add(textOf(first));
      const link = row.querySelector("a[href*='job'], a[href*='Job']");
      if (link) add(textOf(link));
    });
    document.querySelectorAll("li").forEach((li) => {
      const link = li.querySelector("a[href*='job'], a[href*='Job'], a[href*='JobOpening']");
      if (link) add(textOf(link));
      const head = li.querySelector("h2,h3,h4,strong");
      if (head) add(textOf(head));
    });
    document.querySelectorAll("a[href*='job'], a[href*='Job']").forEach((a) => {
      const href = (a as HTMLAnchorElement).href || "";
      if (!href.includes("/jobs/") && (!href.includes("search") || href.includes("JobOpening"))) add(textOf(a));
    });
    return out;
  }, BAD.source);
  allTitles.push(...titlesMain);

  // All frames (Oracle may render job list in an iframe)
  for (const frame of page.frames()) {
    try {
      const frameTitles = await frame.evaluate((badSource: string) => {
        const bad = new RegExp(badSource, "i");
        const out: string[] = [];
        const textOf = (el: Element) => (el as HTMLElement).innerText?.trim?.() ?? "";
        const add = (t: string) => {
          const s = t.replace(/\s+/g, " ").trim();
          if (s && !bad.test(s) && s.length >= 4 && s.length <= 200) out.push(s);
        };
        document.querySelectorAll("[data-automation-id*='job'],[class*='JobCard'],[class*='searchResult']").forEach((card) => {
          card.querySelectorAll("h1,h2,h3,h4,a").forEach((el) => add(textOf(el)));
        });
        document.querySelectorAll("a[href*='JobOpening'],a[href*='/job/']").forEach((a) => {
          if (!(a as HTMLAnchorElement).href.includes("/jobs/")) add(textOf(a));
        });
        document.querySelectorAll("tr").forEach((row) => {
          const link = row.querySelector("a");
          if (link) add(textOf(link));
        });
        document.querySelectorAll("li a").forEach((a) => add(textOf(a)));
        return out;
      }, BAD.source);
      allTitles.push(...frameTitles);
    } catch {
      // ignore cross-origin
    }
  }

  return cleanAndFilterTitles(allTitles);
}

export type ScrapeDebug = {
  finalUrl?: string;
  pageTitle?: string;
  frameCount?: number;
  ctaCount?: number;
  blockedHint?: string | null;
  frameStats?: {
    url: string;
    ctas: number;
    sampleHeadings: string[];
    error?: string;
  }[];
  responsesScanned?: number;
  responseSamples?: { url: string; contentType: string }[];
  relevantResponses?: { url: string; contentType: string }[];
  /** Debug log messages (shown in UI and printed to server console) */
  debugMessages?: string[];
};

export async function scrapeJobTitlesFromUrlDetailed(
  url: string
): Promise<{ titles: string[]; jobs: JobRecord[]; debug: ScrapeDebug }> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const debug: ScrapeDebug = { debugMessages: [] };
  const log = (msg: string) => {
    debug.debugMessages = debug.debugMessages ?? [];
    debug.debugMessages.push(msg);
    console.log(`[scraper] ${msg}`);
  };

  try {
    log(`Starting scrape: ${url}`);

    // Fast-path for known job-search endpoints that have a JSON results API
    const direct = await tryDirectSearchResultsApi(url);
    if (direct) {
      log(`Direct API returned ${direct.titles.length} titles`);
      const jobs: JobRecord[] = direct.titles.map((t) => ({ title: t }));
      return { titles: direct.titles, jobs, debug: { ...debug, ...direct.debug } };
    }

    log("Launching browser");
    // On Vercel (and similar serverless), the Playwright-installed browser isn't available at runtime.
    // Use @sparticuz/chromium, which bundles a serverless-compatible Chromium.
    const useServerlessChromium =
      process.env.VERCEL === "1" || process.env.USE_SERVERLESS_CHROMIUM === "1";
    if (useServerlessChromium) {
      const sparticuz = await import("@sparticuz/chromium");
      const executablePath = await sparticuz.default.executablePath();
      log(`Using serverless Chromium: ${executablePath}`);
      browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          ...sparticuz.default.args,
          "--disable-blink-features=AutomationControlled",
        ],
      });
    } else {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      });
    }

    // Optional: use a proxy (e.g. residential) so job sites don't block datacenter IPs (Vercel).
    const proxyUrl =
      process.env.PLAYWRIGHT_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    let proxy: { server: string; username?: string; password?: string } | undefined;
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        proxy = { server: `${u.protocol}//${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}` };
        if (u.username) proxy.username = decodeURIComponent(u.username);
        if (u.password) proxy.password = decodeURIComponent(u.password);
        log(`Using proxy: ${proxy.server}`);
      } catch {
        log(`Invalid proxy URL, skipping proxy`);
      }
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      ...(proxy && { proxy }),
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();

    // Capture job titles and structured job records from JSON/XHR (e.g. Oracle RequisitionId)
    const xhrTitles: string[] = [];
    const xhrJobs: JobRecord[] = [];
    let responsesScanned = 0;
    const responseSamples: { url: string; contentType: string }[] = [];
    const relevantResponses: { url: string; contentType: string }[] = [];
    const relevantSeen = new Set<string>();

    const extractTitlesFromTextPattern = (text: string) => {
      // Pattern seen in many ATS UIs: Title, then a 5-7 digit req id, then Full-Time/Part-Time, then location
      // Example:
      // Respiratory Therapist
      // 178687
      // Full-Time
      // Houston, TX
      const found: string[] = [];
      const re =
        /([A-Z][^\n]{4,200})\s*\n\s*(\d{5,7})\s*\n\s*(Full[-\s]?Time|Part[-\s]?Time)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        found.push(m[1]!.trim());
        if (found.length >= 50) break;
      }
      return found;
    };

    page.on("response", async (res) => {
      try {
        const ct = res.headers()["content-type"] ?? "";
        const resUrl = res.url();

        // Keep a small sample for debugging (first requests)
        if (responseSamples.length < 12) responseSamples.push({ url: resUrl, contentType: ct });

        // Only inspect likely relevant responses (including Oracle HCM recruitingCEJobRequisitions)
        const looksRelevant =
          /search|job|jobs|requisition|posting|career|opening|ats|api|ajax|graphql|hcmUI|CandidateExperience|oraclecloud|recruitingCEJobRequisitions|hcmRestApi/i.test(
            resUrl
          );
        if (!looksRelevant) return;

        responsesScanned++;

        // Track relevant endpoints separately (deduped)
        if (!relevantSeen.has(resUrl)) {
          relevantSeen.add(resUrl);
          relevantResponses.push({ url: resUrl, contentType: ct });
          // cap for UI
          if (relevantResponses.length > 40) relevantResponses.shift();
        }

        // Parse JSON (including Oracle ADF: application/vnd.oracle.adf.resourcecollection+json)
        if (ct.includes("application/json") || ct.includes("+json") || ct.includes("/json")) {
          try {
            const data = await res.json();
            const beforeCount = xhrTitles.length;
            collectJsonTitles(data, xhrTitles);
            // Oracle HCM recruitingCEJobRequisitions: items may be in items[] or requisitionList[]
            if (/recruitingCEJobRequisitions/i.test(resUrl)) {
              extractOracleAdfRequisitionTitles(data, xhrTitles, 0, xhrJobs);
              const afterCount = xhrTitles.length;
              if (afterCount > beforeCount) {
                log(`Oracle ADF: extracted ${afterCount - beforeCount} titles from recruitingCEJobRequisitions`);
              } else {
                const d = data as Record<string, unknown>;
                const items = Array.isArray(d?.items) ? d.items : null;
                const firstItemKeys = items?.length && typeof items[0] === "object" && items[0] != null
                  ? Object.keys(items[0] as object).join(", ")
                  : "";
                log(`Oracle ADF: no titles. items.length=${items?.length ?? 0}, items[0] keys: ${firstItemKeys || "(none)"}`);
              }
            }
          } catch (e) {
            if (/recruitingCEJobRequisitions/i.test(resUrl)) {
              log(`Oracle ADF: failed to parse recruitingCEJobRequisitions: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          return;
        }

        // Some sites return job data as text/html or text/plain fragments
        if (ct.includes("text/") || ct.includes("application/javascript")) {
          const body = await res.text();
          extractTitlesFromTextPattern(body).forEach((t) => xhrTitles.push(t));
        }
      } catch {
        // ignore
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    log("Page loaded, waiting for networkidle");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    await tryClickConsent(page);

    debug.finalUrl = page.url();
    debug.pageTitle = await page.title().catch(() => undefined);
    debug.frameCount = page.frames().length;
    log(`Final URL: ${debug.finalUrl}`);
    log(`Page title: ${debug.pageTitle ?? "(none)"}`);
    log(`Frames: ${debug.frameCount}`);

    await page
      .locator("text=/View\\s+Details/i")
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});

    await page.waitForTimeout(1200);

    debug.ctaCount = await countCtasInAllFrames(page);
    log(`CTAs found: ${debug.ctaCount}`);
    // Collect per-frame diagnostics (which frame contains the CTAs / headings)
    try {
      const stats: ScrapeDebug["frameStats"] = [];
      for (const frame of page.frames()) {
        try {
          const data = await frame.evaluate(() => {
            const CTA_REGEX = /(view\s+details\s+and\s+apply|view\s+details|apply\s+now|apply)/i;
            const ctas = Array.from(
              document.querySelectorAll("a,button,input[type='submit']")
            ).filter((el) => {
              const label =
                el instanceof HTMLInputElement ? el.value : (el as HTMLElement).innerText;
              return !!label && CTA_REGEX.test(label.trim());
            }).length;

            const headingEls = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
              .map((el) => (el as HTMLElement).innerText?.trim?.() ?? "")
              .filter(Boolean)
              .slice(0, 8);

            return { ctas, headingEls };
          });

          stats.push({
            url: frame.url(),
            ctas: data.ctas,
            sampleHeadings: data.headingEls,
          });
        } catch (e) {
          stats.push({
            url: frame.url(),
            ctas: 0,
            sampleHeadings: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      // Limit size (some pages have tons of frames)
      debug.frameStats = stats.slice(0, 10);
    } catch {
      // ignore
    }

    const frameTitles = await extractTitlesFromAllFrames(page);
    log(`Frame extraction: ${frameTitles.length} titles`);
    if (frameTitles.length > 0) {
      log(`Returning ${frameTitles.length} titles from frame extraction`);
      const jobs: JobRecord[] = frameTitles.map((t) => ({ title: t }));
      await context.close();
      await browser.close();
      debug.responsesScanned = responsesScanned;
      debug.responseSamples = responseSamples;
      debug.relevantResponses = relevantResponses;
      return { titles: frameTitles, jobs, debug };
    }

    // If we saw JSON job titles, prefer those over DOM heuristics.
    const jsonTitles = cleanAndFilterTitles(xhrTitles);
    log(`XHR/JSON extraction: ${xhrTitles.length} raw, ${jsonTitles.length} after filter`);
    if (jsonTitles.length > 0) {
      const jobs: JobRecord[] =
        xhrJobs.length > 0
          ? xhrJobs
          : jsonTitles.map((t) => ({ title: t }));
      await context.close();
      await browser.close();
      debug.responsesScanned = responsesScanned;
      debug.responseSamples = responseSamples;
      debug.relevantResponses = relevantResponses;
      return { titles: jsonTitles, jobs, debug };
    }

    // Oracle HCM Candidate Experience: wait longer, scroll to trigger lazy load, then try Oracle-specific DOM/selectors
    const isOracle = /oraclecloud\.com/i.test(url);
    if (isOracle) {
      log("Oracle URL detected: waiting 4s, scrolling to trigger lazy load");
      await page.waitForTimeout(4000);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      }).catch(() => {});
      await page.waitForTimeout(500);
      const oracleTitles = await extractOracleTitlesFromPage(page);
      log(`Oracle DOM extraction: ${oracleTitles.length} titles`);
      if (oracleTitles.length > 0) {
        log(`Returning ${oracleTitles.length} titles from Oracle extraction`);
        const jobs: JobRecord[] = oracleTitles.map((t) => ({ title: t }));
        await context.close();
        await browser.close();
        debug.responsesScanned = responsesScanned;
        debug.responseSamples = responseSamples;
        debug.relevantResponses = relevantResponses;
        debug.blockedHint = "oracle_dom";
        return { titles: oracleTitles, jobs, debug };
      }
    }

    log("Falling back to HTML extraction");
    const html = await page.content();
    debug.blockedHint = detectBlocked(html);
    if (debug.blockedHint) log(`Blocked hint: ${debug.blockedHint}`);
    // Also try pattern-based extraction on rendered HTML text (sometimes titles only appear in inline scripts)
    const patternTitles = extractTitlesFromTextPattern(html);
    const htmlTitles = cleanAndFilterTitles([...extractTitlesFromHtml(html), ...patternTitles]);
    log(`HTML extraction: ${htmlTitles.length} titles`);

    await context.close();
    await browser.close();

    debug.responsesScanned = responsesScanned;
    debug.responseSamples = responseSamples;
    debug.relevantResponses = relevantResponses;
    log(`Returning ${htmlTitles.length} titles from HTML extraction`);
    const jobs: JobRecord[] = htmlTitles.map((t) => ({ title: t }));
    return { titles: htmlTitles, jobs, debug };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    const message =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : `NonError: ${String(err)}`;
    debug.debugMessages = debug.debugMessages ?? [];
    debug.debugMessages.push(`Error: ${message}`);
    console.error("[scrapeJobTitlesFromUrlDetailed] Playwright error", err);
    return { titles: [], jobs: [], debug: { ...debug, blockedHint: `playwright_error: ${message}` } };
  }
}

/**
 * Scrapes job titles from a URL using Playwright (headless browser) to handle JavaScript-rendered content.
 * Falls back to simple fetch if Playwright fails.
 */
export async function scrapeJobTitlesFromUrl(url: string): Promise<string[]> {
  const { titles } = await scrapeJobTitlesFromUrlDetailed(url);
  return titles;
}

/** Builds a stable fingerprint for "new job" comparison: prefer id, then title+url, then title+postedAt, else title. */
export function jobRecordFingerprint(j: JobRecord): string {
  if (j.id) return `id:${j.id}`;
  if (j.url) return `url:${j.url}`;
  if (j.postedAt) return `title:${j.title}|posted:${j.postedAt}`;
  return `title:${j.title}`;
}
