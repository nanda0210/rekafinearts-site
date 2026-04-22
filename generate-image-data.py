from pathlib import Path

project_root = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
images_root = project_root / "public" / "images"
output_file = project_root / "src" / "imageData.js"

folders = ["gallery", "advanced", "intermediate", "beginners", "kidsart"]
exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

lines = []
lines.append("export const imageData = {")

for folder in folders:
    folder_path = images_root / folder
    files = []

    if folder_path.exists():
        files = sorted(
            f"/images/{folder}/{p.name}"
            for p in folder_path.iterdir()
            if p.is_file() and p.suffix.lower() in exts
        )

    lines.append(f"  {folder}: [")
    for f in files:
        lines.append(f'    "{f}",')
    lines.append("  ],")

lines.append("};")
lines.append("")

output_file.write_text("\n".join(lines), encoding="utf-8")
print(f"Written: {output_file}")