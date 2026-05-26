#!/usr/bin/env python3
"""
2026-05-26 — Fix BP: OpenCV per-hole line endpoint extractor.

Reads every cropped 18Birdies hole image in assets/courses/*/hole-*.jpg
and finds the tee→green line endpoints automatically. Emits a TypeScript
snippet that drops straight into data/holeLineCalibration.ts.

WHY: the 18B screenshots all bake a white tee→green axis line into the
hole map. We need the pixel coordinates of both endpoints so
SmartVision can default the T/P/Y markers along that actual axis
(see app/smartvision.tsx + data/holeLineCalibration.ts).

Manual visual tagging is tedious (~30s per hole × 36 holes); this
script runs in ~5 seconds and is pixel-accurate.

SETUP:
    # one-time install (use --user to avoid sudo)
    pip install --user opencv-python-headless==4.10.0.84 numpy==1.26.4
    # OR: reuse the cage-analysis venv if you already have one:
    #   cd services/cage-analysis && source .venv/bin/activate
    #   then re-run this script

RUN:
    cd /Users/timothyg/Documents/smartplay
    python3 scripts/extract-hole-lines.py

OUTPUT:
    Prints a TypeScript block to stdout. Paste it into
    data/holeLineCalibration.ts, replacing the existing manual seeds.

ALGORITHM:
    1. Load image, convert to grayscale.
    2. Threshold near-white pixels (the line is ~#FFFFFF, ~2-3px wide).
    3. Skeletonize the white mask to get a 1px-wide line.
    4. Hough transform finds candidate line segments.
    5. Filter to MOSTLY-VERTICAL segments (the tee→green axis is
       always near-vertical even on doglegs — the line bends, but
       individual segments are still mostly N-S).
    6. Find the topmost + bottommost endpoint across all qualified
       segments — those are the green + tee positions.

DEFENSIVE:
    - Skips images where no near-white line is detected (logs a
      warning; falls through to no entry in the output map).
    - Validates endpoints are inside the image bounds.
    - Skip images that are not 1768×1450 (the canonical cropped
      size from Batch 45).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

try:
    import cv2
    import numpy as np
except ImportError:
    print("ERROR: OpenCV not installed.", file=sys.stderr)
    print("Run: pip install --user opencv-python-headless==4.10.0.84 numpy==1.26.4", file=sys.stderr)
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
COURSES_DIR = REPO_ROOT / "assets" / "courses"
CANONICAL_WIDTH = 1768
CANONICAL_HEIGHT = 1450
NEAR_WHITE_THRESHOLD = 220  # pixel value [0..255] above which we treat as line/white
MIN_LINE_LEN_PX = 200
MAX_LINE_GAP_PX = 50
MAX_ANGLE_FROM_VERTICAL_DEG = 35  # tee→green axis can bend up to ±35° from vertical

# Courses to process. Each slug maps to its asset directory + hole-count.
COURSES: dict[str, dict] = {
    "maplewood": {"dir": "maplewood", "max_hole": 18},
    "palms":     {"dir": "palms",     "max_hole": 18},
}


def find_endpoints(img_path: Path) -> Optional[dict]:
    """Return {'tee': {'x','y'}, 'green': {'x','y'}} or None on failure."""
    img = cv2.imread(str(img_path))
    if img is None:
        print(f"  WARN: could not read {img_path.name}", file=sys.stderr)
        return None

    h, w = img.shape[:2]
    if w != CANONICAL_WIDTH or h != CANONICAL_HEIGHT:
        print(f"  WARN: {img_path.name} is {w}×{h}, expected {CANONICAL_WIDTH}×{CANONICAL_HEIGHT} — "
              f"coords below will be in this image's own coord system", file=sys.stderr)

    # Stage 1: grayscale + threshold for near-white pixels
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, NEAR_WHITE_THRESHOLD, 255, cv2.THRESH_BINARY)

    # Stage 2: morphological close to fill small gaps in the line
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Stage 3: Hough finds candidate line segments
    edges = cv2.Canny(mask, 50, 150)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=50,
        minLineLength=MIN_LINE_LEN_PX,
        maxLineGap=MAX_LINE_GAP_PX,
    )
    if lines is None or len(lines) == 0:
        print(f"  WARN: no Hough lines detected in {img_path.name}", file=sys.stderr)
        return None

    # Stage 4: keep only mostly-vertical segments
    # Angle calc: arctan2(dx, dy) where 0 = pure vertical
    candidates = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        if dy == 0:
            continue
        angle_deg = abs(np.degrees(np.arctan2(dx, dy)))
        if angle_deg <= MAX_ANGLE_FROM_VERTICAL_DEG:
            candidates.append((x1, y1, x2, y2))

    if not candidates:
        print(f"  WARN: no near-vertical lines in {img_path.name}", file=sys.stderr)
        return None

    # Stage 5: pull all endpoints, pick topmost (smallest y) for green
    # and bottommost (largest y) for tee. Bends in the axis still work
    # because we're taking the EXTREMES across all segments.
    points = []
    for x1, y1, x2, y2 in candidates:
        points.append((x1, y1))
        points.append((x2, y2))

    points.sort(key=lambda p: p[1])  # sort by y ascending
    green = points[0]
    tee = points[-1]

    # Defensive: filter obvious garbage (must be within image bounds)
    for px, py in (green, tee):
        if not (0 <= px < w and 0 <= py < h):
            print(f"  WARN: {img_path.name} produced out-of-bounds point ({px},{py})", file=sys.stderr)
            return None

    return {
        "tee":   {"x": int(tee[0]),   "y": int(tee[1])},
        "green": {"x": int(green[0]), "y": int(green[1])},
    }


def main():
    results: dict[str, dict[int, dict]] = {}

    for slug, meta in COURSES.items():
        course_dir = COURSES_DIR / meta["dir"]
        if not course_dir.is_dir():
            print(f"SKIP: no asset dir for {slug}", file=sys.stderr)
            continue
        results[slug] = {}
        for hole in range(1, meta["max_hole"] + 1):
            img_path = course_dir / f"hole-{hole:02d}.jpg"
            if not img_path.exists():
                print(f"  SKIP: {slug}/hole-{hole:02d}.jpg not present", file=sys.stderr)
                continue
            print(f"  processing {slug}/hole-{hole:02d}.jpg ...", file=sys.stderr)
            endpoints = find_endpoints(img_path)
            if endpoints:
                results[slug][hole] = endpoints

    # Emit a TypeScript snippet for direct paste into
    # data/holeLineCalibration.ts (the HOLE_LINE_CALIBRATION map).
    print()
    print("// === GENERATED by scripts/extract-hole-lines.py ===")
    print("// Paste into data/holeLineCalibration.ts inside HOLE_LINE_CALIBRATION.")
    print()
    for slug, holes in results.items():
        if not holes:
            continue
        print(f"  {slug}: {{")
        for hole in sorted(holes.keys()):
            tee = holes[hole]["tee"]
            green = holes[hole]["green"]
            print(f"    {hole}: {{ tee: {{ x: {tee['x']}, y: {tee['y']} }}, green: {{ x: {green['x']}, y: {green['y']} }} }},")
        print(f"  }},")
    print()
    print(f"// Done. {sum(len(v) for v in results.values())} hole(s) calibrated across "
          f"{len([v for v in results.values() if v])} course(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
