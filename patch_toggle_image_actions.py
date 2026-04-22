from pathlib import Path

app_path = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site/src/App.jsx")
text = app_path.read_text(encoding="utf-8")

button_blocks = [
'''        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onLike(image)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            Like {likes}
          </button>

          <button
            onClick={() => setShowComments((prev) => !prev)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            {showComments ? `Hide (${comments.length})` : `Show (${comments.length})`}
          </button>

          <button
            onClick={() => setShowCommentBox((prev) => !prev)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            Add
          </button>
        </div>''',
'''        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onLike(image)}
            className="inline-flex min-h-[28px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            👍 <span className="ml-1">Like {likes}</span>
          </button>

          <button
            onClick={() => setShowComments((prev) => !prev)}
            className="inline-flex min-h-[28px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            {showComments ? (
              <>🙈 <span className="ml-1">Comments ({comments.length})</span></>
            ) : (
              <>👁️ <span className="ml-1">Comments ({comments.length})</span></>
            )}
          </button>

          <button
            onClick={() => setShowCommentBox((prev) => !prev)}
            className="inline-flex min-h-[28px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            {showCommentBox ? (
              <>✖ <span className="ml-1">Comment</span></>
            ) : (
              <>➕ <span className="ml-1">Comment</span></>
            )}
          </button>
        </div>''',
'''        <div className="grid grid-cols-3 gap-2">
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
        </div>''',
'''        <div className="flex items-center gap-2 overflow-x-auto">
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
]

new_block = '''        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onLike(image)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            Like {likes}
          </button>

          <button
            onClick={() => setShowComments((prev) => !prev)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            {`Toggle (${comments.length})`}
          </button>

          <button
            onClick={() => setShowCommentBox((prev) => !prev)}
            className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium leading-none text-stone-700 transition hover:bg-stone-100"
          >
            Add
          </button>
        </div>'''

replaced = False
for old in button_blocks:
    if old in text:
        text = text.replace(old, new_block, 1)
        replaced = True
        break

if not replaced:
    raise SystemExit("Could not find the image action button block in src/App.jsx")

app_path.write_text(text, encoding="utf-8")
print("Patched src/App.jsx successfully.")
