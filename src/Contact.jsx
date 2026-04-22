import { useState } from "react";

export default function Contact() {
  const [form, setForm] = useState({
    email: "",
    name: "",
    subject: "",
    message: "",
  });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      const res = await fetch("/contact.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to send message.");
      }

      setStatus("Message sent successfully.");
      setForm({
        email: "",
        name: "",
        subject: "",
        message: "",
      });
    } catch (err) {
      setStatus(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-16 lg:px-10">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-semibold md:text-4xl">Send Message</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Reach out for classes, artwork inquiries, or general questions.
        </p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Email*
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-rose-400"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Name
            </label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-rose-400"
              placeholder="Enter your name"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Subject
            </label>
            <input
              type="text"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-rose-400"
              placeholder="Enter subject"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700">
              Message
            </label>
            <textarea
              name="message"
              value={form.message}
              onChange={handleChange}
              required
              rows={6}
              className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-rose-400"
              placeholder="Write your message"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-rose-700 px-6 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send"}
          </button>

          {status && <p className="text-sm text-stone-600">{status}</p>}
        </form>
      </div>
    </section>
  );
}
