"use server";

import { createClient } from "@/lib/supabase/server";
import { getPublicUserIdByEmail } from "@/lib/db/users";
import type { JobRecord } from "@/lib/db/types";
import {
  scrapeJobTitlesFromUrlDetailed,
  jobRecordFingerprint,
  type ScrapeDebug,
} from "@/lib/scraper";

export type MonitorResultItem = {
  linkId: number;
  company: string | null;
  urls: string[];
  hasNewJobs: boolean;
  jobTitles: string[];
  primaryUrl: string;
  debug?: ScrapeDebug;
};

/** Scraped result for one link (before comparing to previous / saving). */
export type ScrapedLinkResult = {
  linkId: number;
  company: string | null;
  urls: string[];
  jobTitles: string[];
  jobRecords: JobRecord[];
  primaryUrl: string;
  debug?: ScrapeDebug;
};

/**
 * Scrape a single link's URLs. Verifies the link belongs to the current user.
 * Use this from the client in a loop to get per-link progress.
 */
export async function scrapeLink(linkId: number): Promise<{
  error?: string;
  result?: ScrapedLinkResult;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const { data: link, error: linkError } = await supabase
    .from("links")
    .select("id, company, urls")
    .eq("id", linkId)
    .eq("user_id", userId)
    .single();

  if (linkError || !link) return { error: "Link not found." };

  const urls = (link.urls ?? []) as string[];
  const primaryUrl = urls[0] ?? "";
  const allTitles: string[] = [];
  const allJobRecords: JobRecord[] = [];
  let debug: ScrapeDebug | undefined;

  for (const url of urls) {
    const { titles, jobs, debug: d } = await scrapeJobTitlesFromUrlDetailed(url);
    allTitles.push(...titles);
    allJobRecords.push(...jobs);
    debug ??= d;
  }

  return {
    result: {
      linkId: link.id,
      company: link.company,
      urls,
      jobTitles: allTitles,
      jobRecords: allJobRecords,
      primaryUrl,
      debug,
    },
  };
}

/**
 * Clear all scrape history for the current user's links.
 * After this, the next "Get monitor results" will treat all jobs as new.
 */
export async function clearMonitorHistory(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const { data: userLinks, error: linksError } = await supabase
    .from("links")
    .select("id")
    .eq("user_id", userId);

  if (linksError) return { error: linksError.message };
  if (!userLinks?.length) return {}; // nothing to clear

  const linkIds = userLinks.map((l) => l.id);
  const { error: deleteError } = await supabase
    .from("scrape_results")
    .delete()
    .in("link_id", linkIds);

  if (deleteError) return { error: deleteError.message };
  return {};
}

/**
 * Save scraped results, compute hasNewJobs, and return full MonitorResultItem[].
 */
export async function saveMonitorResults(
  scraped: ScrapedLinkResult[]
): Promise<{ error?: string; results?: MonitorResultItem[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const results: MonitorResultItem[] = [];

  for (const item of scraped) {
    const { data: previous } = await supabase
      .from("scrape_results")
      .select("job_titles, job_records")
      .eq("link_id", item.linkId)
      .order("scraped_at", { ascending: false })
      .limit(1)
      .single();

    const previousRecords = (previous?.job_records ?? []) as JobRecord[];
    const previousFingerprints = new Set(
      previousRecords.map((j) => jobRecordFingerprint(j))
    );
    const hasNewJobs =
      item.jobRecords.length > 0 &&
      (previousFingerprints.size === 0 ||
        item.jobRecords.some(
          (j) => !previousFingerprints.has(jobRecordFingerprint(j))
        ));

    await supabase.from("scrape_results").insert({
      link_id: item.linkId,
      job_titles: item.jobTitles,
      job_records: item.jobRecords,
    });

    results.push({
      linkId: item.linkId,
      company: item.company,
      urls: item.urls,
      hasNewJobs,
      jobTitles: item.jobTitles,
      primaryUrl: item.primaryUrl,
      debug: item.debug,
    });
  }

  return { results };
}

export async function runMonitor(): Promise<{
  error?: string;
  results?: MonitorResultItem[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const userId = await getPublicUserIdByEmail(user.email);
  if (userId == null) return { error: "User record not found." };

  const { data: links, error: linksError } = await supabase
    .from("links")
    .select("id, company, urls")
    .eq("user_id", userId);

  if (linksError) return { error: linksError.message };
  if (!links?.length) return { results: [] };

  const results: MonitorResultItem[] = [];

  for (const link of links) {
    const urls = (link.urls ?? []) as string[];
    const primaryUrl = urls[0] ?? "";
    const allTitles: string[] = [];
    const allJobRecords: JobRecord[] = [];
    let debug: ScrapeDebug | undefined;

    for (const url of urls) {
      const { titles, jobs, debug: d } = await scrapeJobTitlesFromUrlDetailed(url);
      allTitles.push(...titles);
      allJobRecords.push(...jobs);
      debug ??= d; // keep first URL's debug
    }

    const jobTitles = allTitles;
    const jobRecords = allJobRecords;

    // Get previous scrape for this link
    const { data: previous } = await supabase
      .from("scrape_results")
      .select("job_titles, job_records")
      .eq("link_id", link.id)
      .order("scraped_at", { ascending: false })
      .limit(1)
      .single();

    const previousRecords = (previous?.job_records ?? []) as JobRecord[];
    const previousFingerprints = new Set(
      previousRecords.map((j) => jobRecordFingerprint(j))
    );
    const hasNewJobs =
      jobRecords.length > 0 &&
      (previousFingerprints.size === 0 ||
        jobRecords.some(
          (j) => !previousFingerprints.has(jobRecordFingerprint(j))
        ));

    // Save this scrape
    await supabase.from("scrape_results").insert({
      link_id: link.id,
      job_titles: jobTitles,
      job_records: jobRecords,
    });

    results.push({
      linkId: link.id,
      company: link.company,
      urls,
      hasNewJobs,
      jobTitles,
      primaryUrl,
      debug,
    });
  }

  return { results };
}
