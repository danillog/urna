import { geoMercator } from "d3-geo";

import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  AREA_VARS,
  CAPITAL_RELIGION,
  COMMUTE,
  HOME,
  areaDeciles,
  areaLine,
  areaValue,
  areaVote,
  atLevel,
  isApprox,
  capitalInRound,
  capitalObject,
  levelsOf,
  type CapitalLevel,
  type Area,
  type CapitalRound,
  type Capital,
  type CapitalMeta,
  type CapitalsData,
  LOW_COVERAGE,
} from "../model/capitals";
import { COLOUR, SCHOOLING, isLog, type CensusVar } from "../model/census-vote";
import { MARGIN_STEPS, shade } from "../model/map-data";
import { byId } from "./dom";
import { ChoroplethMap } from "./map";
import { Scatter, decileLegend as legend } from "./scatter";
import { sourcesHtml } from "./sources";

export type Paint = "vote" | "census";

/** What the panel shows, shared with the tab: the variables and the side come from it. */
export interface CapitalView {
  capital: string;
  paint: Paint;
  round: CapitalRound;
  /** Areas, neighbourhoods (19 capitals), districts or subprefeituras (São Paulo). */
  level: CapitalLevel;
  /** The panel's own variable; null follows the tab's. */
  capVar: CensusVar | null;
  v: CensusVar;
  other: CensusVar;
  side: "pt" | "rival";
  /** Names of the PT's candidate and the rival in 2026. */
  pt: string;
  rival: string;
}

export const DEFAULT_CAPITAL = "3550308"; // São Paulo
/** What an area's tooltip lists: the vote's usual companions (the card in "Quem mora onde"
 * has every variable). */
const TOOLTIP_VARS: CensusVar[] = [
  "income",
  "incomeMedian",
  ...CAPITAL_RELIGION,
  ...SCHOOLING,
  ...COLOUR,
  "negro",
  "elderly",
  "sameSex",
];
const LOG_TICKS: Partial<Record<CensusVar, number[]>> = {
  income: [500, 1000, 2000, 4000, 8000, 16000],
  incomeMedian: [500, 1000, 2000, 4000, 8000, 16000],
  population: [1e4, 2e4, 5e4, 1e5, 2e5],
};

/** The capital asked for if there is one, else São Paulo, else the first. */
export function defaultCapital(data: CapitalsData, code: string | null): string {
  const has = (c: string | null) => data.capitals.some((x) => x.code === c);
  return has(code) ? code! : has(DEFAULT_CAPITAL) ? DEFAULT_CAPITAL : data.capitals[0]!.code;
}

/** "Dentro das capitais": a capital's areas as a scatter and a map. */
export class CapitalsPanel {
  private readonly scatter: Scatter;
  /** One map per capital drawn so far, each in its own box so their events stay apart. */
  private readonly maps = new Map<string, { host: HTMLElement; map: ChoroplethMap }>();
  private shown: string | null = null;
  /** The last view asked for, so a capital that arrives late is drawn only if still wanted. */
  private wanted: CapitalView | null = null;
  /** The level on screen, for the map's caption. */
  private level: CapitalLevel = "areas";

