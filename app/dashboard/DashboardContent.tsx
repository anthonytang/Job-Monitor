"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addLink, deleteLink } from "@/app/actions/links";
import {
  scrapeLink,
  saveMonitorResults,
  clearMonitorHistory,
  type MonitorResultItem,
  type ScrapedLinkResult,
} from "@/app/actions/monitor";

type LinkRow = {
  id: number;
  company: string | null;
  urls: string[];
  created_at: string;
};

export function DashboardContent({ initialLinks }: { initialLinks: LinkRow[] }) {
  const router = useRouter();
  const [links, setLinks] = useState<LinkRow[]>(initialLinks);

  useEffect(() => {
    setLinks(initialLinks);
  }, [initialLinks]);
  const [adding, setAdding] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorProgress, setMonitorProgress] = useState(0);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [results, setResults] = useState<MonitorResultItem[] | null>(null);
  const [expandId, setExpandId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAddLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddError(null);
    setSavingLink(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const result = await addLink(formData);
    setSavingLink(false);
    if (result?.error) {
      setAddError(result.error);
      return;
    }
    form.reset();
    setAdding(false);
    router.refresh();
  }

  async function handleDelete(linkId: number) {
    setDeletingId(linkId);
    await deleteLink(linkId);
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    setResults((prev) => prev?.filter((r) => r.linkId !== linkId) ?? null);
    setDeletingId(null);
    router.refresh();
  }

  async function handleRunMonitor() {
    setMonitoring(true);
    setResults(null);
    setMonitorProgress(0);
    setAddError(null);

    const total = links.length;
    if (total === 0) {
      setMonitoring(false);
      return;
    }

    const scraped: ScrapedLinkResult[] = [];

    for (let i = 0; i < links.length; i++) {
      setMonitorProgress(Math.round(((i + 0.5) / total) * 100));
      const { error, result } = await scrapeLink(links[i]!.id);
      if (error) {
        setAddError(error);
        setMonitoring(false);
        setMonitorProgress(0);
        return;
      }
      if (result) scraped.push(result);
      setMonitorProgress(Math.round(((i + 1) / total) * 100));
    }

    const { error: saveError, results: nextResults } = await saveMonitorResults(scraped);
    setMonitorProgress(100);
    setMonitoring(false);
    if (saveError) {
      setAddError(saveError);
      return;
    }
    setResults(nextResults ?? []);
    router.refresh();
  }

  async function handleClearHistory() {
    setClearingHistory(true);
    setAddError(null);
    const { error } = await clearMonitorHistory();
    setClearingHistory(false);
    if (error) {
      setAddError(error);
      return;
    }
    router.refresh();
  }

  const linksWithNewJobs = results?.filter((r) => r.hasNewJobs) ?? [];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-zinc-400">
          Add job page URLs to monitor and run a check to see new listings.
        </p>
      </div>

      {/* Add link */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Add job pages</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Paste one or more URLs (e.g. filtered job search pages). One per line or comma-separated.
        </p>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 rounded-lg border border-dashed border-zinc-600 px-4 py-3 text-sm font-medium text-zinc-400 transition hover:border-cyan-500 hover:text-cyan-400"
          >
            + Add URLs
          </button>
        ) : (
          <form onSubmit={handleAddLink} className="mt-4 space-y-4">
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-zinc-300">
                Label (optional)
              </label>
              <input
                id="company"
                name="company"
                type="text"
                placeholder="e.g. LinkedIn Frontend NYC"
                className="mt-1.5 w-full rounded-lg border border-zinc-600 bg-zinc-800/50 px-4 py-2.5 text-white placeholder-zinc-500 input-focus"
              />
            </div>
            <div>
              <label htmlFor="urls" className="block text-sm font-medium text-zinc-300">
                URLs
              </label>
              <textarea
                id="urls"
                name="urls"
                rows={4}
                required
                placeholder="https://www.linkedin.com/jobs/...&#10;https://www.indeed.com/..."
                className="mt-1.5 w-full rounded-lg border border-zinc-600 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 input-focus font-mono text-sm"
              />
            </div>
            {addError && <p className="text-sm text-red-400">{addError}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={savingLink}
                className="rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {savingLink && <span className="spinner" aria-hidden />}
                {savingLink ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setAddError(null); }}
                className="rounded-lg border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:border-zinc-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Saved links */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Saved links</h2>
        {links.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No links yet. Add URLs above.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-800/30 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-white">
                    {link.company || "Unnamed"}
                  </span>
                  <p className="mt-0.5 break-all text-sm text-zinc-400">
                    {link.urls[0]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(link.id)}
                    disabled={deletingId === link.id}
                    className="rounded border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-red-500/50 hover:text-red-400 disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-[4.5rem]"
                  >
                    {deletingId === link.id && <span className="spinner spinner-sm" aria-hidden />}
                    {deletingId === link.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Get monitor results */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Check for new jobs</h2>
        <p className="mt-1 text-sm text-zinc-400">
          We’ll scrape all your saved URLs and show which links have new listings.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRunMonitor}
            disabled={monitoring || links.length === 0}
            className="rounded-lg bg-cyan-400 px-6 py-3 text-base font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {monitoring && <span className="spinner" aria-hidden />}
            {monitoring ? "Checking…" : "Get monitor results"}
          </button>
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={monitoring || clearingHistory || links.length === 0}
            className="rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {clearingHistory && <span className="spinner spinner-sm" aria-hidden />}
            {clearingHistory ? "Clearing…" : "Clear job monitor history"}
          </button>
        </div>
        {monitoring && (
          <div className="mt-3" role="progressbar" aria-valuenow={monitorProgress} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`Scraping progress: ${monitorProgress}%`}>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${monitorProgress}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-zinc-500">{monitorProgress}%</p>
          </div>
        )}

        {/* Results: all monitored links (with new jobs highlighted) */}
        {results !== null && (
          <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-800/30 p-6">
            <h3 className="font-semibold text-white">
              {results.length > 0
                ? `Monitor results (${results.length} link${results.length === 1 ? "" : "s"})`
                : "No links to monitor"}
            </h3>
            {results.length === 0 ? null : (
              <>
                {linksWithNewJobs.length > 0 && (
                  <p className="mt-1 text-sm text-cyan-400">
                    {linksWithNewJobs.length} link{linksWithNewJobs.length === 1 ? "" : "s"} with new jobs.
                  </p>
                )}
                {results.some((r) => r.jobTitles.length === 0) && (
                  <p className="mt-1 text-sm text-zinc-500">
                    Some links returned no jobs (timeout or blocked on server). Running locally often works for all links.
                  </p>
                )}
                <ul className="mt-4 space-y-4">
                  {results.map((item) => {
                    const hasJobs = item.jobTitles.length > 0;
                    const isNew = item.hasNewJobs;
                    return (
                      <li
                        key={item.linkId}
                        className={`rounded-xl border p-4 ${
                          hasJobs
                            ? isNew
                              ? "border-cyan-500/30 bg-cyan-500/5"
                              : "border-zinc-600 bg-zinc-800/20"
                            : "border-zinc-700 bg-zinc-800/10"
                        }`}
                      >
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0 flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">
                              {item.company || "Unnamed"}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {hasJobs
                                ? isNew
                                  ? `${item.newJobTitles.length} new job${item.newJobTitles.length === 1 ? "" : "s"} (${item.jobTitles.length} total)`
                                  : `${item.jobTitles.length} job${item.jobTitles.length === 1 ? "" : "s"} (no new since last check)`
                                : "0 jobs (none found)"}
                            </span>
                          </div>
                          <p className="mt-0.5 break-all text-sm text-zinc-400">
                            {item.primaryUrl}
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <a
                              href={`/out?url=${encodeURIComponent(item.primaryUrl)}`}
                              className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-300"
                            >
                              Open link
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandId(expandId === item.linkId ? null : item.linkId)
                              }
                              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
                            >
                              {expandId === item.linkId ? "Hide jobs" : "More info"}
                            </button>
                          </div>
                        </div>
                        {expandId === item.linkId && (
                          <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                              {item.hasNewJobs ? "New jobs since last check" : "Job titles"}
                            </p>
                            <ul className="space-y-1.5">
                              {item.jobTitles.length === 0 ? (
                                <li className="text-sm text-zinc-500">
                                  No titles extracted (page may use different markup, or timed out / blocked on server).
                                </li>
                              ) : item.hasNewJobs && item.newJobTitles.length > 0 ? (
                                item.newJobTitles.map((title, i) => (
                                  <li key={i} className="text-sm text-zinc-300">
                                    • {title}
                                  </li>
                                ))
                              ) : item.hasNewJobs && item.newJobTitles.length === 0 ? (
                                <li className="text-sm text-zinc-500">
                                  No new jobs (all {item.jobTitles.length} match the previous scrape).
                                </li>
                              ) : (
                                <li className="text-sm text-zinc-500">
                                  No new jobs since last check ({item.jobTitles.length} total).
                                </li>
                              )}
                            </ul>
                            {item.debug?.debugMessages?.length ? (
                              <details className="mt-4">
                                <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500">
                                  Debug log
                                </summary>
                                <div className="mt-2 space-y-0.5 font-mono text-[10px] text-zinc-500 max-h-40 overflow-y-auto rounded bg-zinc-900/60 p-2">
                                  {item.debug.debugMessages.map((msg, idx) => (
                                    <div key={idx} className="whitespace-pre-wrap break-words">{msg}</div>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                            {item.debug?.blockedHint && (
                              <p className="mt-2 text-xs text-amber-500">
                                Hint: {item.debug.blockedHint}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
