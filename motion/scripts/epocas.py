"""HDI then and now, and food insecurity, for the motion "Epocas" (motion/src/epocas).

    uv run python motion/scripts/epocas.py     (from the repository root)

Writes motion/data/epocas.json:
- countries: every country of data/generated/americas.json with an HDI in 1990 and 2023
  (UNDP, HDR 2025 composite indices time series, cached by pipeline.americas.indicators)
  and its latest FAO food insecurity (moderate or severe, 3-year average at its centre year).
- twins: for each Latin American and Caribbean country, the country of the Americas whose
  2023 HDI is closest to its own 1990 HDI ("o Brasil de 1990 tinha o IDH que X tem hoje").
- pairs: countries with nearly the same 2023 HDI (within 0.015) and the widest gaps in food
  insecurity, each country used once.
- correlation: Pearson's r between HDI 2023 and food insecurity, over the countries with both.
"""

from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "americas" / "indicators" / "hdi.csv"
GEN = ROOT / "data" / "generated"
OUT = ROOT / "motion" / "data" / "epocas.json"
THEN, NOW = 1990, 2023
NORTH = {"USA", "CAN"}
TWIN_GAP = 0.015


def main() -> None:
    names = {k: v["name"] for k, v in json.loads((GEN / "americas.json").read_text())["countries"].items()}
    ind = json.loads((GEN / "americas-indicators.json").read_text())
    first = ind["firstYear"]
    food = ind["indicators"]["food"]

    def latest_food(iso: str) -> tuple[int, float] | None:
        series = food["values"].get(iso)
        if not series:
            return None
        for y in range(food["lastYear"], first - 1, -1):
            v = series[y - first] if y - first < len(series) else None
            if v is not None:
                return y, v
        return None

    countries = []
    with RAW.open(encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            iso = r["iso3"]
            if iso not in names or not r[f"hdi_{THEN}"] or not r[f"hdi_{NOW}"]:
                continue
            fi = latest_food(iso)
            countries.append(
                {
                    "iso": iso,
                    "name": names[iso],
                    "then": float(r[f"hdi_{THEN}"]),
                    "now": float(r[f"hdi_{NOW}"]),
                    "food": fi[1] if fi else None,
                    "foodYear": fi[0] if fi else None,
                }
            )
    countries.sort(key=lambda c: -c["now"])

    twins = []
    for c in countries:
        if c["iso"] in NORTH:
            continue
        twin = min((o for o in countries if o["iso"] != c["iso"]), key=lambda o: abs(o["now"] - c["then"]))
        twins.append(
            {
                "iso": c["iso"],
                "name": c["name"],
                "then": c["then"],
                "now": c["now"],
                "gain": round(c["now"] - c["then"], 3),
                "twin": twin["iso"],
                "twinName": twin["name"],
                "twinNow": twin["now"],
            }
        )
    twins.sort(key=lambda t: -t["gain"])
    # For the video: Brazil, then the biggest gains whose 1990 HDI has a real match today
    # (within 0.02: a 1990 HDI below every country's today has none) and a twin not used yet.
    picks: list[dict] = [t for t in twins if t["iso"] == "BRA"]
    for t in twins:
        if len(picks) >= 4:
            break
        close = abs(t["then"] - t["twinNow"]) <= 0.02
        if close and t["iso"] != "BRA" and t["twin"] not in {p["twin"] for p in picks}:
            picks.append(t)

    both = [c for c in countries if c["food"] is not None]
    candidates = sorted(
        (
            (abs(a["food"] - b["food"]), a, b)
            for i, a in enumerate(both)
            for b in both[i + 1 :]
            if abs(a["now"] - b["now"]) <= TWIN_GAP
        ),
        key=lambda t: -t[0],
    )
    used: set[str] = set()
    pairs = []
    for gap, a, b in candidates:
        if a["iso"] in used or b["iso"] in used:
            continue
        low, high = sorted((a, b), key=lambda c: c["food"])
        pairs.append({"low": low["iso"], "high": high["iso"], "gap": round(gap, 1)})
        used |= {a["iso"], b["iso"]}

    xs = [c["now"] for c in both]
    ys = [c["food"] for c in both]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    r = (
        sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
        / (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) ** 0.5
    )

    out = {
        "then": THEN,
        "now": NOW,
        "countries": countries,
        "twins": twins,
        "picks": [p["iso"] for p in picks],
        "pairs": pairs,
        "correlation": round(r, 2),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("picks", [(p["name"], p["twinName"]) for p in picks])
    for t in twins[:8]:
        jump = f"{t['then']:.3f} → {t['now']:.3f} (+{t['gain']:.3f})"
        print(f"  {t['name']:22} {jump}; 1990 = {t['twinName']} hoje ({t['twinNow']:.3f})")
    for p in pairs[:6]:
        a = next(c for c in countries if c["iso"] == p["low"])
        b = next(c for c in countries if c["iso"] == p["high"])
        print(f"  {a['name']} {a['now']:.3f} {a['food']}% × {b['name']} {b['now']:.3f} {b['food']}%")
    print("r =", round(r, 2), len(both), "countries")


if __name__ == "__main__":
    main()
