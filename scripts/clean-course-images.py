#!/usr/bin/env python3
"""
2026-06-04 — Course imagery processor.

Pattern follows the Python/PIL crop step used for Sunnyvale (data/localCourseImages.ts
line 410 comment). Pillow is the only dependency.

Currently processes:
  - Echo Hills (Hemet, CA) — 9-hole course, raw Golfshot screenshots
    in ~/Downloads/echohills/7635-7643.jpg → assets/courses/echo-hills/hole-01..09.jpg

Crop values per source — VERIFIED against actual file pixel dims, not
spec assumptions. See visual-inspection notes per course below.

Usage:
  python3 scripts/clean-course-images.py                # process all
  python3 scripts/clean-course-images.py --dry-run      # preview crops
  python3 scripts/clean-course-images.py --course echo-hills
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Install with: pip3 install Pillow")
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = Path.home() / "Downloads"


# Echo Hills (Hemet CA) — raw Golfshot screenshots, 1768x1976 portrait.
# Visual layout (confirmed against 7635.jpg):
#   - Top 0-165px: status bar + "TOP LIVE HOT STREAMERS" ad
#   - Left 0-460px: yardage sidebar (Hole / Back Edge / Green Center /
#                   Front Edge / Par / Get Pro!)
#   - Bottom 1830-1976: blue nav bar (Holes / Preview / Track)
#   - Right: aerial extends to edge; pencil icon (~1660,1780) +
#            info "i" (~1700,180) remain as small floating chrome
#            (acceptable for beta)
# Crop output: 1308 x 1660 — aerial hole image with baked-in tee→green
# line + Green Center yardage bubble (calibration reference, intentional).
ECHO_HILLS = {
    "src_dir": DOWNLOADS / "echohills",
    "dst_dir": REPO_ROOT / "assets" / "courses" / "echo-hills",
    "src_to_hole": {
        "7635.jpg": 1, "7636.jpg": 2, "7637.jpg": 3,
        "7638.jpg": 4, "7639.jpg": 5, "7640.jpg": 6,
        "7641.jpg": 7, "7642.jpg": 8, "7643.jpg": 9,
    },
    "crop_box": (460, 170, 1768, 1750),  # (left, upper, right, lower) — tightened past the blue nav bar entirely
    "expected_src_dims": (1768, 1976),
}


def process_echo_hills(dry_run: bool) -> int:
    src_dir = ECHO_HILLS["src_dir"]
    dst_dir = ECHO_HILLS["dst_dir"]
    crop_box = ECHO_HILLS["crop_box"]
    expected_dims = ECHO_HILLS["expected_src_dims"]

    if not src_dir.exists():
        print(f"ERROR: Echo Hills source dir not found: {src_dir}")
        return 1

    if not dry_run:
        dst_dir.mkdir(parents=True, exist_ok=True)

    processed = 0
    skipped = 0
    for src_name, hole_num in sorted(ECHO_HILLS["src_to_hole"].items(), key=lambda x: x[1]):
        src_path = src_dir / src_name
        dst_path = dst_dir / f"hole-{hole_num:02d}.jpg"

        if not src_path.exists():
            print(f"  SKIP hole {hole_num:02d}: source missing ({src_name})")
            skipped += 1
            continue

        with Image.open(src_path) as img:
            actual_dims = img.size
            if actual_dims != expected_dims:
                print(f"  WARN  hole {hole_num:02d}: source dims {actual_dims} != expected {expected_dims}")
            cropped = img.crop(crop_box)
            out_dims = cropped.size
            if dry_run:
                print(f"  DRY   hole-{hole_num:02d}.jpg: {actual_dims} crop {crop_box} → {out_dims}")
            else:
                cropped.save(dst_path, "JPEG", quality=88, optimize=True)
                size_kb = dst_path.stat().st_size // 1024
                print(f"  WRITE hole-{hole_num:02d}.jpg: {actual_dims} → {out_dims} ({size_kb} KB)")
        processed += 1

    print(f"\nEcho Hills: {processed} processed, {skipped} skipped (dry_run={dry_run})")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Course imagery processor.")
    p.add_argument("--dry-run", action="store_true", help="Preview crops without writing files")
    p.add_argument("--course", choices=["echo-hills", "all"], default="all", help="Course to process")
    args = p.parse_args()

    print(f"REPO_ROOT: {REPO_ROOT}")
    print(f"DOWNLOADS: {DOWNLOADS}")
    print(f"dry_run:   {args.dry_run}")
    print()

    if args.course in ("echo-hills", "all"):
        rc = process_echo_hills(args.dry_run)
        if rc != 0:
            return rc

    return 0


if __name__ == "__main__":
    sys.exit(main())
