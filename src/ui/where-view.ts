import { geoMercator } from "d3-geo";

import { escapeHtml, integer } from "../format";
import { t } from "../i18n/pt-BR";
import {
  AREA_VARS,
  CAPITAL_RELIGION,
  CAPITAL_SLUGS,
  COMMUTE,
  HOME,
  areaDeciles,
  areaValue,
  atLevel,
  isApprox,
  capitalObject,
  cityValue,
  fromSample,
  giniRank,
  inBand,
  levelsOf,
  namedLevel,
  ranking,
  unitNames,
  type Area,
  type Band,
  type Capital,
  type CapitalLevel,
  type CapitalMeta,
  type CapitalsData,
  type Ranked,
} from "../model/capitals";
import { COLOUR, SCHOOLING, type CensusVar } from "../model/census-vote";
import { byId } from "./dom";
import { ChoroplethMap } from "./map";
import { decileLegend } from "./scatter";
import { sourcesHtml } from "./sources";

/** Parts of the city along a variable, in its tenths of the population (from, to). */
export type BandKey = "low" | "high" | "bottom" | "top";
const BANDS: Record<BandKey, [number, number]> = { low: [0, 4], high: [5, 9], bottom: [0, 1], top: [8, 9] };
export const BAND_KEYS = Object.keys(BANDS) as BandKey[];

/** What the tab shows: a capital, how it is cut (null: its most familiar names), one
 * variable, the part of the city kept (null: all of it), and the unit whose card is open. */
export interface WhereState {
  capital: string;
  level: CapitalLevel | null;
  v: CensusVar;
  filter: { v: CensusVar; band: BandKey } | null;
  pick: string | null;
}

export function bandOf(filter: WhereState["filter"]): Band | null {
  if (!filter) return null;
  const [from, to] = BANDS[filter.band];
  return { v: filter.v, from, to };
}

/** The chips, in the order a reader asks: who the people are, money, school, work, the home,
 * faith, colour. */
export const WHERE_GROUPS: [keyof typeof t.census.where.groups, CensusVar[]][] = [
  ["people", ["elderly", "negro", "sameSex", "migrant"]],
  ["money", ["income", "incomeMedian", "incomeRatio"]],
  ["school", ["degree", "eduBasic", "schoolYears", "illiterate"]],
  ["work", ["unemployed", ...COMMUTE, "commuteLong"]],
  ["home", HOME],
  ["faith", ["evangelical", "catholic", "noReligion", "spiritist", "afro"]],
  ["colour", COLOUR],
];
export const WHERE_VARS: CensusVar[] = WHERE_GROUPS.flatMap(([, vs]) => vs);
export const DEFAULT_WHERE_VAR: CensusVar = "elderly";

/** The address: ?view=where&capital=3550308&nivel=bairros&var=negros&lugar=<id>. */
const VAR_SLUGS: Partial<Record<CensusVar, string>> = {
  elderly: "idosos",
  negro: "negros",
  sameSex: "casais-mesmo-sexo",
  income: "renda",
  incomeMedian: "renda-mediana",
  degree: "superior",
  eduBasic: "ate-fundamental-incompleto",
  evangelical: "evangelicos",
  catholic: "catolicos",
  noReligion: "sem-religiao",
  white: "brancos",
  black: "pretos",
  brown: "pardos",
  asian: "amarelos",
  indigenous: "indigenas",
  illiterate: "analfabetismo",
  ...CAPITAL_SLUGS,
};
const BAND_SLUGS: Record<BandKey, string> = {
  low: "metade-menos",
  high: "metade-mais",
  bottom: "quinto-menos",
  top: "quinto-mais",
};
const LEVEL_SLUGS: Record<CapitalLevel, string> = {
  areas: "areas",
  bairros: "bairros",
  regions: "regioes",
  districts: "distritos",
  subprefeituras: "subprefeituras",
};
const DEFAULT_CAPITAL = "3550308"; // São Paulo

const varOf = (slug: string | null) => WHERE_VARS.find((v) => VAR_SLUGS[v] === slug);

