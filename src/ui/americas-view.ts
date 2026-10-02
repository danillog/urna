import { geoAzimuthalEqualArea } from "d3-geo";
import type { GeometryCollection, Topology } from "topojson-specification";

import { escapeHtml, formatIsoDate, integer } from "../format";
import { t } from "../i18n/pt-BR";
import {
  FIRST_YEAR,
  countByFamily,
  electionAt,
  familyAt,
  lastYear,
  type AmericasData,
  type Family,
} from "../model/americas";
import { button, byId } from "./dom";
import { ChoroplethMap } from "./map";

export interface AmericasState {
  year: number;
  /** Family standing out on the map. */
  focus: Family | null;
  /** Country the map is zoomed to. */
  country: string | null;
}

interface AreaProps {
  name: string;
  country: string;
  code: string;
}

const PLAY_STEP_MS = 1100;

export function americasFromSearch(data: AmericasData, params: URLSearchParams): AmericasState {
  const year = Number(params.get("year"));
  const focus = params.get("focus") as Family | null;
  const country = params.get("country")?.toUpperCase() ?? null;
  return {
    year: year >= FIRST_YEAR && year <= lastYear(data) ? year : lastYear(data),
    focus: focus && data.families.includes(focus) ? focus : null,
    country: country && data.countries[country] ? country : null,
  };
}

export function americasToSearch(s: AmericasState, params: URLSearchParams): void {
  params.set("year", String(s.year));
  if (s.focus) params.set("focus", s.focus);
  if (s.country) params.set("country", s.country);
}

/** The Americas tab: a year slider and every country colored by its winner's family. */
export class AmericasView {
  private drawing: ChoroplethMap | null = null;
  private readonly areas: AreaProps[];
  private timer: number | undefined;
  private framed: string | null | undefined = undefined;
  private highlighted: Family | null = null;
  private painted: number | null = null;
  private readonly years: number[];

  constructor(
    private readonly data: AmericasData,
    private readonly topology: Topology<{ americas: GeometryCollection<AreaProps> }>,
    private state: AmericasState,
    private readonly onChange: (s: AmericasState) => void,
  ) {
    this.areas = topology.objects.americas.geometries.map((g) => g.properties as AreaProps);
    this.years = Array.from({ length: lastYear(data) - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

    const slider = byId<HTMLInputElement>("am-slider");
    slider.max = String(this.years.length - 1);
    slider.addEventListener("input", () => this.set({ year: this.years[Number(slider.value)]! }, true));
    byId("am-play").addEventListener("click", () => (this.timer ? this.stop() : this.play()));
    byId("am-years").replaceChildren(
      ...this.years
        .filter((y) => y % 2 === 0)
        .map((year) => {
          const b = button(String(year), { className: "timeline-year" });
          b.dataset.year = String(year);
          b.addEventListener("click", () => this.set({ year }, true));
          return b;
        }),
    );

    const select = byId<HTMLSelectElement>("am-country");
    select.add(new Option(t.americasWhole, ""));
    Object.entries(data.countries)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, t.locale))
      .forEach(([iso, c]) => select.add(new Option(c.name, iso)));
    select.addEventListener("change", () => this.set({ country: select.value || null }));
    byId("am-zoom-in").addEventListener("click", () => this.drawing?.zoomIn());
    byId("am-zoom-out").addEventListener("click", () => this.drawing?.zoomOut());
    byId("am-zoom-reset").addEventListener("click", () =>
      this.state.country ? this.set({ country: null }) : this.drawing?.fit(null),
    );
  }

  get current(): AmericasState {
    return this.state;
  }

