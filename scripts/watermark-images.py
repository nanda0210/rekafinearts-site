from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    sys.stderr.write("Pillow is required. Install with: pip3 install pillow\n")
    raise

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
IMAGES_ROOT = PROJECT / "public" / "images"
BACKUP_ROOT = IMAGES_ROOT / ".watermark-backup"
WATERMARK_TEXT = "Reka Fine Arts"

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def is_image(path: Path) -> bool:
    return path.suffix.lower() in VALID_EXTS

def find_images():
    if not IMAGES_ROOT.exists():
        return []
    files = []
    for p in IMAGES_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if BACKUP_ROOT in p.parents:
            continue
        if is_image(p):
            files.append(p)
    return sorted(files)

def ensure_backup(src: Path) -> Path:
    rel = src.relative_to(IMAGES_ROOT)
    backup = BACKUP_ROOT / rel
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
      backup.write_bytes(src.read_bytes())
    return backup

def add_watermark(src: Path, dst: Path):
    with Image.open(src).convert("RGBA") as base:
        overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)

        width, height = base.size
        font_size = max(20, width // 28)

        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        x = width - text_w - max(18, width // 50)
        y = height - text_h - max(18, height // 50)

        pad_x = max(12, width // 120)
        pad_y = max(8, height // 160)

        draw.rounded_rectangle(
            (x - pad_x, y - pad_y, x + text_w + pad_x, y + text_h + pad_y),
            radius=12,
            fill=(0, 0, 0, 85),
        )
        draw.text((x, y), WATERMARK_TEXT, font=font, fill=(255, 255, 255, 155))

        merged = Image.alpha_composite(base, overlay)
        dst.parent.mkdir(parents=True, exist_ok=True)

        if dst.suffix.lower() in {".jpg", ".jpeg"}:
            merged = merged.convert("RGB")
            merged.save(dst, quality=92, optimize=True)
        else:
            merged.save(dst)

def main():
    files = find_images()
    if not files:
        print("No images found under public/images")
        return

    print(f"Found {len(files)} image(s)")
    for path in files:
        backup = ensure_backup(path)
        add_watermark(backup, path)
        print(f"Watermarked: {path.relative_to(IMAGES_ROOT)}")

if __name__ == "__main__":
    main()
