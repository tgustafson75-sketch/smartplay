#!/usr/bin/env bash
#
# Capture a simulator screenshot that App Store Connect will actually ACCEPT.
#
# 2026-09-04 — written after ASC refused an Apple Watch screenshot produced here.
#
# `xcrun simctl io <device> screenshot` always emits PNG colortype 6 (RGBA). The alpha it writes is
# fully opaque, so the file looks perfect in Preview and every viewer — and App Store Connect
# rejects it outright, because it refuses any screenshot carrying an alpha channel. The image is
# right, the container is wrong, and looking at the image can never tell you. Cowork caught it at
# upload and flattened the file by hand; that fix belongs here, because simctl will do this every
# single time and the same constraint applies to every iPhone and iPad capture we ever take.
#
# Note `sips -s format png` does NOT help: measured, it preserves the alpha channel (colortype 6
# in, colortype 6 out). Hence strip-png-alpha.py, which re-encodes losslessly with no dependencies.
#
# Usage:
#   scripts/store/capture-store-screenshot.sh <device-udid> <output.png>
#
# Check any screenshot before uploading:
#   python3 -c "import sys;d=open(sys.argv[1],'rb').read();print('colortype',d[25],'(2=ok, 6=REJECTED)')" f.png
set -euo pipefail

DEVICE="${1:?usage: capture-store-screenshot.sh <device-udid> <output.png>}"
OUT="${2:?usage: capture-store-screenshot.sh <device-udid> <output.png>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

xcrun simctl io "$DEVICE" screenshot "$OUT" >/dev/null 2>&1
python3 "$HERE/strip-png-alpha.py" "$OUT"
