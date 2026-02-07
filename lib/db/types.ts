export type User = {
  id: number;
  created_at: string;
  name: string | null;
  email: string | null;
};

export type Link = {
  id: number;
  created_at: string;
  company: string | null;
  urls: string[] | null;
  user_id: number | null;
};

/** One job from a scrape; id/url/postedAt used to detect new postings (same title can appear multiple times). */
export type JobRecord = {
  title: string;
  id?: string;
  url?: string;
  postedAt?: string;
};

export type ScrapeResult = {
  id: number;
  link_id: number;
  scraped_at: string;
  job_titles: string[];
  job_records?: JobRecord[];
};

export type LinkWithUrls = Link & { urls: string[] };
