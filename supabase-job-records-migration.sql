-- Add job_records to store title + id/url/postedAt for accurate "new job" detection.
-- Run in Supabase SQL Editor.

alter table public.scrape_results
  add column if not exists job_records jsonb not null default '[]';

comment on column public.scrape_results.job_records is 'Array of { title, id?, url?, postedAt? } for deduplication; id or title+url used to detect new jobs.';
