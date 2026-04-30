import { useState } from "react";

export default function Contact() {
  const [form, setForm] = useState({
    email: "",
    name: "",
    subject: "",
    message: "",
  });
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState(""); // "ok" | "err" | ""
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    setStatusKind("");

    try {
      const res = await fetch("/contact.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to send message.");
      }
      setStatus("Thanks — your message landed in Sasireka's inbox. She'll reply soon.");
      setStatusKind("ok");
      setForm({ email: "", name: "", subject: "", message: "" });
    } catch (err) {
      setStatus(err.message || "Something went wrong.");
      setStatusKind("err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-14 lg:px-10 lg:py-20">
      <div className="mb-10 text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">
          Get in touch
        </p>
        <h2 className="font-serif text-3xl font-extrabold text-stone-900 md:text-5xl">
          Let&rsquo;s talk about art.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-stone-600">
          Whether you&rsquo;re asking about a piece, commissioning a new one,
          or curious about classes — drop a message below.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ─── Form ─────────────────────────────────────── */}
        <div className="lg:col-span-3">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200 md:p-9">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">
                    Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50/40 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50/40 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">
                  Subject
                </label>
                <input
                  type="text"
                  name="subject"
                  value={form.subject}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50/40 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100"
                  placeholder="What's this about?"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">
                  Message
                </label>
                <textarea
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  required
                  rows={6}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50/40 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100"
                  placeholder="Tell Sasireka what's on your mind…"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-stone-500">
                  We&rsquo;ll only use your email to reply. No mailing lists.
                </p>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-700 px-7 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-rose-800 disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M22 12a10 10 0 0 0-10-10" strokeLinecap="round" />
                      </svg>
                      Sending…
                    </>
                  ) : (
                    <>
                      Send message
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              {status && (
                <div
                  role="status"
                  className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm ${
                    statusKind === "ok"
                      ? "bg-green-50 text-green-800 ring-1 ring-green-200"
                      : statusKind === "err"
                      ? "bg-red-50 text-red-800 ring-1 ring-red-200"
                      : "bg-stone-50 text-stone-700 ring-1 ring-stone-200"
                  }`}
                >
                  {statusKind === "ok" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 shrink-0">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v5M12 16h.01" />
                    </svg>
                  )}
                  <span>{status}</span>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* ─── Side info card ────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-rose-50 via-amber-50 to-stone-50 shadow-sm ring-1 ring-stone-200">
            <img
              src="/images/hero-open/H002.jpg"
              alt="From Sasireka's studio"
              className="h-56 w-full object-cover"
              loading="lazy"
            />
            <div className="p-6 md:p-7">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">
                The artist
              </p>
              <h3 className="font-serif text-2xl font-bold text-stone-900">Sasireka</h3>
              <p className="mt-3 text-sm leading-7 text-stone-600">
                Original paintings made with patience, color, and a love for the
                quiet moments. Reach out anytime — every message is read.
              </p>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-start gap-2 text-stone-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-4 w-4 text-rose-700">
                    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
                  </svg>
                  <span>Replies usually within a day or two.</span>
                </div>
                <div className="flex items-start gap-2 text-stone-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-4 w-4 text-rose-700">
                    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                  </svg>
                  <span>Studio time: weekday afternoons.</span>
                </div>
                <div className="flex items-start gap-2 text-stone-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-4 w-4 text-rose-700">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>Original paintings — shipping arranged on request.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
