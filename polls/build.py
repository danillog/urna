import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent / "raw"

POLLSTER_RULES = [
    (r"datafolha", "Datafolha"),
    (r"ipec", "Ipec"),
    (r"ibope", "Ibope"),
    (r"quaest", "Quaest"),
    (r"fsb", "FSB"),
    (r"ipespe", "Ipespe"),
    (r"ide(i)?a", "Ideia"),
    (r"futura", "Futura"),
    (r"atlas", "Atlas"),
    (r"mda", "MDA"),
    (r"paran", "Paraná Pesquisas"),
    (r"poder", "PoderData"),
    (r"real ?time", "Real Time Big Data"),
    (r"sensus", "Sensus"),
    (r"gerp", "Gerp"),
    (r"verit", "Veritá"),
    (r"brasilis", "Brasilis"),
    (r"pesquisa365", "Pesquisa365"),
    (r"ranking", "Ranking Brasil"),
    (r"vox brasil", "Vox Brasil"),
    (r"vox", "Vox Populi"),
    (r"nexus", "Nexus"),
    (r"palver", "Palver"),
    (r"indexa", "Indexa"),
    (r"neokemp", "Neokemp"),
]

ELECTIONS = {
    "2010": {"t1": "2010-10-03", "t2": "2010-10-31"},
    "2014": {"t1": "2014-10-05", "t2": "2014-10-26"},
    "2018": {"t1": "2018-10-07", "t2": "2018-10-28"},
    "2022": {"t1": "2022-10-02", "t2": "2022-10-30"},
    "2026": {"t1": "2026-10-04", "t2": "2026-10-25"},
}

RESULTS = {
    ("2010", "t1"): {"Dilma": 46.91, "Serra": 32.61, "Marina": 19.33},
    ("2010", "t2"): {"Dilma": 56.05, "Serra": 43.95},
    ("2014", "t1"): {"Dilma": 41.59, "Aécio": 33.55, "Marina": 21.32},
    ("2014", "t2"): {"Dilma": 51.64, "Aécio": 48.36},
    ("2018", "t1"): {"Bolsonaro": 46.03, "Haddad": 29.28, "Ciro": 12.47, "Alckmin": 4.76, "Marina": 1.00},
    ("2018", "t2"): {"Bolsonaro": 55.13, "Haddad": 44.87},
    ("2022", "t1"): {"Lula": 48.43, "Bolsonaro": 43.20, "Tebet": 4.16, "Ciro": 3.04},
    ("2022", "t2"): {"Lula": 50.90, "Bolsonaro": 49.10},
}

WINNERS = {
    ("2010", "t1"): "Dilma", ("2010", "t2"): "Dilma",
    ("2014", "t1"): "Dilma", ("2014", "t2"): "Dilma",
    ("2018", "t1"): "Bolsonaro", ("2018", "t2"): "Bolsonaro",
    ("2022", "t1"): "Lula", ("2022", "t2"): "Lula",
}


def norm_pollster(name: str) -> str:
    low = name.lower()
    for pattern, label in POLLSTER_RULES:
        if re.search(pattern, low):
            return label
    return name.strip()


def load(name: str) -> pd.DataFrame:
    df = pd.read_csv(RAW / name)
    df["pollster"] = df["pollster"].map(norm_pollster)
    df["date"] = pd.to_datetime(df["date"])
    return df


def finalize(df: pd.DataFrame, cands: list[str], year: str, turn: str) -> pd.DataFrame:
    start = pd.Timestamp(f"{year}-01-01")
    end = pd.Timestamp(ELECTIONS[year][turn])
    df = df[(df["date"] >= start) & (df["date"] < end)].copy()
    cols = ["pollster", "date", "n"] + [c for c in cands if c in df.columns]
    df = df[cols]
    value_cols = [c for c in cols if c not in ("pollster", "date", "n")]
    total = df[value_cols].sum(axis=1, min_count=1)
    df = df[total <= 101.5]
    df = df.drop_duplicates(subset=["pollster", "date"] + value_cols)
    df = df.drop_duplicates(subset=["pollster", "date"], keep="first")
    return df.sort_values("date").reset_index(drop=True)


def build_2022():
    t1 = load("2022_1t.csv")
    t2 = load("2022_2t.csv")
    return (
        finalize(t1, ["Lula", "Bolsonaro", "Ciro", "Tebet"], "2022", "t1"),
        finalize(t2, ["Lula", "Bolsonaro", "BNI"], "2022", "t2"),
    )