  constructor(
    private readonly data: CapitalsData,
    private readonly loadCapital: (code: string) => Promise<Capital>,
    private readonly peekCapital: (code: string) => Capital | undefined,
    onPick: (patch: {
      capital?: string;
      paint?: Paint;
      capRound?: CapitalRound;
      capLevel?: CapitalLevel;
      capVar?: CensusVar | null;
    }) => void,
  ) {
    // The panel's variables, grouped: the census universe's colour or race and couples
    // exist only here, inside the capitals.
    const vars = byId<HTMLSelectElement>("cp-var");
    vars.add(new Option(t.census.capital.varFollow, ""));
    const groups: [string, CensusVar[]][] = [
      [t.census.varGroups.income, ["income", "incomeMedian", "incomeRatio"]],
      [t.census.varGroups.religion, CAPITAL_RELIGION],
      [t.census.varGroups.schooling, SCHOOLING],
      [t.census.varGroups.study, ["schoolYears", "illiterate"]],
      [t.census.varGroups.work, ["unemployed"]],
      [t.census.varGroups.commute, [...COMMUTE, "commuteLong"]],
      [t.census.varGroups.home, HOME],
      [t.census.varGroups.colour, [...COLOUR, "negro"]],
      [t.census.varGroups.age, ["elderly"]],
      [t.census.varGroups.origin, ["migrant"]],
      [t.census.varGroups.couples, ["sameSex"]],
      [t.census.varGroups.other, ["population"]],
    ];
    for (const [label, list] of groups) {
      const g = document.createElement("optgroup");
      g.label = label;
      for (const v of list) g.append(new Option(t.census.vars[v]!, v));
      vars.append(g);
    }
    vars.addEventListener("change", () => onPick({ capVar: (vars.value || null) as CensusVar | null }));
    byId("cp-level")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => onPick({ capLevel: b.dataset.level as CapitalLevel })),
      );
    const select = byId<HTMLSelectElement>("cp-capital");
    [...data.capitals]
      .sort((a, b) => a.name.localeCompare(b.name, t.locale))
      .forEach((c) => select.add(new Option(`${c.name} (${c.uf})`, c.code)));
    select.addEventListener("change", () => onPick({ capital: select.value }));
    byId("cp-paint")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => onPick({ paint: b.dataset.paint as Paint })));
    byId("cp-round")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => onPick({ capRound: b.dataset.round as CapitalRound })),
      );
    this.scatter = new Scatter(byId("cp-scatter"));
    byId("cp-zoom-in").addEventListener("click", () => this.current?.zoomIn());
    byId("cp-zoom-out").addEventListener("click", () => this.current?.zoomOut());
    byId("cp-zoom-reset").addEventListener("click", () => this.current?.fit(null));
  }

  private get current(): ChoroplethMap | undefined {
    return this.shown ? this.maps.get(this.shown)?.map : undefined;
  }

  render(view: CapitalView): void {
    this.wanted = view;
    const meta: CapitalMeta = this.data.capitals.find((c) => c.code === view.capital)!;
    const loaded = this.peekCapital(meta.code);
    if (!loaded) {
      byId<HTMLSelectElement>("cp-capital").value = meta.code;
      byId("cp-meta").textContent = t.loading;
      void this.loadCapital(meta.code).then(
        () => this.wanted?.capital === meta.code && this.render(this.wanted),
        () => (byId("cp-meta").textContent = t.loadFailed),
      );
      return;
    }
    // The runoff once read; until then the 1st round, and the switch says why.
    const hasRunoff = Boolean(loaded.r2);
    const round: CapitalRound = hasRunoff ? view.round : "r1";
    const levels = levelsOf(loaded);
    const level: CapitalLevel = levels.includes(view.level) ? view.level : "areas";
    this.level = level;
    const capital = atLevel(capitalInRound(loaded, round), level);
    byId("cp-level-group").hidden = levels.length < 2;
    byId("cp-level")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.hidden = !levels.includes(b.dataset.level as CapitalLevel);
        b.setAttribute("aria-pressed", String(b.dataset.level === level));
        if (b.dataset.level === "bairros")
          b.textContent = t.census.capital.level[isApprox(loaded, "bairros") ? "bairrosApprox" : "bairros"]!;
      });
    byId<HTMLSelectElement>("cp-var").value = view.capVar ?? "";
    byId("cp-round-group").hidden = !hasRunoff;
    byId("cp-round")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.round === round)));
    // The panel's own variable, else the tab's; no urban share by area: fall back to income.
    const v = view.capVar ?? (AREA_VARS.includes(view.v) ? view.v : "income");
    const other =
      AREA_VARS.includes(view.other) && view.other !== v
        ? view.other
        : v === "evangelical"
          ? "income"
          : "evangelical";
    const who = view.side === "pt" ? view.pt : view.rival;
    byId<HTMLSelectElement>("cp-capital").value = capital.code;
    byId("cp-paint")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.paint === view.paint));
        if (b.dataset.paint === "census") b.textContent = t.census.vars[v]!;
      });
    const withVotes = capital.areas.filter((a) => a.valid > 0);
    byId("cp-title").textContent = t.census.capital.title(
      capital.name,
      view.pt,
      view.rival,
      t.round[round],
      level,
    );
    byId("cp-meta").textContent = t.census.capital.meta(capital.areas.length, percent(capital.placed), level);
    byId("cp-warning").textContent =
      t.census.capital.warning(level) +
      (!view.capVar && v !== view.v ? ` ${t.census.capital.noUrban}.` : "") +
      (capital.missing ? ` ${t.census.capital.missing(capital.missing, capital.sections)}` : "");

    const color = areaDeciles(capital.areas, other);
    const maxPop = Math.max(...withVotes.map((a) => a.population));
    this.scatter.draw({
      dots: capital.areas.flatMap((a, i) => {
        const x = areaValue(a, v);
        const y = areaVote(a, view.side);
        if (x === null || y === null) return [];
        const d = color(a);
        return [
          {
            x,
            y,
            r: 3 + 10 * Math.sqrt(a.population / maxPop),
            cls: d === null ? "cv-nodata" : `q${d}`,
            id: i,
          },
        ];
      }),
      log: isLog(v),
      logTicks: LOG_TICKS[v],
      format: (x) => t.census.format(v, x),
      line: areaLine(capital.areas, v, view.side),
      aria: t.census.capital.scatterAria(t.census.varLong[v]!, who, capital.name),
      axisLabel: v === "income" || v === "incomeMedian" ? t.census.unit(v, 2022) : t.census.varLong[v]!,
      tooltip: (i) => this.tooltip(capital, capital.areas[i]!, view),
    });
    byId("cp-scatter-cap").textContent = t.census.capital.scatterCap(
      t.census.vars[v]!,
      who,
      t.census.vars[other]!.toLowerCase(),
      t.census.capital.per[level],
    );
    byId("cp-scatter-legend").innerHTML = legend(t.census.otherLegend(t.census.varLong[other]!), true);

    this.renderMap(capital, view, v, `${capital.code}|${level}`);
    const shown = [v, other];
    byId("cp-note").textContent = [
      hasRunoff ? t.census.capital.bothRounds : t.census.capital.onlyFirstRound2026,
      isApprox(loaded, level) ? t.census.capital.osmNote : t.census.capital.levelNote[level],
      shown.some((x) => COLOUR.includes(x) || x === "negro") ? t.census.capital.colourNote : "",
      shown.includes("sameSex") ? t.census.capital.sameSexNote : "",
      shown.includes("incomeRatio") ? t.census.where.ratioNote : "",
      shown.some((x) => COMMUTE.includes(x) || x === "commuteLong") ? t.census.where.commuteNote : "",
      shown.some((x) => HOME.includes(x)) ? t.census.where.homeNote : "",
      t.census.capital.note,
    ]
      .filter(Boolean)
      .join(" ");
    byId("cp-sources").innerHTML = sourcesHtml([
      t.sources.tseBallots,
      t.sources.tsePlaces,
      t.sources.ibgeAreas,
      t.sources.ibgeTracts,
      t.sources.ibgeUniverse,
      ...(level === "districts" || level === "subprefeituras" ? [t.sources.spSubprefeituras] : []),
      ...(isApprox(loaded, level) ? [t.sources.osm] : []),
    ]);
  }

  private renderMap(capital: Capital, view: CapitalView, v: CensusVar, key: string): void {
    const box = byId("cp-map");
    let entry = this.maps.get(key);
    if (!entry) {
      const host = document.createElement("div");
      host.className = "cp-map-host";
      box.append(host);
      const object = capitalObject(capital);
      entry = {
        host,
        map: new ChoroplethMap(host, {
          topology: capital.topology,
          object,
          groups: object.geometries.map((g) => String(g.id)),
          projection: geoMercator(),
          width: 800,
          height: 700,
          // Close enough to read the streets under the areas.
          maxZoom: 32,
          basemap: true,
        }),
      };
      this.maps.set(key, entry);
    }
    for (const [k, m] of this.maps) m.host.hidden = k !== key;
    this.shown = key;

    const byId_ = new Map(capital.areas.map((a) => [a.id, a]));
    const ids = capitalObject(capital).geometries.map((g) => String(g.id));
    const decile = areaDeciles(capital.areas, v);
    entry.map.paint(
      t.census.capital.mapAria(capital.name),
      (i) => {
        const a = byId_.get(ids[i]!);
        if (!a) return "no-data";
        if (view.paint === "census") {
          const d = decile(a);
          return d === null ? "no-data" : `q${d}`;
        }
        if (a.pt === null || a.rival === null || !a.valid) return "no-data";
        const lead = a.pt >= a.rival ? "red" : "blue";
        const partial = a.coverage !== null && a.coverage < LOW_COVERAGE ? " cp-partial" : "";
        return `c-${lead} s${shade(Math.abs(a.pt - a.rival))}${partial}`;
      },
      (i) => {
        const a = byId_.get(ids[i]!);
        return a ? this.tooltip(capital, a, view) : "";
      },
    );
    byId("cp-map-cap").textContent =
      view.paint === "vote"
        ? t.census.capital.mapCapVote(view.pt, view.rival, t.census.capital.per[this.level])
        : t.census.capital.mapCapCensus(t.census.vars[v]!, t.census.capital.per[this.level]);
    byId("cp-map-legend").innerHTML =
      view.paint === "vote"
        ? [
            [view.pt, "red"],
            [view.rival, "blue"],
          ]
            .map(
              ([name, c]) =>
                `<span class="map-steps">${escapeHtml(name!)}</span>` +
                MARGIN_STEPS.map((_, k) => `<i class="map-key c-${c} s${k}"></i>`).join(""),
            )
            .join(" ") +
          `<span class="map-steps"><i class="map-key no-data"></i> ${t.census.capital.noVotes}</span>` +
          (capital.missing
            ? `<span class="map-steps"><i class="map-key c-red s3 cp-partial-key"></i> ${t.census.capital.lowCoverage}</span>`
            : "")
        : legend(t.census.varLong[v]!, false);
  }

  private tooltip(capital: Capital, a: Area, view: CapitalView): string {
    const row = (label: string, value: string) =>
      `<div class="row"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
    const vars = TOOLTIP_VARS.map((x) => {
      const val = areaValue(a, x);
      return row(t.census.vars[x]!, val === null ? "—" : escapeHtml(t.census.format(x, val)));
    });
    return (
      `<div class="tt-h">${escapeHtml(t.census.capital.area(a.bairros) || capital.name)}</div>` +
      `<div class="tt-s">${escapeHtml(capital.name)} · ${integer(a.population)} hab.</div>` +
      (a.valid
        ? row(view.pt, a.pt === null ? "—" : percent(a.pt)) +
          row(view.rival, a.rival === null ? "—" : percent(a.rival))
        : `<div class="tt-s">${t.census.capital.noVotes}</div>`) +
      (a.coverage !== null && a.coverage < 99
        ? `<div class="tt-s tt-foot">${t.census.capital.coverage(a.coverage)}</div>`
        : "") +
      `<div class="tt-s tt-foot"></div>` +
      vars.join("")
    );
  }
}
