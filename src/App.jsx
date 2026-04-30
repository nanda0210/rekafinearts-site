import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import "./index.css";
import { imageData } from "./imageData";
import Admin from "./Admin";
import Contact from "./Contact";
import DeployManager from "./DeployManager";

// Auto-switch: localhost in dev, configured production URL on the live site.
// Set VITE_API_BASE_URL at build time (or in .env) once the backend is hosted.
const API_BASE = (() => {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  if (h === "localhost" || h === "127.0.0.1" || h === "") return "http://localhost:3002";
  return import.meta.env.VITE_API_BASE_URL || "";
})();

function parseImagePath(image) {
  const parts = image.split("/").filter(Boolean);
  return {
    category: parts[1],
    filename: parts[2],
  };
}

const colorfulLogoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 180">
  <defs>
    <linearGradient id="logoGradient" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#7c3aed" />
      <stop offset="30%" stop-color="#0ea5e9" />
      <stop offset="60%" stop-color="#f97316" />
      <stop offset="100%" stop-color="#ec4899" />
    </linearGradient>
    <linearGradient id="taglineGradient" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#cbd5e1" />
      <stop offset="100%" stop-color="#f8fafc" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="34" fill="#eef2ff" />
  <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Playfair Display, Georgia, serif" font-size="56" font-weight="800" fill="url(#logoGradient)">
    REKA FINE ARTS
  </text>
  <text x="50%" y="82%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, sans-serif" font-size="18" font-weight="500" fill="#334155">
    Stylish art creation from Sasireka
  </text>
</svg>
`;
const logoDataUri = `data:image/svg+xml,${encodeURIComponent(colorfulLogoSvg)}`;

function ImageCard({
  image,
  index,
  title,
  showDetails = false,
  imageDetails = {},
  likes,
  onLike,
  hasLiked,        // true if this image was already liked this session
}) {
  const fileName = image.split("/").pop();
  const details = imageDetails[fileName] || {
    title: `Featured Artwork ${index + 1}`,
    description:
      "Add your artwork title, medium, or short description here.",
  };

  const [commentInput, setCommentInput] = useState("");
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [commentStatus, setCommentStatus] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const { category, filename } = parseImagePath(image);
  const shareUrl = (typeof window !== "undefined" ? window.location.origin : "") + image;
  const shareText = `${details.title} — Reka Fine Arts`;

  // Load approved comments when the user opens the comments panel.
  useEffect(() => {
    if (!showComments || !category || !filename || !API_BASE) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/comments?category=${encodeURIComponent(category)}&filename=${encodeURIComponent(filename)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setComments(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setComments([]); });
    return () => { cancelled = true; };
  }, [showComments, category, filename]);

  async function handleAddComment() {
    const text = (commentInput || "").trim();
    if (!text) { setCommentStatus("Comment cannot be empty"); return; }
    if (text.length > 200) { setCommentStatus("Max 200 characters"); return; }
    if (!API_BASE) { setCommentStatus("Comments backend not configured for this site"); return; }
    setCommentStatus("Submitting…");
    try {
      const res = await fetch(`${API_BASE}/api/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, filename, comment_text: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCommentStatus(err.error || `Failed (HTTP ${res.status})`);
        return;
      }
      setCommentInput("");
      setCommentStatus("Comment submitted for approval");
      // Auto-close the comment box after a short pause so the user sees the confirmation.
      setTimeout(() => {
        setShowCommentBox(false);
        setCommentStatus("");
      }, 1500);
    } catch {
      setCommentStatus("Network error — backend may be offline");
    }
  }

  function handleShare(network) {
    const enc = encodeURIComponent;
    const urls = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`,
      x:        `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(shareText)}`,
      whatsapp: `https://wa.me/?text=${enc(shareText + " " + shareUrl)}`,
      email:    `mailto:?subject=${enc(shareText)}&body=${enc(shareText + "\n\n" + shareUrl)}`,
    };
    if (network === "copy") {
      try {
        navigator.clipboard?.writeText(shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1800);
      } catch { /* no-op */ }
      return;
    }
    if (urls[network]) {
      window.open(urls[network], "_blank", "noopener,noreferrer,width=620,height=580");
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-stone-200">
      <div>
        <img
          src={image}
          alt={`${title} artwork ${index + 1}`}
          className={
            showDetails
              ? "h-80 w-full object-cover transition duration-300 hover:scale-[1.02] md:h-[28rem]"
              : "h-72 w-full object-cover transition duration-300 hover:scale-[1.02]"
          }
          loading="lazy"
        />
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          {showDetails ? (
            <div className="min-w-0">
              <p className="line-clamp-1 text-base font-semibold text-stone-800">
                {details.title}
              </p>
              <p className="line-clamp-2 text-sm leading-6 text-stone-600">
                {details.description}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-500">{fileName}</p>
          )}
          <div className="flex shrink-0 gap-2 items-center">
            <button
              onClick={() => setShowComments((prev) => !prev)}
              className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-md hover:bg-blue-700 focus:outline-none"
              title={showComments ? "Hide comments" : "Show comments"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" fill="currentColor" d="M18 10c0 3.866-3.582 7-8 7a9.77 9.77 0 0 1-3.5-.6c-.3-.1-.6-.2-.9-.3l-2.1.7a1 1 0 0 1-1.3-1.3l.7-2.1c-.1-.3-.2-.6-.3-.9A7.5 7.5 0 0 1 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" />
              </svg>
              <span>{comments.length}</span>
            </button>
            <button
              onClick={() => onLike(image)}
              disabled={hasLiked}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white shadow-md focus:outline-none ${
                hasLiked
                  ? "bg-green-700 cursor-default opacity-90"
                  : "bg-green-600 hover:bg-green-700 cursor-pointer"
              }`}
              aria-label={hasLiked ? "Already liked this session" : "Like this artwork"}
              title={hasLiked ? "You've liked this artwork" : "Like this artwork"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" className="w-4 h-4">
                <path d="M3.172 5.172a4 4 0 0 1 5.656 0L10 6.343l1.172-1.171a4 4 0 1 1 5.656 5.656l-6.364 6.364a.75.75 0 0 1-1.06 0L3.172 10.83a4 4 0 0 1 0-5.656z" />
              </svg>
              <span>{likes}</span>
              {hasLiked && <span className="ml-0.5">✓</span>}
            </button>
            <button
              onClick={() => setShowCommentBox((prev) => !prev)}
              className={`flex items-center gap-1 rounded-full bg-stone-200 px-3 py-1 text-xs font-medium text-stone-700 shadow-md hover:bg-stone-300 focus:outline-none ${showCommentBox ? 'ring-2 ring-rose-400' : ''}`}
              title={showCommentBox ? "Hide Add Comment" : "Add Comment"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6v4m0 0v4m0-4h4m-4 0H6m12 0a8 8 0 11-16 0 8 8 0 0116 0z" />
              </svg>
            </button>
          </div>
        </div>
        {showCommentBox && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <textarea
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value.slice(0, 200))}
                placeholder="Add comments <text>"
                rows={2}
                maxLength={200}
                className="w-full rounded-2xl border border-stone-300 px-4 py-2 text-sm text-stone-700 outline-none transition focus:border-rose-400"
              />
              <button
                onClick={handleAddComment}
                className="inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white shadow-md hover:bg-green-700 focus:outline-none"
                title="Post Comment"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 10l15-6-6 15-2.5-6-6-2.5z" />
                </svg>
                <span className="sr-only">Post</span>
              </button>
            </div>
            <p className="text-right text-xs text-stone-500">
              {commentInput.length}/200
            </p>
            {commentStatus && (
              <p className="text-sm text-stone-500">{commentStatus}</p>
            )}
          </div>
        )}
        {showComments && comments.length > 0 && (
          <div className="space-y-2 rounded-2xl bg-stone-50 p-3">
            <p className="text-sm font-semibold text-stone-700">
              Previous comments
            </p>
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-xl bg-white px-3 py-2 text-sm text-stone-600 ring-1 ring-stone-200"
              >
                {comment.comment_text}
              </div>
            ))}
          </div>
        )}
        {showComments && comments.length === 0 && (
          <div className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
            No approved comments yet.
          </div>
        )}

        {/* Social share row */}
        <div className="flex items-center gap-2 border-t border-stone-100 pt-3 text-xs text-stone-500">
          <span className="font-medium">Share:</span>
          <button
            onClick={() => handleShare("facebook")}
            className="rounded-full bg-[#1877f2] p-1.5 text-white shadow-sm hover:opacity-90"
            title="Share on Facebook"
            aria-label="Share on Facebook"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M9.198 21.5h4v-8.01h3.604l.396-3.98h-4V7.5a1 1 0 0 1 1-1h3v-4h-3a5 5 0 0 0-5 5v2.01h-2l-.396 3.98h2.396v8.01z" />
            </svg>
          </button>
          <button
            onClick={() => handleShare("x")}
            className="rounded-full bg-black p-1.5 text-white shadow-sm hover:opacity-90"
            title="Share on X"
            aria-label="Share on X"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          <button
            onClick={() => handleShare("whatsapp")}
            className="rounded-full bg-[#25d366] p-1.5 text-white shadow-sm hover:opacity-90"
            title="Share on WhatsApp"
            aria-label="Share on WhatsApp"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
          </button>
          <button
            onClick={() => handleShare("email")}
            className="rounded-full bg-stone-600 p-1.5 text-white shadow-sm hover:opacity-90"
            title="Share via Email"
            aria-label="Share via Email"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </button>
          <button
            onClick={() => handleShare("copy")}
            className="rounded-full bg-stone-200 p-1.5 text-stone-700 shadow-sm hover:bg-stone-300"
            title="Copy link"
            aria-label="Copy link"
          >
            {shareCopied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3.5 w-3.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </button>
          {shareCopied && <span className="ml-1 text-green-600">Link copied!</span>}
        </div>
      </div>
    </div>
  );
}

function CategoryPage({
  title,
  description,
  images,
  showDetails = false,
  imageDetails = {},
  likedSet,
  likesMap,
  onLike,
}) {
  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => {
      const likeA = likesMap[a] || 0;
      const likeB = likesMap[b] || 0;
      return likeB - likeA;
    });
  }, [images, likesMap]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
      <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold md:text-4xl">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {description}
          </p>
        </div>
        <p className="text-sm text-stone-500">{sortedImages.length} images</p>
      </div>

      <div
        className={
          showDetails
            ? "grid gap-6 sm:grid-cols-2"
            : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {sortedImages.map((image, index) => (
          <ImageCard
            key={`${title}-${image}`}
            image={image}
            index={index}
            title={title}
            showDetails={showDetails}
            imageDetails={imageDetails}
            likes={likesMap[image] || 0}
            onLike={onLike}
            hasLiked={likedSet?.has(image) || false}
          />
        ))}
      </div>
    </section>
  );
}

function Layout({ children }) {
  const location = useLocation();
  const hideHeader = location.pathname === "/admin" || location.pathname === "/deploy";

  return (
    <div className="min-h-screen bg-[#faf7f2] text-stone-800">
      {!hideHeader && (
        <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-10">
            <Link to="/" className="flex items-baseline gap-2 group" aria-label="Reka Fine Arts — home">
              <span className="text-xl font-bold tracking-tight text-stone-800 group-hover:text-rose-700 transition">
                Reka <span className="text-rose-700">Fine Arts</span>
              </span>
              <span className="hidden sm:inline text-xs text-stone-500 italic">
                Stylish art creation from Sasireka
              </span>
            </Link>

            <div className="flex flex-wrap gap-2 text-sm font-medium">
              <Link
                to="/"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Home
              </Link>
              <Link
                to="/gallery"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Gallery
              </Link>
              <Link
                to="/beginners"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Beginners
              </Link>
              <Link
                to="/intermediate"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Intermediate
              </Link>
              <Link
                to="/advanced"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Advanced
              </Link>
              <Link
                to="/kidsart"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Kids Work
              </Link>
              <Link
                to="/contact"
                className="rounded-full px-3 py-1 text-stone-600 transition hover:bg-stone-100"
              >
                Contact
              </Link>
            </div>
          </nav>
        </header>
      )}

      {children}

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 text-sm text-stone-500 md:flex-row md:items-center md:justify-between lg:px-10">
          <p>© 2026 Reka Fine Arts. All rights reserved.</p>
          <p>Self-hosted website running with Vite + React.</p>
        </div>
      </footer>
    </div>
  );
}

function HomePage() {
  // First few gallery images for the magazine-style featured strip.
  const gallery = (imageData.gallery || []).slice(0, 8);
  const stats = [
    { n: (imageData.gallery || []).length, label: "Featured" },
    { n: ((imageData.advanced || []).length + (imageData.intermediate || []).length + (imageData.beginners || []).length), label: "Studies" },
    { n: (imageData.kidsart || []).length, label: "Kids work" },
  ];

  return (
    <div className="space-y-12">
      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-50 via-amber-50 to-stone-50 ring-1 ring-stone-200">
        <div className="grid gap-0 md:grid-cols-2">
          <div className="flex flex-col justify-center px-7 py-10 md:px-12 md:py-16">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Original Paintings</p>
            <h1 className="font-serif text-4xl font-extrabold leading-tight text-stone-900 md:text-5xl">
              Art that lives <span className="text-rose-700">on your wall</span>, <span className="italic">made by hand.</span>
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-stone-600">
              A curated gallery of original paintings by <strong>Sasireka</strong> — color-rich, mindful, and ready to bring warmth to your space.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/gallery"
                className="inline-flex items-center gap-2 rounded-full bg-rose-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-rose-800"
              >
                Explore the Gallery
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Get in touch
              </Link>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-2 p-3 md:p-5">
            <div className="overflow-hidden rounded-2xl ring-1 ring-stone-200">
              <img src="/images/hero-open/H001.JPG" alt="Featured artwork" className="h-44 w-full object-cover md:h-64" loading="eager" />
            </div>
            <div className="overflow-hidden rounded-2xl ring-1 ring-stone-200">
              <img src="/images/hero-open/H002.jpg" alt="Featured artwork" className="h-44 w-full object-cover md:h-64" loading="eager" />
            </div>
            <div className="col-span-2 overflow-hidden rounded-2xl ring-1 ring-stone-200">
              {gallery[0] && (
                <img src={gallery[0]} alt="Gallery preview" className="h-44 w-full object-cover md:h-56" loading="eager" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats strip ──────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-2xl font-extrabold text-rose-700 md:text-3xl">{s.n}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-stone-500">{s.label}</div>
          </div>
        ))}
      </section>

      {/* ─── Featured artwork strip ───────────────────────── */}
      {gallery.length > 0 && (
        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-serif text-2xl font-bold text-stone-900 md:text-3xl">
                Featured artworks
              </h2>
              <p className="mt-1 text-sm text-stone-500">A taste from the gallery — see the full collection there.</p>
            </div>
            <Link to="/gallery" className="hidden text-sm font-semibold text-rose-700 hover:text-rose-800 md:inline-flex">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((img, i) => (
              <Link
                key={img}
                to="/gallery"
                className="group relative overflow-hidden rounded-2xl ring-1 ring-stone-200"
              >
                <img
                  src={img}
                  alt={`Featured ${i + 1}`}
                  className="h-40 w-full object-cover transition duration-500 group-hover:scale-110 md:h-44"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
          <Link to="/gallery" className="mt-4 inline-flex text-sm font-semibold text-rose-700 hover:text-rose-800 md:hidden">
            View all →
          </Link>
        </section>
      )}

      {/* ─── About / Vision cards ─────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="flex h-full flex-col rounded-3xl bg-white p-7 shadow-sm ring-1 ring-stone-200">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <h3 className="font-serif text-xl font-bold text-stone-900">Creative practice</h3>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            My work is rooted in a love of painting, mindful composition, and gallery-style presentation. I share art that feels modern, grounded, and thoughtfully designed.
          </p>
        </div>

        <div className="flex h-full flex-col rounded-3xl bg-white p-7 shadow-sm ring-1 ring-stone-200">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
          </div>
          <h3 className="font-serif text-xl font-bold text-stone-900">Vision &amp; style</h3>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            To create a welcoming art destination where each piece feels polished, expressive, and made to evoke joy in your home or gallery wall.
          </p>
        </div>
      </section>
    </div>
  );
}

// Per-session liked images live in sessionStorage so they survive route changes
// but reset on a new browser session. One like per image per session is the rule.
const LIKED_KEY = "rekagallery.liked.v1";
function loadLikedSet() {
  try {
    const raw = typeof window !== "undefined" ? sessionStorage.getItem(LIKED_KEY) : null;
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function persistLikedSet(set) {
  try {
    sessionStorage.setItem(LIKED_KEY, JSON.stringify([...set]));
  } catch { /* quota / private mode — ignore */ }
}

export default function App() {
  const [likesMap, setLikesMap] = useState({});
  const [likedSet, setLikedSet] = useState(() => loadLikedSet());

  const handleLike = (image) => {
    if (likedSet.has(image)) return;          // already liked this image this session
    setLikesMap((prev) => ({
      ...prev,
      [image]: (prev[image] || 0) + 1,
    }));
    setLikedSet((prev) => {
      const next = new Set(prev);
      next.add(image);
      persistLikedSet(next);
      return next;
    });
  };

  // Five-word descriptions tuned to each painting (gallery only).
  const galleryDescriptions = {
    G001: "Crimson autumn path after rain",
    G002: "Snowy peaks above frozen lake",
    G003: "Forest stream cascading through autumn",
    G004: "Yorkshire terrier in pink portrait",
    G005: "Vine-draped archway in lush garden",
    G006: "Golden autumn avenue stretching far",
    G007: "Stylized Ganesha in golden grace",
    G008: "Peacock among cherry blossom branches",
    G009: "Radiant butterfly on pink burst",
    G010: "Serene Buddha amid pink lotuses",
    G011: "Radha and Krishna eternal love",
  };
  const galleryImageDetails = Object.fromEntries(
    Object.entries(galleryDescriptions).flatMap(([key, desc]) => {
      const num = key.replace("G", "");
      return [
        [`${key}.jpg`, { title: `Artwork ${num}`, description: desc }],
        [`${key}.JPG`, { title: `Artwork ${num}`, description: desc }],
      ];
    })
  );

  const pages = {
    gallery: {
      title: "Gallery",
      description: "Featured works displayed in a slightly larger format.",
      images: imageData.gallery || [],
      showDetails: true,
      imageDetails: galleryImageDetails,
    },
    beginners: {
      title: "Beginners",
      description:
        "Foundational classes focused on basic drawing, color, and painting confidence.",
      images: imageData.beginners || [],
      showDetails: false,
      imageDetails: {},
    },
    intermediate: {
      title: "Intermediate",
      description:
        "Artwork that develops stronger technique, composition, and detail.",
      images: imageData.intermediate || [],
      showDetails: false,
      imageDetails: {},
    },
    advanced: {
      title: "Advanced",
      description:
        "Detailed and polished work for students ready for more challenging projects.",
      images: imageData.advanced || [],
      showDetails: false,
      imageDetails: {},
    },
    kidsart: {
      title: "Kids Work",
      description:
        "Fun, colorful, and expressive pieces created by younger students.",
      images: imageData.kidsart || [],
      showDetails: false,
      imageDetails: {},
    },
  };

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/gallery"
            element={
              <CategoryPage
                title={pages.gallery.title}
                description={pages.gallery.description}
                images={pages.gallery.images}
                showDetails={pages.gallery.showDetails}
                imageDetails={pages.gallery.imageDetails}
                likesMap={likesMap}
                onLike={handleLike}
                likedSet={likedSet}
              />
            }
          />
          <Route
            path="/beginners"
            element={
              <CategoryPage
                title={pages.beginners.title}
                description={pages.beginners.description}
                images={pages.beginners.images}
                showDetails={pages.beginners.showDetails}
                imageDetails={pages.beginners.imageDetails}
                likesMap={likesMap}
                onLike={handleLike}
                likedSet={likedSet}
              />
            }
          />
          <Route
            path="/intermediate"
            element={
              <CategoryPage
                title={pages.intermediate.title}
                description={pages.intermediate.description}
                images={pages.intermediate.images}
                showDetails={pages.intermediate.showDetails}
                imageDetails={pages.intermediate.imageDetails}
                likesMap={likesMap}
                onLike={handleLike}
                likedSet={likedSet}
              />
            }
          />
          <Route
            path="/advanced"
            element={
              <CategoryPage
                title={pages.advanced.title}
                description={pages.advanced.description}
                images={pages.advanced.images}
                showDetails={pages.advanced.showDetails}
                imageDetails={pages.advanced.imageDetails}
                likesMap={likesMap}
                onLike={handleLike}
                likedSet={likedSet}
              />
            }
          />
          <Route
            path="/kidsart"
            element={
              <CategoryPage
                title={pages.kidsart.title}
                description={pages.kidsart.description}
                images={pages.kidsart.images}
                showDetails={pages.kidsart.showDetails}
                imageDetails={pages.kidsart.imageDetails}
                likesMap={likesMap}
                onLike={handleLike}
                likedSet={likedSet}
              />
            }
          />
          <Route path="/contact" element={<Contact />} />
          <Route path="/deploy" element={<DeployManager />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}