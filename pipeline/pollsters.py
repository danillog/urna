"""Pollster name normalization and interview methods."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

METHODS = ("in_person", "phone", "online")


@dataclass(frozen=True)
class Pollster:
    name: str
    pattern: re.Pattern[str]
    method: str | None


class PollsterRegistry:
    def __init__(self, pollsters: list[Pollster]):
        self._pollsters = pollsters

    @classmethod
    def load(cls, path: Path) -> PollsterRegistry:
        entries = yaml.safe_load(path.read_text(encoding="utf-8"))
        pollsters = []
        for e in entries:
            method = e.get("method")
            if method is not None and method not in METHODS:
                raise ValueError(f"{path.name}: {e['name']} has unknown method {method!r}")
            pollsters.append(Pollster(e["name"], re.compile(e["match"], re.IGNORECASE), method))
        return cls(pollsters)

    def normalize(self, raw_name: str) -> str:
        """Maps a name as written by the source ("Genial/Quaest") to its canonical form."""
        for p in self._pollsters:
            if p.pattern.search(raw_name):
                return p.name
        return raw_name.strip()

    def methods(self) -> dict[str, str]:
        return {p.name: p.method for p in self._pollsters if p.method}
