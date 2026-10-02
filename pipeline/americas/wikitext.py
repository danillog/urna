"""Small wikitext helpers: find a template, split its parameters, strip markup."""

from __future__ import annotations

import re


def find_template(text: str, name: str, start: int = 0) -> tuple[int, int] | None:
    """Span of the first `{{name ...}}` at or after `start`, matching nested braces."""
    m = re.compile(r"\{\{\s*" + re.escape(name), re.I).search(text, start)
    if not m:
        return None
    depth, i = 0, m.start()
    while i < len(text) - 1:
        pair = text[i : i + 2]
        if pair == "{{":
            depth += 1
            i += 2
            continue
        if pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return m.start(), i
            continue
        i += 1
    return None


def template_params(block: str) -> dict[str, str]:
    """Top-level `|key = value` pairs of a template (nested templates and links kept whole)."""
    body = block[2:-2]
    parts, depth, current = [], 0, []
    i = 0
    while i < len(body):
        two = body[i : i + 2]
        if two in ("{{", "[["):
            depth += 1
            current.append(two)
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            current.append(two)
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(body[i])
        i += 1
    parts.append("".join(current))
    params = {}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            params[key.strip()] = value.strip()
    return params


def plain(value: str) -> str:
    """Readable text: links to their label, templates and refs dropped, bold removed."""
    value = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"\{\{(?:nowrap|small|nobold|ubl|plainlist)\|([^{}]*)\}\}", r"\1", value, flags=re.I)
    # {{Canadian party colour|CA|Liberal|name}} → "Liberal"
    value = re.sub(r"\{\{[^{}|]*party colou?r\|[^{}|]*\|([^{}|]*)[^{}]*\}\}", r"\1", value, flags=re.I)
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", value)
    value = re.sub(r"<br\s*/?>", " ", value)
    value = re.sub(r"<[^>]+>|'''?", "", value)
    return " ".join(value.split())


def link_target(value: str) -> str | None:
    """Article a wikilink points to: "[[Morena (political party)|Morena]]" → "Morena (political party)"."""
    m = re.search(r"\[\[([^|\]#]+)", value)
    return m.group(1).strip() if m else None
