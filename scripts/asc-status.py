#!/usr/bin/env python3
"""
2026-08-30 — Ask App Store Connect what it actually thinks, instead of asking Tim.

WHY THIS EXISTS. Build 17 uploaded and Apple rejected it in PROCESSING for two missing-icon errors.
Nothing on this machine could see that: `eas build:view` reports the BUILD, not what Apple did with
it afterwards, this eas-cli has no submissions command, and the Expo submission page is behind a
login. So the only way to learn the reason was Tim opening a browser and pasting a screenshot — a
round trip through a person for a fact a machine already knew.

App Store Connect processing is a REAL GATE, separate from compiling. A build can be green locally,
green on EAS, correctly signed, and still be refused — the missing watch AppIcon was invisible to
every compiler and only appeared here. This closes that blind spot.

CREDENTIALS. Uses the Admin ASC API key already on disk. The .p8 is read only to sign a short-lived
ES256 JWT and is never printed, logged or copied. Key id and issuer id are identifiers, not secrets.
Read-only: this script only ever GETs.

USAGE
    scripts/asc-status.py                 # TestFlight builds + processing state
    scripts/asc-status.py --build 18      # one build, with any processing errors
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

KEY_ID = os.environ.get("ASC_KEY_ID", "7QX87CPVLN")
ISSUER_ID = os.environ.get("ASC_ISSUER_ID", "2c1db033-cfd8-4bfa-9f89-6fb66aec297e")
KEY_PATH = os.environ.get(
    "ASC_KEY_PATH",
    "/Users/timothyg/Downloads/Credentials (SENSITIVE)/AuthKey_7QX87CPVLN.p8",
)
APP_ID = os.environ.get("ASC_APP_ID", "6772344465")
BASE = "https://api.appstoreconnect.apple.com/v1"


def token() -> str:
    """A 15-minute ES256 JWT. Apple caps the lifetime at 20 minutes."""
    try:
        import jwt  # PyJWT, from the scratchpad venv
    except ImportError:
        sys.exit(
            "PyJWT is not installed for this interpreter.\n"
            "Run with the venv, e.g.\n"
            "  <scratchpad>/ascvenv/bin/python scripts/asc-status.py"
        )
    try:
        with open(KEY_PATH, "r") as fh:
            private_key = fh.read()
    except OSError as e:
        sys.exit(f"Cannot read the ASC key at {KEY_PATH}: {e}")
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER_ID, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": KEY_ID, "typ": "JWT"},
    )


def get(path: str, params: dict | None = None) -> dict:
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        # 401/403 here almost always means the KEY'S ROLE, not a bad token — the same lesson as
        # 28SPKAV696, which authenticated fine and still could not create a provisioning profile.
        sys.exit(f"App Store Connect returned {e.code}.\n{body}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", help="a specific build number, e.g. 18")
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    params = {
        "filter[app]": APP_ID,
        "limit": str(args.limit),
        "sort": "-version",
        "fields[builds]": "version,processingState,uploadedDate,expired",
    }
    if args.build:
        params["filter[version]"] = args.build

    data = get("/builds", params)
    builds = data.get("data", [])
    if not builds:
        print("No builds found. If one was just submitted, Apple can take a few minutes to show it.")
        return

    for b in builds:
        a = b.get("attributes", {})
        state = a.get("processingState")
        print(f"build {a.get('version')}: {state}   uploaded {a.get('uploadedDate')}")
        # VALID means TestFlight-ready. FAILED means Apple refused it after upload — the case that
        # cost a browser round trip on build 17.
        if state == "FAILED":
            detail = get(f"/builds/{b['id']}", {"fields[builds]": "processingState"})
            print("   FAILED — open the build in App Store Connect for Apple's reason:")
            print(f"   https://appstoreconnect.apple.com/apps/{APP_ID}/testflight/ios")
            print(f"   {json.dumps(detail.get('data', {}).get('attributes', {}))[:300]}")


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (kept local; only needed inside get())

    main()
