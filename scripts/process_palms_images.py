"""
Batch-process Golfshot screenshots for Palms course.
Crops out browser chrome, left sidebar, bottom nav.
Removes white measurement line overlaid on aerial image.
"""

from PIL import Image
import numpy as np
from scipy.ndimage import label
import os
import shutil

SRC_DIR = r'C:\Users\tgust\Downloads\Palms Course'
DST_DIR = r'C:\Users\tgust\SmartPlayCaddie\assets\courses\palms'

# Source filename → dest filename
# None src = copy from previous hole as placeholder
FILE_MAP = [
    ('Screenshot_20260418_172038_Golfshot.jpg', 'hole-01.jpg'),
    ('Screenshot_20260418_172046_Golfshot.jpg', 'hole-02.jpg'),
    (None,                                       'hole-03.jpg'),   # placeholder = hole-02
    ('Screenshot_20260418_172104_Golfshot.jpg', 'hole-04.jpg'),
    ('Screenshot_20260418_172112_Golfshot.jpg', 'hole-05.jpg'),
    ('Screenshot_20260418_172120_Golfshot.jpg', 'hole-06.jpg'),
    ('Screenshot_20260418_172127_Golfshot.jpg', 'hole-07.jpg'),
    ('Screenshot_20260418_170554_Golfshot.jpg', 'hole-08.jpg'),
    ('Screenshot_20260418_170605_Golfshot.jpg', 'hole-09.jpg'),
    ('Screenshot_20260418_170615_Golfshot.jpg', 'hole-10.jpg'),
    ('Screenshot_20260418_170623_Golfshot.jpg', 'hole-11.jpg'),
    ('Screenshot_20260418_170631_Golfshot.jpg', 'hole-12.jpg'),
    ('Screenshot_20260418_170640_Golfshot.jpg', 'hole-13.jpg'),
    ('Screenshot_20260418_170648_Golfshot.jpg', 'hole-14.jpg'),
    ('Screenshot_20260418_170657_Golfshot.jpg', 'hole-15.jpg'),
    ('Screenshot_20260418_170705_Golfshot.jpg', 'hole-16.jpg'),
    ('Screenshot_20260418_170714_Golfshot.jpg', 'hole-17.jpg'),
    ('Screenshot_20260418_170723_Golfshot.jpg', 'hole-18.jpg'),
]

# Crop box (left, top, right, bottom) for 1768x2208 Golfshot screenshots:
#   left   = right of sidebar (aerial starts here)
#   top    = below browser chrome + ads
#   right  = excludes 'i' info button and pencil edit button
#   bottom = above Golfshot nav bar
CROP = (875, 255, 1580, 1710)

# Border margin - skip white pixels this close to the crop edge (vignette)
BORDER = 50

# White threshold for overlay detection
WHITE_THRESH = 238

# Neighborhood radius for replacement pixel sampling
REPLACE_RADIUS = 10


def remove_overlays(arr: np.ndarray) -> np.ndarray:
    """
    Remove white measurement line and yardage text from aerial image.
    Uses connected-component labeling to distinguish border vignette
    (legitimate white edges) from interior measurement overlays.
    """
    h, w = arr.shape[:2]

    r_ch = arr[:, :, 0].astype(int)
    g_ch = arr[:, :, 1].astype(int)
    b_ch = arr[:, :, 2].astype(int)

    white = (r_ch > WHITE_THRESH) & (g_ch > WHITE_THRESH) & (b_ch > WHITE_THRESH)

    # Label connected white regions
    labeled, _ = label(white)

    # Any component touching the image border = vignette, not an overlay
    border_labels: set[int] = set()
    for edge in [labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]]:
        border_labels.update(int(v) for v in np.unique(edge) if v > 0)

    # Interior white = NOT touching any border component
    interior_white = white.copy()
    for lbl in border_labels:
        interior_white[labeled == lbl] = False

    # Extra margin to avoid touching vignette fade pixels
    interior_white[:BORDER, :] = False
    interior_white[-BORDER:, :] = False
    interior_white[:, :BORDER] = False
    interior_white[:, -BORDER:] = False

    if not interior_white.any():
        return arr

    # Replace each overlay pixel with median of nearby non-white pixels
    result = arr.copy()
    ys, xs = np.where(interior_white)
    R = REPLACE_RADIUS

    for y, x in zip(ys, xs):
        y0, y1 = max(0, y - R), min(h, y + R + 1)
        x0, x1 = max(0, x - R), min(w, x + R + 1)
        patch = arr[y0:y1, x0:x1, :]
        patch_white = white[y0:y1, x0:x1]
        non_white_pixels = patch[~patch_white]
        if len(non_white_pixels) >= 4:
            result[y, x, :] = np.median(non_white_pixels, axis=0).astype(np.uint8)

    return result


def process_image(src_path: str, dst_path: str):
    print(f'  Loading {os.path.basename(src_path)} ...', end=' ', flush=True)
    img = Image.open(src_path).convert('RGB')
    arr = np.array(img)

    l, t, r, b = CROP
    cropped = arr[t:b, l:r, :].copy()
    print(f'crop {cropped.shape[1]}x{cropped.shape[0]}', end=' ', flush=True)

    cleaned = remove_overlays(cropped)
    print('cleaned', end=' ', flush=True)

    Image.fromarray(cleaned).save(dst_path, 'JPEG', quality=90)
    print('saved')


def main():
    os.makedirs(DST_DIR, exist_ok=True)
    prev_dst = None

    for src_name, dst_name in FILE_MAP:
        dst_path = os.path.join(DST_DIR, dst_name)

        if src_name is None:
            if prev_dst and os.path.exists(prev_dst):
                shutil.copy2(prev_dst, dst_path)
                print(f'  {dst_name}: placeholder (copied {os.path.basename(prev_dst)})')
            else:
                print(f'  {dst_name}: SKIP (no prev)')
            continue

        src_path = os.path.join(SRC_DIR, src_name)
        if not os.path.exists(src_path):
            print(f'  {dst_name}: MISSING {src_name}')
            continue

        print(f'Processing {dst_name}:')
        process_image(src_path, dst_path)
        prev_dst = dst_path

    print('\nAll done:', DST_DIR)


if __name__ == '__main__':
    main()
