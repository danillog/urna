import { geoAzimuthalEqualArea } from "d3-geo";
import type { GeometryCollection, Topology } from "topojson-specification";

import { escapeHtml, formatIsoDate, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  FIRST_YEAR,
  countByFamily,
  electionAt,
  lastYear,
  regionFamily,
  type AmericasData,
  type Family,
} from "../model/americas";
import {
  STEPS,
  hdiTier,
  rank,
  step,
  valueAt,
  type IndicatorData,
  type IndicatorKey,
} from "../model/indicators";
import { button, byId } from "./dom";
import { ChoroplethMap } from "./map";

export type Layer = "politics" | IndicatorKey;
const LAYERS: Layer[] = ["politics", "hdi", "income", "prices", "democracy"];

export interface AmericasState {
  year: number;
  /** What colors the map: election results, or a country indicator. */
  layer: Layer;
  /** Group standing out on the map: a family, or an indicator band ("0", "1"…). */
  focus: string | null;
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
  const layer = LAYERS.find((l) => l === params.get("layer")) ?? "politics";
  const country = params.get("country")?.toUpperCase() ?? null;
  return {
    year: year >= FIRST_YEAR && year <= lastYear(data) ? year : lastYear(data),
    layer,
    focus: params.get("focus"),
    country: country && data.countries[country] ? country : null,
  };
}