export function whereFromSearch(data: CapitalsData, params: URLSearchParams): WhereState {
  const asked = params.get("capital");
  const has = (c: string | null) => data.capitals.some((x) => x.code === c);
  const filterVar = varOf(params.get("filtro"));
  const band = BAND_KEYS.find((b) => BAND_SLUGS[b] === params.get("faixa"));
  return {
    capital: has(asked) ? asked! : has(DEFAULT_CAPITAL) ? DEFAULT_CAPITAL : data.capitals[0]!.code,
    level:
      (Object.keys(LEVEL_SLUGS) as CapitalLevel[]).find((l) => LEVEL_SLUGS[l] === params.get("nivel")) ??
      null,
    v: varOf(params.get("var")) ?? DEFAULT_WHERE_VAR,
    filter: filterVar && band ? { v: filterVar, band } : null,
    pick: params.get("lugar"),
  };
}

export function whereToSearch(s: WhereState, params: URLSearchParams): void {
  if (s.capital !== DEFAULT_CAPITAL) params.set("capital", s.capital);
  if (s.level) params.set("nivel", LEVEL_SLUGS[s.level]);
  if (s.v !== DEFAULT_WHERE_VAR) params.set("var", VAR_SLUGS[s.v]!);
  if (s.filter) {
    params.set("filtro", VAR_SLUGS[s.filter.v]!);
    params.set("faixa", BAND_SLUGS[s.filter.band]);
  }
  if (s.pick) params.set("lugar", s.pick);
}

/** Links made while this lived in the Voto e Censo tab (?view=census&onde-var=negros…), in
 * this tab's words; null when the address has none of them. */
export function fromCensusLink(params: URLSearchParams): URLSearchParams | null {
  const keys: [string, string][] = [
    ["onde", "capital"],
    ["onde-nivel", "nivel"],
    ["onde-var", "var"],
    ["onde-lugar", "lugar"],
  ];
  if (!keys.some(([old]) => params.has(old))) return null;
  const out = new URLSearchParams({ view: "where" });
  for (const [old, now] of keys) if (params.has(old)) out.set(now, params.get(old)!);
  return out;
}

/** Names in each end of the list. */
const TOP = 10;
/** The filter's variable until one is picked: where the money is. */
const DEFAULT_FILTER_VAR: CensusVar = "income";

/** Every variable of a unit's card, grouped as the census publishes them. */
const PROFILE: [string, CensusVar[]][] = [
  [t.census.varGroups.age, ["elderly"]],
  [t.census.varGroups.colour, [...COLOUR, "negro"]],
  [t.census.varGroups.income, ["income", "incomeMedian", "incomeRatio"]],
  [t.census.varGroups.schooling, [...SCHOOLING, "schoolYears", "illiterate"]],
  [t.census.varGroups.work, ["unemployed"]],
  [t.census.varGroups.commute, [...COMMUTE, "commuteLong"]],
  [t.census.varGroups.home, HOME],
  [t.census.varGroups.religion, CAPITAL_RELIGION],
  [t.census.varGroups.origin, ["migrant"]],
  [t.census.varGroups.couples, ["sameSex"]],
];
const INCOME: CensusVar[] = ["income", "incomeMedian", "incomeRatio"];

/** The "Quem mora onde" tab: one census variable at a time inside a capital, as a map over
 * the streets and a ranking. */
export class WhereView {
  private readonly maps = new Map<string, { host: HTMLElement; map: ChoroplethMap; ids: string[] }>();
  private shown: string | null = null;
  /** Each unit's short and full name; numbered where the IBGE gives none. */
  private short = new Map<string, string>();
  private full = new Map<string, string>();
  /** A place was just picked by hand: its card is brought into view once drawn. */
  private reveal = false;
  /** The unit whose card is open: it stays forward on the map when nothing else is hovered. */
  private picked: string | null = null;

