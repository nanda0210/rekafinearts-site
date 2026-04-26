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

  const { category, filename } = parseImagePath(image);

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
      setTimeout(() => setCommentStatus(""), 3000);
    } catch {
      setCommentStatus("Network error — backend may be offline");
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
              className="flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white shadow-md hover:bg-green-700 focus:outline-none"
              aria-label="Like this artwork"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" className="w-4 h-4">
                <path d="M3.172 5.172a4 4 0 0 1 5.656 0L10 6.343l1.172-1.171a4 4 0 1 1 5.656 5.656l-6.364 6.364a.75.75 0 0 1-1.06 0L3.172 10.83a4 4 0 0 1 0-5.656z" />
              </svg>
              <span>{likes}</span>
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
  const heroImage = "/images/hero-open/H001.JPG";
    return (
      <div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex h-full flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <h3 className="text-xl font-semibold text-stone-800">
              Creative practice
            </h3>
            <p className="mt-4 text-sm leading-8 text-stone-600">
              My work is rooted in a love of painting, mindful composition, and gallery-style presentation. I share art that feels modern, grounded, and thoughtfully designed.
            </p>
          </div>

          <div className="flex h-full flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <h3 className="text-xl font-semibold text-stone-800">
              Vision & style
            </h3>
            <p className="mt-4 text-sm leading-8 text-stone-600">
              To create a welcoming art destination where each piece feels polished, expressive, and made to evoke joy in your home or gallery wall.
            </p>
          </div>
        </div>
      </div>
    );
}

export default function App() {
  const [likesMap, setLikesMap] = useState({});

  const handleLike = (image) => {
    setLikesMap((prev) => ({
      ...prev,
      [image]: (prev[image] || 0) + 1,
    }));
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