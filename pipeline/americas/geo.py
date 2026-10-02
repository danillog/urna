"""Builds the Americas boundaries: states/provinces of every country, simplified.

    uv run python -m pipeline.americas.geo   # → data/generated/americas.topo.json

Source: Natural Earth (public domain), admin-1 at 1:10m, downloaded once to
data/raw/americas/geo/. Simplified with mapshaper to keep the page small.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from ..build import DATA
from ..sources.http import get

GEO_DIR = DATA / "raw" / "americas" / "geo"
OUTPUT = DATA / "generated" / "americas.topo.json"
SOURCE = "ne_10m_admin_1_states_provinces"
URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{SOURCE}.geojson"
# Share of vertices kept; enough to recognise small Caribbean states.
SIMPLIFY = "4%"
KEEP = ("adm0_a3", "iso_3166_2", "name")

# Sovereign countries of the Americas plus territories drawn in gray for context.
# Greenland is left out: it is Danish and would stretch the map to the Arctic.
COUNTRIES = [
    "ARG", "ATG", "BHS", "BLZ", "BOL", "BRA", "BRB", "CAN", "CHL", "COL", "CRI", "CUB",
    "DMA", "DOM", "ECU", "GRD", "GTM", "GUY", "HND", "HTI", "JAM", "KNA", "LCA", "MEX",
    "NIC", "PAN", "PER", "PRY", "SLV", "SUR", "TTO", "URY", "USA", "VCT", "VEN",
]  # fmt: skip
TERRITORIES = [
    "ABW", "AIA", "BLM", "BMU", "CUW", "CYM", "FLK", "MAF", "MSR", "PRI", "SPM", "SXM", "TCA", "VGB", "VIR",
]  # fmt: skip
FRENCH_GUIANA = "FR-GF"  # part of France in Natural Earth, drawn as a territory


def unwrap(coords):
    """Moves the Aleutian islands west of 180° to negative longitudes, so Alaska
    stays in one piece instead of wrapping around the globe."""
    if isinstance(coords[0], (int, float)):
        lon, lat = coords[:2]
        return [lon - 360 if lon > 0 else lon, lat]
    return [unwrap(c) for c in coords]


def main() -> int:
    path = GEO_DIR / f"{SOURCE}.geojson"
    if not path.exists():
        GEO_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(URL))
    source = json.loads(path.read_text(encoding="utf-8"))
    wanted = set(COUNTRIES) | set(TERRITORIES)
    features = []
    for f in source["features"]:
        p = f["properties"]
        if p["adm0_a3"] not in wanted and p["iso_3166_2"] != FRENCH_GUIANA:
            continue
        props = {k: p[k] for k in KEEP}
        if p["iso_3166_2"] == FRENCH_GUIANA:
            props["adm0_a3"] = "GUF"
        props["country"] = props.pop("adm0_a3")
        props["code"] = props.pop("iso_3166_2")
        if props["country"] == "USA":
            f["geometry"]["coordinates"] = unwrap(f["geometry"]["coordinates"])
        features.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "americas.geojson"
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        cmd = [
            "npx",
            "--no-install",
            "mapshaper",
            str(src),
            "-simplify",
            SIMPLIFY,
            "keep-shapes",
            "-clean",
            "-o",
            "format=topojson",
            "quantization=1e5",
            f"{OUTPUT}",
            "force",
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    size = OUTPUT.stat().st_size
    print(f"wrote {OUTPUT.relative_to(DATA.parent)} ({size / 1e6:.2f} MB, {len(features)} shapes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
