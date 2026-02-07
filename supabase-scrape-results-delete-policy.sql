-- Run this in Supabase SQL Editor once to allow "Clear job monitor history" to work.
-- RLS was blocking deletes on scrape_results because only SELECT and INSERT policies existed.

create policy "Scrape results delete own" on public.scrape_results
  for delete using (
    link_id in (
      select id from public.links
      where user_id in (select id from public.users where email = auth.jwt()->>'email')
    )
  );
