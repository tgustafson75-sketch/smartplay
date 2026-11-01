"""Render store screenshots: raw app captures in raw/01.png..08.png -> out/play/ and out/apple/.

Usage: python3 render.py <raw_dir> <out_dir>
Raw captures: take them with Caddie's Screenshot mode ON (Settings), so the phone status bar is hidden.
"""
import subprocess, sys, urllib.parse, pathlib
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
CAPTIONS = [
    ("Voice-first", "Ask out loud.|*Your caddie answers.*"),
    ("On every shot", "The club, the target|*and the miss to favor.*"),
    ("GPS yardages", "Front, middle, back.|*Plays-like included.*"),
    ("Swing analysis", "Your phone's camera|*is the swing coach.*"),
    ("No extra hardware", "No sensors. No club tags.|*Just your phone.*"),
    ("Scorecard", "Scores, handicap|*and where the strokes went.*"),
    ("Learns your game", "It remembers every round|*and gets sharper.*"),
    ("Your caddie", "Kevin, Serena,|*or build your own.*"),
]
SIZES = {"play": (1080, 1920), "apple": (1290, 2796)}

def main(raw_dir: str, out_dir: str) -> None:
    raw = sorted(pathlib.Path(raw_dir).glob("*.png")) + sorted(pathlib.Path(raw_dir).glob("*.jpg"))
    for store, (w, h) in SIZES.items():
        d = pathlib.Path(out_dir) / store
        d.mkdir(parents=True, exist_ok=True)
        for n, (img, (eyebrow, title)) in enumerate(zip(raw, CAPTIONS), 1):
            qs = urllib.parse.urlencode({"w": w, "h": h, "eyebrow": eyebrow, "title": title, "img": img.resolve().as_uri()})
            out = d / f"{n:02d}.png"
            subprocess.run(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                            "--allow-file-access-from-files", f"--window-size={w},{h}", "--virtual-time-budget=6000",
                            f"--screenshot={out}", f"{(HERE / 'frame.html').as_uri()}?{qs}"],
                           check=True, capture_output=True, timeout=90)
            Image.open(out).convert("RGB").save(out)  # App Store Connect rejects any alpha channel
            print(store, out.name)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
