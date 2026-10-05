"""Minimal HTTP helper with a descriptive User-Agent, as Wikimedia asks of bots."""

from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "urna-poll-tracker/1.0 (https://github.com/danillog/urna)"
TIMEOUT = 60
RETRIES = 3


def get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            break
        except urllib.error.HTTPError as e:
            # Wikimedia answers 429 to quick runs of requests: wait as told and retry.
            if e.code != 429 or attempt == RETRIES:
                raise
            wait = e.headers.get("Retry-After", "")
            time.sleep(int(wait) if wait.isdigit() else 10 * (attempt + 1))
    # Some servers (IBGE) send gzip even when it was not asked for.
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body


def get_json(url: str, params: dict | None = None) -> dict:
    return json.loads(get(url, params))
