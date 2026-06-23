#!/usr/bin/env python3
"""
Inpaint-clean bundled course hole images via gpt-image-1.

Strips GolfShot "watermark" artifacts baked into curated aerial screenshots:
  - Large semi-transparent yardage number (e.g. "374") in the lower-center
  - Any remaining app UI chrome, logos, or text overlays

Routes through the deployed Vercel endpoint so no local API key is needed.
Output is saved alongside the source as <hole>-clean.jpg (preview) and then
written back to the canonical path on --apply.

Usage:
  pip3 install Pillow requests
  python3 scripts/inpaint-course-images.py --course palms
  python3 scripts/inpaint-course-images.py --course all --apply
  python3 scripts/inpaint-course-images.py --course palms --dry-run

Options:
  --course SLUG     Course folder name under assets/courses/ or "all"
  --apply           Overwrite the canonical hole-NN.jpg files in-place
  --dry-run         List files that would be processed, no API calls
  --api-url URL     Override the endpoint (default: smartplay-beta.vercel.app)
  --start-hole N    Skip holes before N (resume a partial run)
"""

import argparse
import base64
import io
import json
import sys
import time
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed.  pip3 install Pillow")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed.  pip3 install requests")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_COURSES = REPO_ROOT / "assets" / "courses"

DEFAULT_API = "https://smartplay-beta.vercel.app/api/image-edit"

INPAINT_PROMPT = (
    "This is an aerial satellite photo of a golf hole. "
    "Remove ALL baked-in text overlays, numbers, distance markers, score labels, "
    "app interface elements, logos, and watermarks from any golf app (including large "
    "semi-transparent distance numbers like '374' in the lower portion). "
    "Keep ALL natural course content exactly as-is: fairway grass, rough, bunkers, "
    "water hazards, trees, cart paths, tee boxes, and greens. "
    "Fill any removed areas with realistic natural course textures that seamlessly "
    "blend with the surrounding aerial imagery. "
    "The output must look like a clean satellite/aerial photo of a golf hole with "
    "no visible text, numbers, or app UI."
)

# Max size to send to the API (4 MB PNG limit on the endpoint)
MAX_SIDE_PX = 1024
JPEG_QUALITY = 88


def to_png_b64(jpg_path: Path) -> str:
    """Read a JPG, resize to fit MAX_SIDE_PX, return PNG base64 string."""
    with Image.open(jpg_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > MAX_SIDE_PX:
            scale = MAX_SIDE_PX / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()


def call_api(b64_png: str, api_url: str) -> str:
    """POST to the image-edit endpoint; return result b64 string."""
    payload = {"imageBase64": b64_png, "prompt": INPAINT_PROMPT}
    resp = requests.post(
        api_url,
        json=payload,
        timeout=120,
        headers={"Content-Type": "application/json"},
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"API error: {data['error']}")
    b64 = data.get("b64")
    if not b64:
        raise RuntimeError(f"No b64 in response: {data}")
    return b64


def save_result(b64_result: str, dst_path: Path) -> None:
    """Decode base64 PNG from API, save as JPEG at dst_path."""
    raw = base64.b64decode(b64_result)
    with Image.open(io.BytesIO(raw)) as img:
        img = img.convert("RGB")
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst_path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def process_course(slug: str, apply: bool, dry_run: bool, api_url: str, start_hole: int) -> int:
    course_dir = ASSETS_COURSES / slug
    if not course_dir.exists():
        print(f"  ERROR: {course_dir} does not exist")
        return 1

    images = sorted(course_dir.glob("hole-*.jpg"))
    if not images:
        print(f"  SKIP {slug}: no hole-*.jpg files found")
        return 0

    ok = err = skipped = 0
    for img_path in images:
        # Parse hole number from filename
        try:
            hole_num = int(img_path.stem.split("-")[1])
        except (IndexError, ValueError):
            hole_num = 0
        if hole_num < start_hole:
            print(f"  skip  {img_path.name} (before --start-hole {start_hole})")
            skipped += 1
            continue

        preview_path = img_path.with_suffix("").parent / (img_path.stem + "-clean.jpg")
        final_path = img_path

        if dry_run:
            print(f"  DRY   {slug}/{img_path.name}  →  {preview_path.name if not apply else final_path.name}")
            continue

        print(f"  inpaint {slug}/{img_path.name} ...", end="", flush=True)
        try:
            b64_in = to_png_b64(img_path)
            b64_out = call_api(b64_in, api_url)
            dst = final_path if apply else preview_path
            save_result(b64_out, dst)
            size_kb = dst.stat().st_size // 1024
            print(f" → {dst.name} ({size_kb} KB)  ✓")
            ok += 1
            # Brief pause to avoid hammering the endpoint
            time.sleep(1.5)
        except Exception as exc:
            print(f" ERROR: {exc}")
            err += 1

    print(f"  {slug}: {ok} ok, {err} errors, {skipped} skipped")
    return 1 if err else 0


def main() -> int:
    p = argparse.ArgumentParser(description="Inpaint GolfShot watermarks from bundled course hole images.")
    p.add_argument("--course", default="all", help="Course slug or 'all'")
    p.add_argument("--apply", action="store_true", help="Overwrite canonical hole-NN.jpg in-place (default: write -clean.jpg preview)")
    p.add_argument("--dry-run", action="store_true", help="List files only, no API calls")
    p.add_argument("--api-url", default=DEFAULT_API, help="Override API endpoint")
    p.add_argument("--start-hole", type=int, default=1, help="Skip holes before this number (resume a run)")
    args = p.parse_args()

    print(f"Endpoint: {args.api_url}")
    print(f"Apply:    {args.apply}  (dry_run={args.dry_run})")
    print()

    if args.course == "all":
        slugs = sorted(d.name for d in ASSETS_COURSES.iterdir() if d.is_dir())
    else:
        slugs = [args.course]

    total_err = 0
    for slug in slugs:
        print(f"── {slug} ──")
        rc = process_course(slug, args.apply, args.dry_run, args.api_url, args.start_hole)
        total_err += rc

    return 1 if total_err else 0


if __name__ == "__main__":
    sys.exit(main())
