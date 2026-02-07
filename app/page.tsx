import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)] bg-grid">
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" />
      <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12">
        <span className="text-lg font-semibold tracking-tight text-zinc-300">
          JobMonitor
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-zinc-400 transition hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Get started
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-16 pb-32 md:pt-24">
        <h1 className="max-w-3xl text-center text-4xl font-bold tracking-tight md:text-6xl md:leading-[1.1]">
          Never miss a job again.{" "}
          <span className="gradient-text">Monitor your favorite job pages.</span>
        </h1>
        <p className="mt-6 max-w-xl text-center text-lg text-zinc-400">
          Add filtered job search URLs (LinkedIn, Indeed, company career pages).
          We check them for you and alert you when new jobs appear.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-8 py-4 text-base font-semibold text-zinc-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-300 hover:shadow-cyan-500/30"
          >
            Create free account
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-600 bg-zinc-800/50 px-8 py-4 text-base font-medium text-white transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            I already have an account
          </Link>
        </div>
        <div className="mt-20 grid max-w-4xl gap-6 md:grid-cols-3">
          {[
            {
              title: "Add your URLs",
              desc: "Paste job search links with your filters already applied.",
            },
            {
              title: "One-click check",
              desc: "Hit “Get results” and we scrape all your saved pages.",
            },
            {
              title: "See new jobs",
              desc: "We show which links have new listings and the job titles.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 card-hover"
            >
              <h3 className="font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
