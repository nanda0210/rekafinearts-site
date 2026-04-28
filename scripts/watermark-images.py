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

# Folders whose images are intentionally NOT watermarked (e.g., homepage hero).
SKIP_DIRS = {"hero-open"}

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def is_image(path: Path) -> bool:
    return path.suffix.lower() in VALID_EXTS

def in_skip_dir(path: Path) -> bool:
    rel_parts = path.relative_to(IMAGES_ROOT).parts
    return any(part in SKIP_DIRS for part in rel_parts)

def find_images():
    if not IMAGES_ROOT.exists():
        return []
    files = []
    for p in IMAGES_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if BACKUP_ROOT in p.parents:
            continue
        if in_skip_dir(p):
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

def _load_font(size: int):
    for path in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def _make_tiled_diagonal_layer(width: int, height: int, text: str, angle_deg: int, alpha: int):
    """Tile `text` across the image at a diagonal angle so it covers everything.
    Anyone cropping or right-clicking sees the brand text running across whatever
    region they grab — classic anti-theft pattern."""
    # Font scaled larger so it survives downscaling in browsers/thumbnails.
    longest = max(width, height)
    font_size = max(32, longest // 12)
    font = _load_font(font_size)

    # Measure one tile.
    tmp = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    bbox = ImageDraw.Draw(tmp).textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Spacing between repetitions.
    gap_x = int(tw * 0.4)
    gap_y = int(th * 2.5)
    cell_w = tw + gap_x
    cell_h = th + gap_y

    # Big oversized canvas so rotation has room without clipping.
    over = int(((width**2 + height**2) ** 0.5) * 1.3)
    tile = Image.new("RGBA", (over, over), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)

    # Use a thick white halo around dark text so it pops on every part of the
    # artwork — bright sky, dark forest, mid-tone background — without ever
    # disappearing.
    text_color = (20, 20, 20, alpha)
    halo_color = (255, 255, 255, min(255, alpha + 60))
    halo = max(2, font_size // 18)

    rows = over // cell_h + 2
    cols = over // cell_w + 2
    for row in range(rows):
        x_offset = (row % 2) * (cell_w // 2)
        for col in range(cols):
            x = col * cell_w + x_offset
            y = row * cell_h
            # halo (thicker, ringing the text)
            for dx in range(-halo, halo + 1):
                for dy in range(-halo, halo + 1):
                    if dx == 0 and dy == 0: continue
                    tile_draw.text((x + dx, y + dy), text, font=font, fill=halo_color)
            tile_draw.text((x, y), text, font=font, fill=text_color)

    rotated = tile.rotate(angle_deg, resample=Image.BICUBIC)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    cx = (rotated.width  - width)  // 2
    cy = (rotated.height - height) // 2
    cropped = rotated.crop((cx, cy, cx + width, cy + height))
    canvas.paste(cropped, (0, 0), cropped)
    return canvas

def add_watermark(src: Path, dst: Path):
    with Image.open(src).convert("RGBA") as base:
        width, height = base.size
        overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))

        # ── Tiled diagonal "Reka Fine Arts" pattern (light, faded) ──
        # Repeats the brand text across the entire image at -30°. Anyone who
        # right-clicks/screenshots/crops gets a piece with the watermark in it.
        # Alpha kept moderate so the original art still reads clearly.
        FAINT_ALPHA = 110  # ~43% — visible across the image, art still readable
        tiled = _make_tiled_diagonal_layer(width, height, WATERMARK_TEXT, -30, FAINT_ALPHA)
        overlay = Image.alpha_composite(overlay, tiled)

        # ── Corner brand pill (kept; small, more opaque, the "official mark") ──
        draw = ImageDraw.Draw(overlay)
        corner_size = max(20, width // 28)
        corner_font = _load_font(corner_size)
        cb = draw.textbbox((0, 0), WATERMARK_TEXT, font=corner_font)
        ctw = cb[2] - cb[0]
        cth = cb[3] - cb[1]
        cx = width  - ctw - max(18, width  // 50)
        cy = height - cth - max(18, height // 50)
        cpx = max(12, width  // 120)
        cpy = max(8,  height // 160)
        draw.rounded_rectangle(
            (cx - cpx, cy - cpy, cx + ctw + cpx, cy + cth + cpy),
            radius=12,
            fill=(0, 0, 0, 90),
        )
        draw.text((cx, cy), WATERMARK_TEXT, font=corner_font, fill=(255, 255, 255, 170))

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
