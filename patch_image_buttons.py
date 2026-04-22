from pathlib import Path

app_path = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site/src/App.jsx")
text = app_path.read_text(encoding="utf-8")

old = '''        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => onLike(image)}
            className="whitespace-nowrap rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100"
          >
            👍 Like {likes}
          </button>

          <button
            onClick={() => setShowComments((prev) => !prev)}
            className="whitespace-nowrap rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100"
          >
            {showComments
              ? "Hide comments"
              : `Show comments (${comments.length})`}
          </button>

          <button
            onClick={() => setShowCommentBox((prev) => !prev)}
            className="whitespace-nowrap rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100"
          >
            {showCommentBox ? "Hide Add Comment" : "Add Comment"}
          </button>
        </div>'''

new = '''        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onLike(image)}
            className="flex min-h-[40px] w-full items-center justify-center rounded-xl border border-stone-300 px-2 py-2 text-center text-[11px] font-medium text-stone-700 transition hover:bg-stone-100"
          >
            👍 Like {likes}
          </button>

          <button
            onClick={() => setShowComments((prev) => !prev)}
            className="flex min-h-[40px] w-full items-center justify-center rounded-xl border border-stone-300 px-2 py-2 text-center text-[11px] font-medium text-stone-700 transition hover:bg-stone-100"
          >
            {showComments ? "Hide Comments" : `Show Comments (${comments.length})`}
          </button>

          <button
            onClick={() => setShowCommentBox((prev) => !prev)}
            className="flex min-h-[40px] w-full items-center justify-center rounded-xl border border-stone-300 px-2 py-2 text-center text-[11px] font-medium text-stone-700 transition hover:bg-stone-100"
          >
            {showCommentBox ? "Hide Box" : "Add Comment"}
          </button>
        </div>'''

if old not in text:
    raise SystemExit("Target button block not found in src/App.jsx")

text = text.replace(old, new, 1)
app_path.write_text(text, encoding="utf-8")

print("Patched src/App.jsx successfully.")
