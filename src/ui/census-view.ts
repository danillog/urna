import { geoMercator } from "d3-geo";
import { scaleLinear } from "d3-scale";

import { escapeHtml, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  CENSUS_VARS,
  REGION_OF,
  RELIGION,
  SCHOOLING,
  composition,
  byDecile,
  gap,
  groupOf,
  isLog,
  placesWith,
  populationBreaks,
  quadrants,
  valueAt,
  voteAt,
  type CensusVar,
  type CensusVote,
  type Election,
} from "../model/census-vote";
import type { CapitalsData } from "../model/capitals";
import type { ColorName, MunicipalMap } from "../types";
import { button, byId } from "./dom";
import { CapitalsPanel, defaultCapital, type Paint } from "./capitals-panel";
import { ChoroplethMap } from "./map";
import { Scatter, decileLegend } from "./scatter";
import { sourcesHtml } from "./sources";

export type Region = "all" | "N" | "NE" | "CO" | "SE" | "S";
const REGIONS: Region[] = ["all", "N", "NE", "CO", "SE", "S"];
type Side = "pt" | "rival";

export interface CensusState {
  year: number;
  /** The census variable on the x axis and the map. */
  v: CensusVar;
  /** The second variable: the dots' color and the quadrants' other axis. */
  other: CensusVar;
  side: Side;
  region: Region;
  /** "Dentro das capitais": which capital, and whether its map shows the vote or the census. */
  capital: string;
  paint: Paint;
}

/** Variables in the address: ?var=renda&cruzar=evangelicos. */
const SLUGS: Record<CensusVar, string> = {
  income: "renda",
  evangelical: "evangelicos",
  catholic: "catolicos",
  noReligion: "sem-religiao",
  otherReligion: "outras-religioes",
  eduBasic: "ate-fundamental-incompleto",
  eduFund: "fundamental",
  eduMid: "medio",
  degree: "superior",
  illiterate: "analfabetismo",
  population: "populacao",
  urban: "urbanizacao",
};
const fromSlug = (s: string | null): CensusVar | undefined => CENSUS_VARS.find((v) => SLUGS[v] === s);

/** One fixed color per variable in the gap chart; never by rank. */
const VAR_COLORS: Record<CensusVar, ColorName> = {
  income: "gold",
  evangelical: "violet",
  catholic: "sky",
  noReligion: "teal",
  otherReligion: "pink",
  eduBasic: "red",
  eduFund: "cyan",
  eduMid: "blue",
  degree: "orange",
  illiterate: "gray",
  population: "green",
  urban: "brown",
};

/** Schooling is ordered: a sequential ramp (viridis steps), lowest level darkest. Religion is not: categorical colors. */
const SWATCH: Partial<Record<CensusVar, string>> = {
  eduBasic: "q1",
  eduFund: "q4",
  eduMid: "q6",
  degree: "q9",
};
const swatch = (v: CensusVar) => SWATCH[v] ?? `c-${VAR_COLORS[v]}`;

const STEP_MS = 1600;
/** Lines always drawn, faint, in the gap chart: income, the two big religions, the schooling ends. */
const GAP_LANDMARKS: CensusVar[] = ["income", "catholic", "evangelical", "eduBasic", "degree"];

/** Whether the census paired with an election has a variable (2022 has no urban share yet). */
const hasVar = (_data: CensusVote, census: number, v: CensusVar) => v !== "urban" || census !== 2022;

/** Round ticks for the log axes, kept to the ones inside the domain. */
const LOG_TICKS: Partial<Record<CensusVar, number[]>> = {
  income: [250, 500, 1000, 2000, 4000, 8000],
  population: [1e3, 1e4, 1e5, 1e6, 1e7],
};

function normalize(data: CensusVote, s: CensusState): CensusState {
  const e = data.elections.find((x) => x.year === s.year) ?? data.elections.at(-1)!;
  let { v, other } = s;
  if (!hasVar(data, e.census, v)) v = "income";
  if (!hasVar(data, e.census, other) || other === v) other = v === "evangelical" ? "income" : "evangelical";
  return { ...s, year: e.year, v, other };
}