export function americasToSearch(s: AmericasState, params: URLSearchParams): void {
  if (s.layer !== "politics") params.set("layer", s.layer);
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
  private highlighted: string | null = null;
  private painted: string | null = null;
  private readonly years: number[];

  constructor(
    private readonly data: AmericasData,
    private readonly topology: Topology<{ americas: GeometryCollection<AreaProps> }>,
    private readonly indicators: IndicatorData,
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

    byId("am-layers")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => this.set({ layer: b.dataset.layer as Layer, focus: null })),
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
    byId("am-layers")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === s.layer)));
    byId("am-title").textContent =
      s.layer === "politics" ? t.americasTitle(s.year) : t.indicator[s.layer].title(s.year);

    const key = `${s.layer}:${s.year}`;
    if (this.painted !== key) {
      this.painted = key;
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

  private familyOf(i: number): Family | null {
    const area = this.areas[i]!;
    const country = this.data.countries[area.country];
    return country ? regionFamily(country, this.state.year, area.code) : null;
  }

  /** The legend group an area belongs to in the current layer. */
  private groupOf(i: number): string | null {
    const layer = this.state.layer;
    if (layer === "politics") return this.familyOf(i);
    const area = this.areas[i]!;
    const reading = valueAt(this.indicators, layer, area.country, this.state.year, area.code);
    return reading ? String(step(layer, reading.value)) : null;
  }

  private classFor(i: number): string {
    if (!this.data.countries[this.areas[i]!.country]) return "territory";
    const group = this.groupOf(i);
    if (group === null) return "no-data";
    return this.state.layer === "politics" ? `f-${group}` : `q${group}`;
  }

  private renderLegend(): void {
    const layer = this.state.layer;
    if (layer !== "politics") return this.renderIndicatorLegend(layer);
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

  private renderIndicatorLegend(layer: IndicatorKey): void {
    const counts = STEPS[layer].map(() => 0);
    for (const iso of Object.keys(this.data.countries)) {
      const reading = valueAt(this.indicators, layer, iso, this.state.year);
      if (reading) counts[step(layer, reading.value)]! += 1;
    }
    const copy = t.indicator[layer];
    const el = byId("am-legend");
    el.replaceChildren(
      ...STEPS[layer].map((from, k) => {
        const chip = button(
          `<i class="map-key q${k}"></i><span>${copy.step(from, STEPS[layer][k + 1])}</span><span class="n">${integer(counts[k]!)}</span>`,
          { className: "chip map-chip compact" },
        );
        chip.dataset.group = String(k);
        chip.title = t.mapFocus;
        chip.addEventListener("click", () =>
          this.set({ focus: this.state.focus === String(k) ? null : String(k) }),
        );
        return chip;
      }),
    );
    const source = document.createElement("span");
    source.className = "map-steps";
    source.innerHTML = `${copy.unit} · <i class="map-key no-data"></i> ${t.indicatorNoData} · ${t.indicatorSource(
      escapeHtml(this.indicators.indicators[layer].source),
    )}`;
    el.append(source);
  }

  private renderFocus(): void {
    const focus = this.state.focus;
    byId("am-legend")
      .querySelectorAll<HTMLButtonElement>(".map-chip")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === focus)));
    if (focus === this.highlighted) return;
    this.highlighted = focus;
    const indices = focus ? this.areas.flatMap((_, i) => (this.groupOf(i) === focus ? [i] : [])) : null;
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
    if (this.state.layer !== "politics")
      return head + this.indicatorTooltip(this.state.layer, area.country, area.code);
    if (country.system === "non-competitive")
      return head + `<div class="tt-s">${t.americasNonCompetitive}</div>`;
    const e = electionAt(country, this.state.year);
    if (!e) return head + `<div class="tt-s">${t.americasNoElectionYet(FIRST_YEAR)}</div>`;
    const when = t.americasElection(country.system, formatIsoDate(e.date));
    if (e.status === "annulled")
      return head + `<div class="tt-s">${when}</div><div>${t.americasAnnulled}</div>`;
    const disputed = e.status === "disputed" ? `<div class="tt-s tt-foot">${t.americasDisputed}</div>` : "";
    const row = e.regions?.[area.code];
    if (row && e.regionCandidates) {
      const [w, ws, r, rs] = row;
      const line = (k: number, share: number) => {
        const c = e.regionCandidates![k]!;
        const swatch = c.family ? `f-${c.family}` : "no-data";
        return `<div class="row"><span class="key"><i class="map-key ${swatch}"></i>${escapeHtml(c.name)}</span><b>${percent(share / 10)}</b></div>`;
      };
      return (
        head +
        `<div class="tt-s">${when} · ${t.americasHere}</div>` +
        line(w, ws) +
        line(r, rs) +
        `<div class="tt-s tt-foot">${t.americasNational(escapeHtml(e.winner ?? ""), t.family[e.family!]!)}</div>` +
        `<div class="tt-s tt-foot">${escapeHtml(t.americasRegionSource(e.regionSource ?? ""))}</div>` +
        disputed
      );
    }
    return (
      head +
      `<div class="tt-s">${when}</div>` +
      `<div class="row"><span class="key"><i class="map-key f-${e.family}"></i>${escapeHtml(e.winner ?? "")}</span><b>${escapeHtml(e.party ?? "")}</b></div>` +
      `<div class="tt-s tt-foot">${t.family[e.family!]} · ${escapeHtml(e.familySource ?? "")}</div>` +
      `<div class="tt-s tt-foot">${t.americasNationalOnly}</div>` +
      disputed
    );
  }

  private indicatorTooltip(layer: IndicatorKey, iso: string, region: string): string {
    const copy = t.indicator[layer];
    const indicator = this.indicators.indicators[layer];
    if (indicator.regions?.[region]) return this.regionTooltip(layer, iso, region);
    const reading = valueAt(this.indicators, layer, iso, this.state.year);
    if (!reading) return `<div class="tt-s">${t.indicatorNoData}</div>`;
    const [position, total] = rank(this.indicators, layer, iso, this.state.year);
    const first = valueAt(this.indicators, layer, iso, this.indicators.firstYear);
    const notes = [
      layer === "hdi" ? t.hdiTier[hdiTier(reading.value)] : null,
      t.indicatorRank(position, total),
      reading.year < this.state.year ? t.indicatorLatest(reading.year) : null,
      first && first.year < reading.year ? t.indicatorThen(copy.format(first.value), first.year) : null,
      this.indicators.indicators[layer].urbanOnly?.includes(iso) ? t.indicatorUrbanOnly : null,
    ].filter(Boolean);
    return (
      `<div class="row"><span class="key"><i class="map-key q${step(layer, reading.value)}"></i>${copy.name}</span><b>${copy.format(reading.value)}</b></div>` +
      notes.map((n) => `<div class="tt-s tt-foot">${n}</div>`).join("")
    );
  }

  /** A state with its own series (Brazil's IDHM): its value, and the country's next to it. */
  private regionTooltip(layer: IndicatorKey, iso: string, region: string): string {
    const copy = t.indicator[layer];
    const reading = valueAt(this.indicators, layer, iso, this.state.year, region);
    if (!reading) return `<div class="tt-s">${t.indicatorNoData}</div>`;
    const national = valueAt(this.indicators, layer, iso, this.state.year);
    const first = valueAt(this.indicators, layer, iso, this.indicators.firstYear, region);
    const notes = [
      layer === "hdi" ? t.hdiTier[hdiTier(reading.value)] : null,
      reading.year < this.state.year ? t.indicatorLatest(reading.year) : null,
      first && first.year < reading.year ? t.indicatorThen(copy.format(first.value), first.year) : null,
      national ? t.indicatorCountry(copy.format(national.value), national.year) : null,
      escapeHtml(this.indicators.indicators[layer].regionSource ?? ""),
    ].filter(Boolean);
    return (
      `<div class="row"><span class="key"><i class="map-key q${step(layer, reading.value)}"></i>${t.indicatorRegionName[layer] ?? copy.name}</span><b>${copy.format(reading.value)}</b></div>` +
      notes.map((n) => `<div class="tt-s tt-foot">${n}</div>`).join("")
    );
  }
}
