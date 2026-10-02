"""Minimal HTTP helper with a descriptive User-Agent, as Wikimedia asks of bots."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

USER_AGENT = "urna-poll-tracker/1.0 (https://github.com/danillog/urna)"
TIMEOUT = 60


def get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def get_json(url: str, params: dict | None = None) -> dict:
    return json.loads(get(url, params))
