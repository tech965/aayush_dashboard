import Dashboard from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/70 p-8 shadow-[0_24px_60px_var(--shadow)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--accent-dark)]">
            Order Dashboard Of Aayush wellness
          </p>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1
                className="text-4xl text-[var(--ink)] md:text-5xl"
                style={{ fontFamily: "var(--font-dm-serif), serif" }}
              >
                Live Shopify Order Pulse
              </h1>
              <p className="mt-3 max-w-2xl text-base text-[var(--muted)]">
                Daily status breakdown from January 1, 2026 onward. Every update
                comes in via Shopify webhooks, so the numbers stay accurate.
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white">
              Asia/Kolkata timezone
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-black/10 bg-[var(--surface-strong)] p-6 shadow-[0_20px_50px_var(--shadow)]">
          <Dashboard/>
        </section>
      </div>
    </main>
  );
}