export function censusFromSearch(
  data: CensusVote,
  capitals: CapitalsData,
  params: URLSearchParams,
): CensusState {
  const region = params.get("regiao")?.toUpperCase() as Region | undefined;
  return normalize(data, {
    year: Number(params.get("ano")) || data.elections.at(-1)!.year,
    v: fromSlug(params.get("var")) ?? "income",
    other: fromSlug(params.get("cruzar")) ?? "evangelical",
    side: params.get("voto") === "adversario" ? "rival" : "pt",
    region: region && REGIONS.includes(region) ? region : "all",
    capital: defaultCapital(capitals, params.get("capital")),
    paint: params.get("pintar") === "censo" ? "census" : "vote",
  });
}

export function censusToSearch(
  s: CensusState,
  data: CensusVote,
  capitals: CapitalsData,
  params: URLSearchParams,
): void {
  if (s.year !== data.elections.at(-1)!.year) params.set("ano", String(s.year));
  if (s.v !== "income") params.set("var", SLUGS[s.v]);
  if (s.other !== "evangelical") params.set("cruzar", SLUGS[s.other]);
  if (s.side === "rival") params.set("voto", "adversario");
  if (s.region !== "all") params.set("regiao", s.region.toLowerCase());
  if (s.capital !== defaultCapital(capitals, null)) params.set("capital", s.capital);
  if (s.paint === "census") params.set("pintar", "censo");
}

/** The Voto e Censo tab: scatter, map, quadrants and the gap over time. */
export class CensusView {
  private timer: number | undefined;
  private drawing: ChoroplethMap | null = null;
  private readonly scatter: Scatter;
  private readonly capitals: CapitalsPanel;