def build_2018():
    had = load("2018_1t_haddad.csv")
    lula = load("2018_1t_lula.csv")
    cutoff = pd.Timestamp("2018-09-11")
    mislabeled = (had["date"] < cutoff) & (had["Haddad"] >= 15)
    had.loc[mislabeled, "Lula"] = had.loc[mislabeled, "Haddad"]
    had.loc[mislabeled, "Haddad"] = np.nan
    lula["Haddad"] = np.nan
    lula_keys = set(zip(lula["pollster"], lula["date"]))
    had_lula_rows = had[had["Lula"].notna()]
    had_lula_rows = had_lula_rows[[k not in lula_keys for k in zip(had_lula_rows["pollster"], had_lula_rows["date"])]]
    lula_all = pd.concat([lula, had_lula_rows], ignore_index=True)
    lula_keys = set(zip(lula_all["pollster"], lula_all["date"]))
    had_rest = had[had["Lula"].isna()]
    had_rest = had_rest[[not (k in lula_keys and d < cutoff) for k, d in zip(zip(had_rest["pollster"], had_rest["date"]), had_rest["date"])]]
    combined = pd.concat([lula_all, had_rest], ignore_index=True)
    cands = ["Bolsonaro", "Lula", "Haddad", "Ciro", "Alckmin", "Marina", "BNI"]
    t1 = finalize(combined, cands, "2018", "t1")
    t2 = finalize(load("2018_2t.csv"), ["Bolsonaro", "Haddad", "BNI"], "2018", "t2")
    return t1, t2


def build_2014():
    t1 = load("2014_1t.csv")
    campos_era = t1["date"] < pd.Timestamp("2014-08-13")
    t1["Campos"] = np.where(campos_era, t1["CamposOuMarina"], np.nan)
    t1["Marina"] = np.where(~campos_era, t1["CamposOuMarina"], np.nan)
    t1 = t1.rename(columns={"Aecio": "Aécio"})
    t2 = load("2014_2t_validos.csv").rename(columns={"Aecio": "Aécio"})
    return (
        finalize(t1, ["Dilma", "Aécio", "Campos", "Marina", "BNI"], "2014", "t1"),
        finalize(t2, ["Dilma", "Aécio"], "2014", "t2"),
    )


def build_2010():
    return (
        finalize(load("2010_1t.csv"), ["Dilma", "Serra", "Marina", "BNI"], "2010", "t1"),
        finalize(load("2010_2t.csv"), ["Dilma", "Serra", "BNI"], "2010", "t2"),
    )


def build_2026():
    rows = []
    for line in (RAW / "2026_1t_named.txt").read_text().splitlines():
        if not line.strip():
            continue
        pollster, date, n, vals = line.split("|")
        kv = dict(item.split("=") for item in vals.split(";"))
        kv = {k: float(v) for k, v in kv.items()}
        lula, flavio = kv["Lula"], kv["Flavio"]
        cury = kv.get("Cury")
        bni = kv.get("BNI")
        if bni is not None:
            outros = 100 - lula - flavio - (cury or 0) - bni
        else:
            outros = kv.get("Outros")
        rows.append({"pollster": pollster, "date": date, "n": int(n) if n.isdigit() else np.nan,
                     "Lula": lula, "Flávio": flavio, "Cury": cury, "Outros": round(outros, 1) if outros is not None else np.nan, "BNI": bni})
    t1 = pd.DataFrame(rows)
    t1["pollster"] = t1["pollster"].map(norm_pollster)
    t1["date"] = pd.to_datetime(t1["date"])
    return (
        finalize(t1, ["Lula", "Flávio", "Cury", "Outros", "BNI"], "2026", "t1"),
        finalize(load("2026_2t.csv"), ["Lula", "Flávio", "BNI"], "2026", "t2"),
    )


def accuracy(df: pd.DataFrame, year: str, turn: str):
    result = RESULTS.get((year, turn))
    if not result:
        return []
    cands = [c for c in result if c in df.columns]
    end = pd.Timestamp(ELECTIONS[year][turn])
    recent = df[(df["date"] >= end - pd.Timedelta(days=10)) & (df["date"] < end)]
    recent = recent.dropna(subset=cands)
    rtot = sum(result[c] for c in cands)
    rshare = {c: result[c] / rtot * 100 for c in cands}
    top2 = sorted(cands, key=lambda c: -result[c])[:2]
    out = []
    for pollster, grp in recent.groupby("pollster"):
        row = grp.sort_values("date").iloc[-1]
        ptot = sum(row[c] for c in cands)
        pshare = {c: row[c] / ptot * 100 for c in cands}
        mae = float(np.mean([abs(pshare[c] - rshare[c]) for c in cands]))
        margin_err = abs((pshare[top2[0]] - pshare[top2[1]]) - (rshare[top2[0]] - rshare[top2[1]]))
        out.append({
            "p": pollster,
            "d": int((row["date"] - pd.Timestamp(f"{year}-01-01")).days),
            "mae": round(mae, 2),
            "margin": round(float(margin_err), 2),
            "poll": {c: round(pshare[c], 1) for c in cands},
        })
    return sorted(out, key=lambda r: r["mae"])