  set(patch: Partial<AmericasState>, stop = false): void {
    if (stop) this.stop();
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  play(): void {
    if (this.state.year === this.years.at(-1)) this.set({ year: this.years[0]! });
    this.timer = window.setInterval(() => {
      const next = this.years[this.years.indexOf(this.state.year) + 1];
      if (next === undefined) this.stop();
      else this.set({ year: next });
    }, PLAY_STEP_MS);
    this.renderPlayButton();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.renderPlayButton();
  }

  private renderPlayButton(): void {
    const b = byId("am-play");
    b.textContent = this.timer ? "❚❚" : "▶";
    b.setAttribute("aria-label", this.timer ? t.mapPause : t.mapPlay);
    b.setAttribute("aria-pressed", String(Boolean(this.timer)));
  }

  render(): void {
    const s = this.state;
    this.drawing ??= new ChoroplethMap(byId("am-map"), {
      topology: this.topology,
      object: this.topology.objects.americas,
      groups: this.areas.map((a) => a.country),
      // Equal-area, centred on the continent: Mercator would inflate Canada and Alaska.
      projection: geoAzimuthalEqualArea().rotate([80, -10]),
      width: 760,
      height: 940,
      maxZoom: 30,
    });

    const slider = byId<HTMLInputElement>("am-slider");
    slider.value = String(this.years.indexOf(s.year));
    slider.setAttribute("aria-valuetext", String(s.year));
    byId("am-years")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.year) === s.year)));
    this.renderPlayButton();
    byId("am-title").textContent = t.americasTitle(s.year);

    if (this.painted !== s.year) {
      this.painted = s.year;
      this.highlighted = null;
      this.renderLegend();
      this.drawing.paint(
        t.americasAria(s.year),
        (i) => this.classFor(i),
        (i) => this.tooltip(i),
      );
    }
    byId<HTMLSelectElement>("am-country").value = s.country ?? "";
    if (this.framed !== s.country) {
      this.drawing.fit(s.country, this.framed !== undefined);
      this.framed = s.country;
    }
    this.renderFocus();
  }

  private classFor(i: number): string {
    const country = this.data.countries[this.areas[i]!.country];
    if (!country) return "territory";
    const family = familyAt(country, this.state.year);
    return family ? `f-${family}` : "no-data";
  }

  private renderLegend(): void {
    const counts = countByFamily(this.data, this.state.year);
    const el = byId("am-legend");
    el.replaceChildren(
      ...this.data.families.map((f) => {
        const b = button(
          `<i class="map-key f-${f}"></i><span>${t.family[f]}</span><span class="n">${integer(counts.get(f)!)}</span>`,
          { className: "chip map-chip" },
        );
        b.dataset.group = f;
        b.title = t.mapFocus;
        b.addEventListener("click", () => this.set({ focus: this.state.focus === f ? null : f }));
        return b;
      }),
    );
    const none = document.createElement("span");
    none.className = "map-steps";
    none.innerHTML = `<i class="map-key no-data"></i> ${t.americasNoResult}`;
    el.append(none);
  }

  private renderFocus(): void {
    const focus = this.state.focus;
    byId("am-legend")
      .querySelectorAll<HTMLButtonElement>(".map-chip")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === focus)));
    if (focus === this.highlighted) return;
    this.highlighted = focus;
    const indices = focus
      ? this.areas.flatMap((a, i) => {
          const c = this.data.countries[a.country];
          return c && familyAt(c, this.state.year) === focus ? [i] : [];
        })
      : null;
    this.drawing!.highlight(indices);
  }

  private tooltip(i: number): string {
    const area = this.areas[i]!;
    const country = this.data.countries[area.country];
    const place = escapeHtml(area.name);
    if (!country) {
      const name = this.data.territories[area.country] ?? area.country;
      return `<div class="tt-h">${escapeHtml(name)}</div><div class="tt-s">${t.americasTerritory}</div>`;
    }
    const head = `<div class="tt-h">${escapeHtml(country.name)}</div><div class="tt-s">${place}</div>`;
    if (country.system === "non-competitive")
      return head + `<div class="tt-s">${t.americasNonCompetitive}</div>`;
    const e = electionAt(country, this.state.year);
    if (!e) return head + `<div class="tt-s">${t.americasNoElectionYet(FIRST_YEAR)}</div>`;
    const when = t.americasElection(country.system, formatIsoDate(e.date));
    if (e.status === "annulled")
      return head + `<div class="tt-s">${when}</div><div>${t.americasAnnulled}</div>`;
    return (
      head +
      `<div class="tt-s">${when}</div>` +
      `<div class="row"><span class="key"><i class="map-key f-${e.family}"></i>${escapeHtml(e.winner ?? "")}</span><b>${escapeHtml(e.party ?? "")}</b></div>` +
      `<div class="tt-s tt-foot">${t.family[e.family!]} · ${escapeHtml(e.familySource ?? "")}</div>` +
      (e.status === "disputed" ? `<div class="tt-s tt-foot">${t.americasDisputed}</div>` : "")
    );
  }
}
