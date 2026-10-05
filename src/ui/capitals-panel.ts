import { geoMercator } from "d3-geo";

import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  AREA_VARS,
  areaDeciles,
  areaLine,
  areaValue,
  areaVote,
  capitalObject,
  type Area,
  type Capital,
  type CapitalsData,
  LOW_COVERAGE,
} from "../model/capitals";
import { isLog, type CensusVar } from "../model/census-vote";
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
  v: CensusVar;
  other: CensusVar;
  side: "pt" | "rival";
  /** Names of the PT's candidate and the rival in 2026. */
  pt: string;
  rival: string;
}

export const DEFAULT_CAPITAL = "3550308"; // São Paulo
const LOG_TICKS: Partial<Record<CensusVar, number[]>> = {
  income: [500, 1000, 2000, 4000, 8000, 16000],
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

  constructor(
    private readonly data: CapitalsData,
    onPick: (patch: { capital?: string; paint?: Paint }) => void,
  ) {
    const select = byId<HTMLSelectElement>("cp-capital");
    [...data.capitals]
      .sort((a, b) => a.name.localeCompare(b.name, t.locale))
      .forEach((c) => select.add(new Option(`${c.name} (${c.uf})`, c.code)));
    select.addEventListener("change", () => onPick({ capital: select.value }));
    byId("cp-paint")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => onPick({ paint: b.dataset.paint as Paint })));
    this.scatter = new Scatter(byId("cp-scatter"));
    byId("cp-zoom-in").addEventListener("click", () => this.current?.zoomIn());
    byId("cp-zoom-out").addEventListener("click", () => this.current?.zoomOut());
    byId("cp-zoom-reset").addEventListener("click", () => this.current?.fit(null));
  }

  private get current(): ChoroplethMap | undefined {
    return this.shown ? this.maps.get(this.shown)?.map : undefined;
  }

  render(view: CapitalView): void {
    const capital = this.data.capitals.find((c) => c.code === view.capital)!;
    // No urban share by area: fall back to income, and say so.
    const v = AREA_VARS.includes(view.v) ? view.v : "income";
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
    byId("cp-title").textContent = t.census.capital.title(capital.name, view.pt, view.rival);
    byId("cp-meta").textContent = t.census.capital.meta(capital.areas.length, percent(capital.placed));
    byId("cp-warning").textContent =
      t.census.capital.warning +
      (v !== view.v ? ` ${t.census.capital.noUrban}.` : "") +
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
      axisLabel: v === "income" ? t.census.unit(v, 2022) : t.census.varLong[v]!,
      tooltip: (i) => this.tooltip(capital, capital.areas[i]!, view),
    });
    byId("cp-scatter-cap").textContent = t.census.capital.scatterCap(
      t.census.vars[v]!,
      who,
      t.census.vars[other]!.toLowerCase(),
    );
    byId("cp-scatter-legend").innerHTML = legend(t.census.otherLegend(t.census.varLong[other]!), true);

    this.renderMap(capital, view, v);
    byId("cp-note").textContent = `${t.census.capital.onlyFirstRound2026} ${t.census.capital.note}`;
    byId("cp-sources").innerHTML = sourcesHtml([
      t.sources.tseBallots,
      t.sources.tsePlaces,
      t.sources.ibgeAreas,
      t.sources.ibgeTracts,
    ]);
  }

  private renderMap(capital: Capital, view: CapitalView, v: CensusVar): void {
    const box = byId("cp-map");
    let entry = this.maps.get(capital.code);
    if (!entry) {
      const host = document.createElement("div");
      host.className = "cp-map-host";
      box.append(host);
      const object = capitalObject(this.data, capital.code);
      entry = {
        host,
        map: new ChoroplethMap(host, {
          topology: this.data.topology,
          object,
          groups: object.geometries.map((g) => String(g.id)),
          projection: geoMercator(),
          width: 800,
          height: 700,
          maxZoom: 8,
        }),
      };
      this.maps.set(capital.code, entry);
    }
    for (const [code, m] of this.maps) m.host.hidden = code !== capital.code;
    this.shown = capital.code;

    const byId_ = new Map(capital.areas.map((a) => [a.id, a]));
    const ids = capitalObject(this.data, capital.code).geometries.map((g) => String(g.id));
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
        ? t.census.capital.mapCapVote(view.pt, view.rival)
        : t.census.capital.mapCapCensus(t.census.vars[v]!);
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
    const vars = AREA_VARS.filter((x) => x !== "population").map((x) => {
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