def smooth(days: np.ndarray, values: np.ndarray, weights: np.ndarray, grid: np.ndarray, bandwidth: float):
    fit, lo, hi = [], [], []
    for g in grid:
        k = np.exp(-0.5 * ((days - g) / bandwidth) ** 2) * weights
        if k.sum() < 1e-3 or np.sum(k > 0.05 * k.max()) < 3:
            fit.append(None)
            lo.append(None)
            hi.append(None)
            continue
        x = days - g
        w = k / k.sum()
        xm = np.sum(w * x)
        ym = np.sum(w * values)
        sxx = np.sum(w * (x - xm) ** 2)
        slope = np.sum(w * (x - xm) * (values - ym)) / sxx if sxx > 1e-6 else 0.0
        yhat = ym - slope * xm
        resid = values - (yhat + slope * x)
        sd = float(np.sqrt(np.sum(w * resid ** 2)))
        fit.append(round(float(yhat), 2))
        lo.append(round(float(yhat - sd), 2))
        hi.append(round(float(yhat + sd), 2))
    return fit, lo, hi


def series_payload(df: pd.DataFrame, year: str, turn: str):
    cands = [c for c in df.columns if c not in ("pollster", "date", "n")]
    start = df["date"].min()
    end = pd.Timestamp(ELECTIONS[year][turn])
    span = (end - start).days
    bandwidth = 14.0 if span > 120 else (5.0 if span < 40 else 9.0)
    step = 2 if span > 120 else 1
    origin = pd.Timestamp(f"{year}-01-01")
    days_all = (df["date"] - origin).dt.days.to_numpy(dtype=float)
    n = pd.to_numeric(df["n"], errors="coerce").fillna(2000).clip(500, 5000).to_numpy()
    weights = np.sqrt(n / 2000)
    pollsters = df["pollster"].to_numpy()
    crowding = np.array([
        np.sum((pollsters == pollsters[i]) & (np.abs(days_all - days_all[i]) <= 7))
        for i in range(len(df))
    ])
    weights = weights / np.sqrt(crowding)
    first_day = days_all.min()
    last_day = (end - origin).days - 1
    grid = np.arange(first_day, last_day + 1, step, dtype=float)
    if grid[-1] != last_day:
        grid = np.append(grid, last_day)
    trends = {}
    for c in cands:
        mask = df[c].notna().to_numpy()
        if mask.sum() < 3:
            continue
        d, v, w = days_all[mask], df[c].to_numpy(dtype=float)[mask], weights[mask]
        g_mask = (grid >= d.min() - 3) & (grid <= max(d.max() + 3, last_day if d.max() >= last_day - 25 else d.max() + 3))
        g = grid[g_mask]
        fit, lo, hi = smooth(d, v, w, g, bandwidth)
        trends[c] = {"d": [int(x) for x in g], "y": fit, "lo": lo, "hi": hi}
    polls = []
    for _, row in df.iterrows():
        rec = {"p": row["pollster"], "d": int((row["date"] - origin).days)}
        if pd.notna(row["n"]):
            rec["n"] = int(row["n"])
        for c in cands:
            if pd.notna(row[c]):
                rec[c] = float(row[c])
        polls.append(rec)
    return {
        "candidates": cands,
        "election_day": int((end - origin).days),
        "polls": polls,
        "trends": trends,
        "result": RESULTS.get((year, turn)),
        "winner": WINNERS.get((year, turn)),
        "accuracy": accuracy(df, year, turn),
        "valid_votes_only": year == "2014" and turn == "t2",
    }


def main():
    builders = {"2010": build_2010, "2014": build_2014, "2018": build_2018, "2022": build_2022, "2026": build_2026}
    out = {}
    for year, fn in builders.items():
        t1, t2 = fn()
        out[year] = {
            "t1": series_payload(t1, year, "t1"),
            "t2": series_payload(t2, year, "t2"),
        }
        for turn, df in (("t1", t1), ("t2", t2)):
            print(year, turn, len(df), "pesquisas", df["date"].min().date(), "->", df["date"].max().date(), sorted(df["pollster"].unique()))
    for year in out:
        for turn in out[year]:
            out[year][turn].pop("trends", None)
    (Path(__file__).parent / "data_min.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    for year in out:
        for turn in out[year]:
            for r in out[year][turn]["accuracy"][:3]:
                print("  ", year, turn, r["p"], r["mae"], r["margin"])


if __name__ == "__main__":
    main()