  constructor(
    private readonly data: CensusVote,
    private readonly map: MunicipalMap,
    capitals: CapitalsData,
    private state: CensusState,
    private readonly onChange: () => void,
  ) {
    // Religion and schooling as the categories they are: grouped, each level on its own.
    const fill = (select: HTMLSelectElement) =>
      (
        [
          [t.census.varGroups.religion, RELIGION],
          [t.census.varGroups.schooling, SCHOOLING],
          [
            t.census.varGroups.other,
            CENSUS_VARS.filter((v) => !RELIGION.includes(v) && !SCHOOLING.includes(v)),
          ],
        ] as const
      ).forEach(([label, vars]) => {
        const group = document.createElement("optgroup");
        group.label = label;
        vars.forEach((v) => group.append(new Option(t.census.vars[v]!, v)));
        select.append(group);
      });
    const variable = byId<HTMLSelectElement>("cv-var");
    fill(variable);
    variable.addEventListener("change", () => this.set({ v: variable.value as CensusVar }));
    const other = byId<HTMLSelectElement>("cv-other");
    fill(other);
    other.addEventListener("change", () => this.set({ other: other.value as CensusVar }));
    const region = byId<HTMLSelectElement>("cv-region");
    REGIONS.forEach((r) => region.add(new Option(t.census.regions[r]!, r)));
    region.addEventListener("change", () => this.set({ region: region.value as Region }));
    byId("cv-sides")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ side: b.dataset.side as Side })));
    const slider = byId<HTMLInputElement>("cv-slider");
    slider.addEventListener("input", () =>
      this.set({ year: this.data.elections[Number(slider.value)]!.year }, true),
    );
    byId("cv-years").addEventListener("click", (e) => {
      const year = (e.target as HTMLElement).closest<HTMLElement>("[data-year]")?.dataset.year;
      if (year) this.set({ year: Number(year) }, true);
    });
    byId("cv-play").addEventListener("click", () => (this.timer ? this.stop() : this.play()));
    byId("cv-gap-legend").addEventListener("click", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("[data-v]")?.dataset.v as
        CensusVar | undefined;
      if (v) this.set({ v });
    });
    byId("cv-zoom-in").addEventListener("click", () => this.drawing?.zoomIn());
    byId("cv-zoom-out").addEventListener("click", () => this.drawing?.zoomOut());
    byId("cv-zoom-reset").addEventListener("click", () => this.drawing?.fit(null));

    this.scatter = new Scatter(byId("cv-scatter"));
    this.capitals = new CapitalsPanel(capitals, (patch) => this.set(patch));
  }

  get current(): CensusState {
    return this.state;
  }

  private get election(): Election {
    return this.data.elections.find((e) => e.year === this.state.year)!;
  }

  private set(patch: Partial<CensusState>, stop = false): void {
    if (stop) this.stop();
    this.state = normalize(this.data, { ...this.state, ...patch });
    this.onChange();
  }

  play(): void {
    const years = this.data.elections.map((e) => e.year);
    if (this.state.year === years.at(-1)) this.set({ year: years[0]! });
    this.timer = window.setInterval(() => {
      const i = years.indexOf(this.state.year);
      if (i >= years.length - 1) this.stop();
      else this.set({ year: years[i + 1]! });
    }, STEP_MS);
    this.renderPlay();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.renderPlay();
  }

  private renderPlay(): void {
    const b = byId("cv-play");
    b.textContent = this.timer ? "❚❚" : "▶";
    b.setAttribute("aria-pressed", String(Boolean(this.timer)));
    b.setAttribute("aria-label", this.timer ? t.census.pause : t.census.play);
  }

  private inRegion = (i: number): boolean =>
    this.state.region === "all" || REGION_OF[this.map.municipalities.uf[i]!] === this.state.region;

  private who(side: Side = this.state.side): string {
    const e = this.election;
    return side === "pt" ? e.pt : e.rival;
  }

  render(): void {
    const s = this.state;
    const e = this.election;
    const variable = byId<HTMLSelectElement>("cv-var");
    variable.value = s.v;
    [...variable.options].forEach((o) => {
      o.disabled = !hasVar(this.data, e.census, o.value as CensusVar);
      o.title = o.disabled ? t.census.noUrban2022 : "";
    });
    const other = byId<HTMLSelectElement>("cv-other");
    other.value = s.other;
    [...other.options].forEach((o) => {
      o.disabled = o.value === s.v || !hasVar(this.data, e.census, o.value as CensusVar);
    });
    byId<HTMLSelectElement>("cv-region").value = s.region;
    byId("cv-sides")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.textContent = this.who(b.dataset.side as Side);
        b.setAttribute("aria-pressed", String(b.dataset.side === s.side));
      });
    this.renderTimeline();

    const places = placesWith(this.data, e, s.v, this.inRegion);
    byId("cv-title").textContent = t.census.title(e.pt, e.rival, e.year, t.census.regions[s.region]!);
    byId("cv-meta").textContent = t.census.meta(e.census, places.length);
    byId("cv-warning").textContent = t.census.warning;
    this.renderScatter(e, places);
    this.renderMap(e, places);
    const latest = this.data.elections.at(-1)!;
    this.capitals.render({
      capital: s.capital,
      paint: s.paint,
      v: s.v,
      other: s.other,
      side: s.side,
      pt: latest.pt,
      rival: latest.rival,
    });
    this.renderQuadrants(e);
    this.renderComposition(e);
    this.renderGap();
    byId("cv-note").textContent = t.census.note;
    byId("cv-sources").innerHTML = sourcesHtml([
      t.sources.tseOpenData,
      t.sources.tseResults,
      t.sources.atlasData,
      t.sources.sidraReligion,
      t.sources.sidra2022,
    ]);
  }

  private renderTimeline(): void {
    const years = this.data.elections.map((e) => e.year);
    const slider = byId<HTMLInputElement>("cv-slider");
    slider.max = String(years.length - 1);
    slider.value = String(years.indexOf(this.state.year));
    slider.setAttribute("aria-valuetext", String(this.state.year));
    byId("cv-years").replaceChildren(
      ...years.map((year) => {
        const b = button(String(year), { className: "timeline-year", pressed: year === this.state.year });
        b.dataset.year = String(year);
        return b;
      }),
    );
  }

  /** The dot color: tenth of the population along the second variable. */
  private otherDeciles(e: Election, places: number[]): (i: number) => number | null {
    const v = this.state.other;
    const withOther = places.filter((i) => valueAt(this.data, e.census, v, i) !== null);
    const breaks = populationBreaks(this.data, e.census, v, withOther, 10);
    return (i) => {
      const x = valueAt(this.data, e.census, v, i);
      return x === null ? null : groupOf(x, breaks);
    };
  }

  private renderScatter(e: Election, places: number[]): void {
    const s = this.state;
    const decile = this.otherDeciles(e, places);
    const pop = (i: number) => valueAt(this.data, e.census, "population", i) ?? 0;
    const maxPop = Math.max(...places.map(pop));
    const who = this.who();
    const dots = places.flatMap((i) => {
      const vote = voteAt(e, s.side, i);
      if (vote === null) return [];
      const d = decile(i);
      return [
        {
          x: valueAt(this.data, e.census, s.v, i)!,
          y: vote,
          r: 1.4 + 9 * Math.sqrt(pop(i) / maxPop),
          cls: d === null ? "cv-nodata" : `q${d}`,
          id: i,
        },
      ];
    });
    this.scatter.draw({
      dots,
      log: isLog(s.v),
      logTicks: LOG_TICKS[s.v],
      format: (v) => t.census.format(s.v, v),
      line: byDecile(this.data, e, s.v, s.side, this.inRegion).map((p) => ({ x: p.x, y: p.share })),
      aria: t.census.scatterAria(t.census.varLong[s.v]!, who),
      axisLabel: t.census.unit(s.v, e.census),
      tooltip: (i) => this.tooltip(i),
    });
    byId("cv-scatter-cap").textContent = t.census.scatterCap(
      t.census.vars[s.v]!,
      who,
      t.census.vars[s.other]!.toLowerCase(),
    );
    byId("cv-scatter-legend").innerHTML = decileLegend(
      t.census.otherLegend(t.census.varLong[s.other]!),
      true,
    );
  }

  private tooltip(i: number): string {
    const e = this.election;
    const s = this.state;
    const m = this.map.municipalities;
    const row = (v: CensusVar) => {
      const x = valueAt(this.data, e.census, v, i);
      return `<div class="row"><span>${t.census.vars[v]}</span><b>${x === null ? "—" : escapeHtml(t.census.format(v, x))}</b></div>`;
    };
    const vote = (side: Side) => {
      const x = voteAt(e, side, i);
      return `<div class="row"><span>${escapeHtml(this.who(side))}</span><b>${x === null ? "—" : percent(x)}</b></div>`;
    };
    return (
      `<div class="tt-h">${escapeHtml(m.names[i]!)} (${m.uf[i]})</div>` +
      vote("pt") +
      vote("rival") +
      `<div class="tt-s tt-foot"></div>` +
      row(s.v) +
      (s.other !== s.v ? row(s.other) : "") +
      (s.v !== "population" && s.other !== "population" ? row("population") : "")
    );
  }

  private renderMap(e: Election, places: number[]): void {
    const s = this.state;
    if (!this.drawing) {
      this.drawing = new ChoroplethMap(byId("cv-map"), {
        topology: this.map.topology,
        object: this.map.topology.objects.municipalities,
        groups: this.map.municipalities.uf,
        projection: geoMercator(),
        width: 800,
        height: 780,
        maxZoom: 12,
      });
    }
    const breaks = populationBreaks(this.data, e.census, s.v, places, 10);
    const label = t.census.varLong[s.v]!;
    this.drawing.paint(
      t.census.mapAria(label),
      (i) => {
        if (!this.inRegion(i)) return "cv-out";
        const x = valueAt(this.data, e.census, s.v, i);
        return x === null ? "no-data" : `q${groupOf(x, breaks)}`;
      },
      (i) => this.tooltip(i),
    );
    byId("cv-map-cap").textContent = t.census.mapCap(t.census.vars[s.v]!);
    const first = breaks[0];
    const last = breaks.at(-1);
    byId("cv-map-legend").innerHTML =
      `<span class="map-steps">${first === undefined ? "" : `≤ ${escapeHtml(t.census.format(s.v, first))}`}</span>` +
      Array.from({ length: 10 }, (_, k) => `<i class="map-key q${k}"></i>`).join("") +
      `<span class="map-steps">${last === undefined ? "" : `> ${escapeHtml(t.census.format(s.v, last))}`}</span>` +
      `<span class="map-steps"><i class="map-key no-data"></i> ${t.census.noData}</span>`;
  }

  private renderQuadrants(e: Election): void {
    const s = this.state;
    const a = t.census.vars[s.v]!;
    const b = t.census.vars[s.other]!;
    byId("cv-quad-title").textContent = t.census.quadTitle(a, b);
    byId("cv-quad-note").textContent = t.census.quadNote;
    const bar = (side: Side, share: number | null) =>
      `<div class="cv-bar"><span class="cv-bar-name">${escapeHtml(this.who(side))}</span>` +
      `<span class="cv-bar-track"><span class="c-${side === "pt" ? "red" : "blue"}" style="width:${(share ?? 0).toFixed(1)}%"></span></span>` +
      `<b>${share === null ? "—" : percent(share)}</b></div>`;
    // Low/low top left … high/high bottom right, as the axes read. The cut is written as a
    // number ("até R$ 1.020"), the point where half the people live on each side.
    const { cuts, groups } = quadrants(this.data, e, s.v, s.other, this.inRegion);
    const [ca, cb] = cuts.map((c, k) => t.census.format(k ? s.other : s.v, c));
    const cards = groups.map(
      (q) =>
        `<div class="cv-quad"><div class="cv-quad-h">${escapeHtml(t.census.quadLabel(a, ca!, q.high[0], b.toLowerCase(), cb!, q.high[1]))}</div>` +
        bar("pt", q.pt) +
        bar("rival", q.rival) +
        `<div class="meta">${t.census.quadMeta(q.places, q.population)}</div></div>`,
    );
    byId("cv-quads").innerHTML = cards.join("");
  }

  /** Religion and schooling, whole, in towns grouped by how they voted. */
  private renderComposition(e: Election): void {
    const who = this.who();
    byId("cv-comp-title").textContent = t.census.compTitle(who);
    byId("cv-comp-note").textContent = t.census.compNote;
    const stack = (shares: Record<string, number> | null, vars: CensusVar[], label: string) =>
      shares
        ? `<div class="cv-stack" role="img" aria-label="${escapeHtml(label)}: ${vars.map((v) => `${t.census.vars[v]} ${percent(shares[v]!)}`).join(", ")}">` +
          vars
            .map(
              (v) =>
                `<span class="${swatch(v)}" style="width:${shares[v]!.toFixed(2)}%" title="${escapeHtml(`${t.census.vars[v]}: ${percent(shares[v]!)}`)}">${shares[v]! >= 9 ? Math.round(shares[v]!) + "%" : ""}</span>`,
            )
            .join("") +
          `</div>`
        : `<div class="cv-stack cv-stack-empty"></div>`;
    const rows = composition(this.data, e, this.state.side, this.inRegion).map((g) => {
      const group = t.census.compGroup(g.from, g.to);
      return (
        `<div class="cv-comp-row"><div class="cv-comp-h"><b>${escapeHtml(group)}</b><span class="meta">${t.census.compMeta(g.places, g.population)}</span></div>` +
        stack(g.religion, RELIGION, t.census.compAria(group, t.census.compReligion)) +
        stack(g.schooling, SCHOOLING, t.census.compAria(group, t.census.compSchooling)) +
        `</div>`
      );
    });
    const key = (vars: CensusVar[], title: string) =>
      `<div class="legend map-legend"><span class="map-steps">${title}:</span>${vars
        .map((v) => `<span class="map-steps"><i class="map-key ${swatch(v)}"></i> ${t.census.vars[v]}</span>`)
        .join("")}</div>`;
    byId("cv-comp").innerHTML =
      `<div class="cv-comp-cols"><span></span><b>${t.census.compReligion}</b><b>${t.census.compSchooling}</b></div>` +
      rows.join("") +
      key(RELIGION, t.census.compReligion) +
      key(SCHOOLING, t.census.compSchooling);
  }

  /** The PT gap per variable over every election; the chosen two stand out and carry labels. */
  private renderGap(): void {
    const s = this.state;
    const elections = this.data.elections;
    // Twelve lines would be unreadable: the chosen two, and a few landmarks in grey.
    const shown = [...new Set<CensusVar>([s.v, s.other, ...GAP_LANDMARKS])];
    const series = shown.map((v) => ({
      v,
      points: elections.map((e) => ({
        year: e.year,
        gap: hasVar(this.data, e.census, v) ? gap(this.data, e, v, this.inRegion) : null,
      })),
    }));
    const all = series.flatMap((x) => x.points.map((p) => p.gap)).filter((g): g is number => g !== null);
    const W = 760;
    const H = 300;
    const m = { l: 44, r: 120, t: 14, b: 30 };
    const x = scaleLinear()
      .domain([0, elections.length - 1])
      .range([m.l, W - m.r]);
    const span = Math.max(10, ...all.map(Math.abs));
    const y = scaleLinear()
      .domain([-span, Math.max(10, ...all)])
      .range([H - m.b, m.t])
      .nice();
    const yTicks = y
      .ticks(6)
      .map(
        (v) =>
          `<g transform="translate(0,${y(v).toFixed(1)})"><line x1="${m.l}" x2="${W - m.r}" class="${v === 0 ? "cv-zero" : "cv-rule"}"/><text x="${m.l - 8}" dy="0.32em" class="cv-tick" text-anchor="end">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}</text></g>`,
      );
    const xTicks = elections.map(
      (e, k) =>
        `<text x="${x(k).toFixed(1)}" y="${H - 8}" class="cv-tick${e.year === s.year ? " cv-now" : ""}" text-anchor="middle">${e.year}</text>`,
    );
    const now = elections.findIndex((e) => e.year === s.year);
    const lines = series
      .sort((p, q) => Number([s.v, s.other].includes(p.v)) - Number([s.v, s.other].includes(q.v)))
      .map(({ v, points }) => {
        const on = v === s.v || v === s.other;
        const segs = points.map((p, k) =>
          p.gap === null ? null : `${x(k).toFixed(1)},${y(p.gap).toFixed(1)}`,
        );
        const path = segs.filter(Boolean).join(" ");
        const last = [...points].reverse().find((p) => p.gap !== null);
        const lastK = points.indexOf(last!);
        const dots = points
          .map((p, k) =>
            p.gap === null
              ? ""
              : `<circle cx="${x(k).toFixed(1)}" cy="${y(p.gap).toFixed(1)}" r="${on ? 3.5 : 2}"><title>${escapeHtml(t.census.gapPoint(t.census.vars[v]!, p.year, p.gap.toFixed(1).replace(".", ",")))}</title></circle>`,
          )
          .join("");
        return (
          `<g class="cv-series${on ? " on" : ""}" style="--sc: var(--c-${VAR_COLORS[v]})">` +
          `<polyline points="${path}"/>${dots}` +
          (on && last
            ? `<text x="${(x(lastK) + 8).toFixed(1)}" y="${y(last.gap!).toFixed(1)}" dy="0.32em" class="cv-series-label">${escapeHtml(t.census.vars[v]!)}</text>`
            : "") +
          `</g>`
        );
      });
    byId("cv-gap-title").textContent = t.census.gapTitle;
    byId("cv-gap-note").textContent = t.census.gapNote;
    byId("cv-gap").innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t.census.gapAria)}">` +
      yTicks.join("") +
      `<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" class="cv-now-line"/>` +
      xTicks.join("") +
      lines.join("") +
      `</svg>`;
    // Each chip picks that variable for the scatter and the map.
    byId("cv-gap-legend").replaceChildren(
      ...CENSUS_VARS.map((v) => {
        const b = button(
          `<i class="cv-swatch" style="background: var(--c-${VAR_COLORS[v]})"></i><span>${escapeHtml(t.census.vars[v]!)}</span>`,
          { className: "chip map-chip", pressed: v === s.v || v === s.other },
        );
        b.dataset.v = v;
        b.disabled = !hasVar(this.data, this.election.census, v);
        return b;
      }),
    );
  }
}