  constructor(
    private readonly data: CapitalsData,
    private readonly loadCapital: (code: string) => Promise<Capital>,
    private readonly peekCapital: (code: string) => Capital | undefined,
    private state: WhereState,
    private readonly onChange: () => void,
  ) {
    const onPick = (patch: Partial<WhereState>) => this.set(patch);
    const select = byId<HTMLSelectElement>("wh-capital");
    [...data.capitals]
      .sort((a, b) => a.name.localeCompare(b.name, t.locale))
      .forEach((c) => select.add(new Option(`${c.name} (${c.uf})`, c.code)));
    select.addEventListener("change", () => onPick({ capital: select.value, level: null, pick: null }));
    byId("wh-level")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => onPick({ level: b.dataset.level as CapitalLevel, pick: null })),
      );
    byId("wh-vars").innerHTML = WHERE_GROUPS.map(
      ([g, vs]) =>
        `<div class="wh-group"><span class="group-label">${escapeHtml(t.census.where.groups[g])}</span><div class="chips">` +
        vs
          .map(
            (v) =>
              `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${escapeHtml(t.census.where.chip[v] ?? t.census.vars[v]!)}</button>`,
          )
          .join("") +
        `</div></div>`,
    ).join("");
    byId("wh-vars").addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("[data-v]")?.dataset.v;
      if (v) onPick({ v: v as CensusVar });
    });
    // The filter: a part of the city (a band) along a variable of its own.
    const band = byId<HTMLSelectElement>("wh-band");
    band.add(new Option(t.census.where.filter.none, ""));
    for (const b of BAND_KEYS) band.add(new Option(t.census.where.filter.bands[b]!, b));
    const filterVar = byId<HTMLSelectElement>("wh-filter-var");
    for (const [g, vs] of WHERE_GROUPS) {
      const group = document.createElement("optgroup");
      group.label = t.census.where.groups[g];
      for (const v of vs) group.append(new Option(t.census.vars[v]!, v));
      filterVar.append(group);
    }
    filterVar.value = DEFAULT_FILTER_VAR;
    const setFilter = () =>
      onPick({
        filter: band.value ? { v: filterVar.value as CensusVar, band: band.value as BandKey } : null,
        pick: null,
      });
    band.addEventListener("change", setFilter);
    filterVar.addEventListener("change", setFilter);
    // The list: hovering a name finds it on the map; clicking opens its card.
    const list = byId("wh-rank");
    list.addEventListener("pointerover", (e) => this.focus(this.rowId(e)));
    list.addEventListener("focusin", (e) => this.focus(this.rowId(e)));
    list.addEventListener("pointerleave", () => this.focus(null));
    list.addEventListener("focusout", () => this.focus(null));
    list.addEventListener("click", (e) => {
      const id = this.rowId(e);
      if (id) this.pick(id);
    });
    byId("wh-zoom-in").addEventListener("click", () => this.map?.zoomIn());
    byId("wh-zoom-out").addEventListener("click", () => this.map?.zoomOut());
    byId("wh-zoom-reset").addEventListener("click", () => this.map?.fit(null));
    byId("wh-card").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-close]")) onPick({ pick: null });
    });
  }

  get current(): WhereState {
    return this.state;
  }

  private set(patch: Partial<WhereState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }

  private pick(id: string): void {
    this.reveal = true;
    this.set({ pick: id });
  }

  private rowId(e: Event): string | null {
    return (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id ?? null;
  }

  private get map(): ChoroplethMap | undefined {
    return this.shown ? this.maps.get(this.shown)?.map : undefined;
  }

  /** Brings one unit forward on the map; none hovered, the one whose card is open. */
  private focus(id: string | null): void {
    const entry = this.shown ? this.maps.get(this.shown) : undefined;
    if (!entry) return;
    const want = id ?? this.picked;
    const i = want ? entry.ids.indexOf(want) : -1;
    entry.map.highlight(i >= 0 ? [i] : null);
  }

  render(): void {
    const view = this.state;
    const meta: CapitalMeta = this.data.capitals.find((c) => c.code === view.capital)!;
    const loaded = this.peekCapital(meta.code);
    byId<HTMLSelectElement>("wh-capital").value = meta.code;
    if (!loaded) {
      byId("wh-meta").textContent = t.loading;
      void this.loadCapital(meta.code).then(
        () => this.state.capital === meta.code && this.render(),
        () => (byId("wh-meta").textContent = t.loadFailed),
      );
      return;
    }
    const levels = levelsOf(loaded);
    const level = view.level && levels.includes(view.level) ? view.level : namedLevel(loaded);
    const capital = atLevel(loaded, level);
    const v = view.v;
    this.short = unitNames(capital.areas, t.census.where.unnamed, t.census.where.part);
    this.full = new Map(
      capital.areas.map((a) => {
        const short = this.short.get(a.id)!;
        // Several names: the most populous ones; one, numbered like the short name.
        return [a.id, a.bairros.length > 1 ? t.census.capital.area(a.bairros) : short];
      }),
    );
    const unnamed = capital.areas.every((a) => !a.bairros.length);

    byId("wh-level-group").hidden = levels.length < 2;
    byId("wh-level")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.hidden = !levels.includes(b.dataset.level as CapitalLevel);
        b.setAttribute("aria-pressed", String(b.dataset.level === level));
        if (b.dataset.level === "bairros")
          b.textContent = t.census.capital.level[isApprox(loaded, "bairros") ? "bairrosApprox" : "bairros"]!;
      });
    byId("wh-vars")
      .querySelectorAll<HTMLButtonElement>("[data-v]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    byId<HTMLSelectElement>("wh-band").value = view.filter?.band ?? "";
    const filterVar = byId<HTMLSelectElement>("wh-filter-var");
    if (view.filter) filterVar.value = view.filter.v;
    filterVar.disabled = !view.filter;

    // The filter keeps some units in the list and on the map; the tenths, the city's figure and
    // each card stay those of the whole city.
    const keep = inBand(capital.areas, bandOf(view.filter));
    const kept = capital.areas.filter(keep);
    const ranked = ranking(kept, v);
    const city = cityValue(capital.areas, v);
    const fmt = (x: number) => t.census.format(v, x);
    byId("wh-title").textContent = t.census.where.title(capital.name, t.census.vars[v]!, level);
    byId("wh-meta").textContent =
      t.census.where.meta(capital.areas.length, level) +
      (view.filter
        ? ` · ${t.census.where.filter.meta(kept.length, capital.areas.length, t.census.where.filter.bands[view.filter.band]!, t.census.vars[view.filter.v]!)}`
        : "");

    this.renderMap(capital, level, v, ranked, city, keep);
    this.renderRanking(capital, v, ranked, city, fmt);
    this.renderCard(capital, level, view.pick);

    const gini = INCOME.includes(v) ? giniRank(this.data.capitals, capital.code) : null;
    if (gini)
      byId("wh-rank-cap").textContent +=
        ` ${t.census.where.giniLine(gini.gini.toFixed(2).replace(".", ","), gini.rank, gini.of)}`;

    const shown = [v, ...(view.filter ? [view.filter.v] : [])];
    byId("wh-note").textContent = [
      isApprox(loaded, level) ? t.census.capital.osmNote : t.census.capital.levelNote[level],
      unnamed ? t.census.where.unnamedNote : "",
      shown.some((x) => x === "income" || x === "incomeMedian") ? t.census.where.incomeNote : "",
      shown.includes("incomeRatio") ? t.census.where.ratioNote : "",
      shown.some((x) => COMMUTE.includes(x) || x === "commuteLong") ? t.census.where.commuteNote : "",
      shown.some((x) => HOME.includes(x)) ? t.census.where.homeNote : "",
      shown.includes("elderly") ? t.census.where.elderlyNote : "",
      shown.some((x) => COLOUR.includes(x) || x === "negro") ? t.census.capital.colourNote : "",
      shown.includes("sameSex") ? t.census.capital.sameSexNote : "",
      t.census.where.note,
      level === "areas" ? "" : t.census.where.sampleNote,
    ]
      .filter(Boolean)
      .join(" ");
    byId("wh-sources").innerHTML = sourcesHtml([
      t.sources.ibgeTracts,
      t.sources.ibgeUniverse,
      t.sources.ibgeAreas,
      ...(level === "districts" || level === "subprefeituras" ? [t.sources.spSubprefeituras] : []),
      ...(isApprox(loaded, level) ? [t.sources.osm] : []),
    ]);
  }

  private renderMap(
    capital: Capital,
    level: CapitalLevel,
    v: CensusVar,
    ranked: Ranked[],
    city: number | null,
    keep: (a: Area) => boolean,
  ): void {
    const key = `${capital.code}|${level}`;
    let entry = this.maps.get(key);
    if (!entry) {
      const host = document.createElement("div");
      host.className = "cp-map-host";
      byId("wh-map").append(host);
      const object = capitalObject(capital);
      const map = new ChoroplethMap(host, {
        topology: capital.topology,
        object,
        groups: object.geometries.map((g) => String(g.id)),
        projection: geoMercator(),
        width: 800,
        height: 700,
        // Close enough to read the streets under the areas.
        maxZoom: 32,
        basemap: true,
      });
      const ids = object.geometries.map((g) => String(g.id));
      map.onAreaClick((i) => this.pick(ids[i]!));
      entry = { host, map, ids };
      this.maps.set(key, entry);
    }
    for (const [k, m] of this.maps) m.host.hidden = k !== key;
    this.shown = key;

    const ids = entry.ids;
    const byId_ = new Map(capital.areas.map((a) => [a.id, a]));
    const rankOf = new Map(ranked.map((r) => [r.area.id, r]));
    const decile = areaDeciles(capital.areas, v);
    entry.map.paint(
      t.census.where.mapAria(t.census.varLong[v]!, capital.name),
      (i) => {
        const a = byId_.get(ids[i]!);
        const d = a ? decile(a) : null;
        return (d === null ? "no-data" : `q${d}`) + (a && !keep(a) ? " wh-out" : "");
      },
      (i) => {
        const a = byId_.get(ids[i]!);
        return a ? this.tooltip(capital, a, v, rankOf.get(a.id), ranked.length, city) : "";
      },
    );
    byId("wh-map-cap").textContent = t.census.capital.mapCapCensus(
      t.census.vars[v]!,
      t.census.capital.per[level],
    );
    byId("wh-legend").innerHTML =
      decileLegend(t.census.vars[v]!, false) +
      `<span class="map-steps"><i class="map-key no-data"></i> ${t.census.noData}</span>` +
      (this.state.filter
        ? `<span class="map-steps"><i class="map-key q5 wh-out-key"></i> ${t.census.where.filter.out}</span>`
        : "");
  }

  private tooltip(
    capital: Capital,
    a: Area,
    v: CensusVar,
    r: Ranked | undefined,
    of: number,
    city: number | null,
  ): string {
    const x = areaValue(a, v);
    return (
      `<div class="tt-h">${escapeHtml(this.full.get(a.id)!)}</div>` +
      `<div class="tt-s">${integer(a.population)} hab.</div>` +
      `<div class="row"><span>${escapeHtml(t.census.vars[v]!)}</span><b>${x === null ? "—" : escapeHtml(t.census.format(v, x))}</b></div>` +
      (r ? `<div class="tt-s">${t.census.where.rank(r.rank, of)}</div>` : "") +
      (city === null
        ? ""
        : `<div class="row"><span>${escapeHtml(t.census.where.city(capital.name))}</span><b>${escapeHtml(t.census.format(v, city))}</b></div>`) +
      `<div class="tt-s tt-foot">${t.census.where.clickHint}</div>`
    );
  }

  private renderRanking(
    capital: Capital,
    v: CensusVar,
    ranked: Ranked[],
    city: number | null,
    fmt: (x: number) => string,
  ): void {
    const max = Math.max(...ranked.map((r) => r.value), city ?? 0) || 1;
    const decile = areaDeciles(capital.areas, v);
    const row = (r: Ranked) =>
      `<li><button type="button" class="wh-row" data-id="${escapeHtml(r.area.id)}" title="${escapeHtml(this.full.get(r.area.id)!)}">` +
      `<span class="wh-n">${r.rank}</span>` +
      `<span class="wh-name">${escapeHtml(this.short.get(r.area.id)!)}${r.area.bairros.length > 1 ? ` <span class="meta">+${r.area.bairros.length - 1}</span>` : ""}</span>` +
      `<span class="cv-bar-track"><span class="q${decile(r.area) ?? 0}" style="width:${((r.value / max) * 100).toFixed(1)}%"></span></span>` +
      `<b>${escapeHtml(fmt(r.value))}</b></button></li>`;
    // Short lists whole; long ones as their two ends around the city's figure.
    const whole = ranked.length <= 2 * TOP + 4;
    const top = whole ? ranked : ranked.slice(0, TOP);
    const bottom = whole ? [] : ranked.slice(-TOP);
    const cityRow =
      city === null
        ? ""
        : `<li class="wh-city"><span class="wh-n"></span><span class="wh-name">${escapeHtml(t.census.where.city(capital.name))}</span>` +
          `<span class="cv-bar-track"><span style="width:${((city / max) * 100).toFixed(1)}%"></span></span><b>${escapeHtml(fmt(city))}</b></li>`;
    byId("wh-rank").innerHTML = whole
      ? `<h3 class="wh-h">${escapeHtml(t.census.where.all(ranked.length))}</h3><ol class="wh-list">${top.map(row).join("")}${cityRow}</ol>`
      : `<h3 class="wh-h">${escapeHtml(t.census.where.most(TOP))}</h3><ol class="wh-list">${top.map(row).join("")}</ol>` +
        `<ol class="wh-list wh-mid">${cityRow}<li class="wh-gap">${escapeHtml(t.census.where.skipped(ranked.length - 2 * TOP))}</li></ol>` +
        `<h3 class="wh-h">${escapeHtml(t.census.where.least(TOP))}</h3><ol class="wh-list">${bottom.map(row).join("")}</ol>`;
    byId("wh-rank-cap").textContent = t.census.where.rankCap(t.census.varLong[v]!);
  }

  /** A unit's every figure next to the whole city's and its place among the units. */
  private renderCard(capital: Capital, level: CapitalLevel, pick: string | null): void {
    const box = byId("wh-card");
    const a = pick ? capital.areas.find((x) => x.id === pick) : undefined;
    box.hidden = !a;
    this.picked = a?.id ?? null;
    if (!a) {
      box.innerHTML = "";
      this.focus(null);
      return;
    }
    const brazil = this.data.brazil ?? {};
    const show = (v: CensusVar, x: number | null | undefined) =>
      x === null || x === undefined ? "—" : escapeHtml(t.census.format(v, x));
    const rows = PROFILE.map(([label, vs]) => {
      const lines = vs
        .filter((v) => AREA_VARS.includes(v))
        .map((v) => {
          const x = areaValue(a, v);
          const ranked = ranking(capital.areas, v);
          const r = ranked.find((p) => p.area.id === a.id);
          // Sample figures of a unit other than a weighting area are its areas'.
          const mark = fromSample(v) && level !== "areas" ? t.census.where.sampleMark : "";
          return (
            `<tr><th scope="row">${escapeHtml(t.census.vars[v]!)}${mark}</th>` +
            `<td><b>${show(v, x)}</b>` +
            (r ? `<span class="wh-pos">${t.census.where.rank(r.rank, ranked.length)}</span>` : "") +
            `</td><td>${show(v, cityValue(capital.areas, v))}</td><td>${show(v, brazil[v])}</td></tr>`
          );
        });
      return `<tbody><tr class="wh-card-group"><th colspan="4">${escapeHtml(label)}</th></tr>${lines.join("")}</tbody>`;
    });
    box.innerHTML =
      `<div class="wh-card-head"><div><h3 class="wh-card-title">${escapeHtml(this.full.get(a.id)!)}</h3>` +
      `<span class="meta">${escapeHtml(t.census.where.cardSub(level, capital.name, integer(a.population)))}</span></div>` +
      `<button type="button" class="chip" data-close>${t.census.where.close}</button></div>` +
      `<div class="table-wrap"><table class="wh-table"><thead><tr><th></th><th>${t.census.where.here}</th>` +
      `<th>${escapeHtml(capital.name)}</th><th>${t.census.where.brazil}</th></tr></thead>${rows.join("")}</table></div>`;
    this.focus(a.id);
    if (this.reveal) {
      this.reveal = false;
      const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      box.scrollIntoView?.({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
    }
  }
}
