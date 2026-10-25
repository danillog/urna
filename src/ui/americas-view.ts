import { geoAzimuthalEqualArea } from "d3-geo";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { line } from "d3-shape";
import "d3-transition";
import type { GeometryCollection, Topology } from "topojson-specification";

import { escapeHtml, formatIsoDate, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  FIRST_YEAR,
  countByFamily,
  electionAt,
  familyAt,
  lastYear,
  regionFamily,
  type AmericasData,
  type Family,
} from "../model/americas";
import {
  addCompared,
  clampYear,
  comparedReadings,
  nearestYear,
  parseCompared,
  toggleCompared,
  yearSpan,
  type ComparedReading,
} from "../model/americas-compare";
import {
  STEPS,
  colorStep,
  firstDataYear,
  hdiTier,
  officialAt,
  paintAt,
  rank,
  stateSeries,
  step,
  valueAt,
  type IndicatorData,
  type IndicatorKey,
} from "../model/indicators";
import { button, byId } from "./dom";
import { ChoroplethMap } from "./map";
import { sourcesHtml } from "./sources";

export type Layer = "politics" | IndicatorKey;
const LAYERS: Layer[] = ["politics", "hdi", "income", "poverty", "food", "democracy"];

export interface AmericasState {
  year: number;
  /** What colors the map: election results, or a country indicator. */
  layer: Layer;
  /** Group standing out on the map: a family, or an indicator band ("0", "1"…). */
  focus: string | null;
  /** Country the map is zoomed to. */
  country: string | null;
  /** Countries picked on the map to compare below it (ISO3, in the order picked). */
  compare: string[];
}

interface AreaProps {
  name: string;
  country: string;
  code: string;
}

const PLAY_STEP_MS = 1100;
/** Height of one row of the comparison's bars, in px. */
const BAR_ROW = 44;
/** The compared countries' own colors (chips and lines), in the order they were picked. */
const COMPARE_COLORS = ["blue", "red", "gold", "teal", "violet", "pink"];
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function americasFromSearch(data: AmericasData, params: URLSearchParams): AmericasState {
  const year = Number(params.get("year"));
  const layer = LAYERS.find((l) => l === params.get("layer")) ?? "politics";
  const country = params.get("country")?.toUpperCase() ?? null;
  return {
    // Clamped to the layer's own span once the indicators are in (AmericasView).
    year: year >= FIRST_YEAR && year <= lastYear(data) ? year : lastYear(data),
    layer,
    focus: params.get("focus"),
    country: country && data.countries[country] ? country : null,
    compare: parseCompared(data, params.get("comparar")),
  };
}

export function americasToSearch(s: AmericasState, params: URLSearchParams): void {
  if (s.layer !== "politics") params.set("layer", s.layer);
  params.set("year", String(s.year));
  if (s.focus) params.set("focus", s.focus);
  if (s.country) params.set("country", s.country);
  if (s.compare.length) params.set("comparar", s.compare.join(","));
}

/** The Americas tab: a year slider and every country colored by its winner's family. */
export class AmericasView {
  private drawing: ChoroplethMap | null = null;
  private readonly areas: AreaProps[];
  private timer: number | undefined;
  private framed: string | null | undefined = undefined;
  private highlighted: string | null = null;
  private painted: string | null = null;
  /** Years of the active layer's span (food starts later than the rest). */
  private years: number[] = [];
  private spanKey = "";
  /** The year the comparison last showed, so its numbers can run from there. */
  private shownYear: number | null = null;
  /** A click on a 7th country: say why nothing happened. */
  private full = false;
  private mapClicks = false;
  /** The panel's hint as index.html writes it, put back after the "full" warning. */
  private hintText: string | null = null;
  /** The lines chart's reading bar: the year someone moved it to, or null to follow the timeline. */
  private scrubYear: number | null = null;
  /** The timeline year the lines chart last drew, to notice the timeline moving. */
  private linesYear: number | null = null;

  constructor(
    private readonly data: AmericasData,
    private readonly topology: Topology<{ americas: GeometryCollection<AreaProps> }>,
    private readonly indicators: IndicatorData,
    private state: AmericasState,
    private readonly onChange: (s: AmericasState) => void,
  ) {
    this.areas = topology.objects.americas.geometries.map((g) => g.properties as AreaProps);
    this.state = { ...state, year: clampYear(state.year, yearSpan(data, indicators, state.layer)) };

    const slider = byId<HTMLInputElement>("am-slider");
    slider.addEventListener("input", () => this.set({ year: this.years[Number(slider.value)]! }, true));
    byId("am-play").addEventListener("click", () => (this.timer ? this.stop() : this.play()));

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
    // Picking a country frames it and adds it to the comparison (the keyboard's way to compare).
    select.addEventListener("change", () =>
      this.set({
        country: select.value || null,
        compare: select.value ? addCompared(this.state.compare, select.value) : this.state.compare,
      }),
    );
    byId("am-compare-clear").addEventListener("click", () => this.set({ compare: [] }));
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
    const next = { ...this.state, ...patch };
    // A layer covers only its own years: switching to one that starts later moves to its first.
    next.year = clampYear(next.year, yearSpan(this.data, this.indicators, next.layer));
    if (patch.compare) this.full = false;
    this.state = next;
    this.onChange(this.state);
  }

  /** A click on the map: the country goes into the comparison, or out if it was in. */
  private toggleCountry(iso: string): void {
    if (!this.data.countries[iso]) return;
    const list = toggleCompared(this.state.compare, iso);
    if (list === this.state.compare) {
      this.full = true;
      this.renderCompare();
      return;
    }
    this.set({ compare: list });
  }

  /** The slider, the year buttons and ▶ cover the active layer's years only. */
  private renderTimeline(): void {
    const [first, last] = yearSpan(this.data, this.indicators, this.state.layer);
    const key = `${first}-${last}`;
    if (key !== this.spanKey) {
      this.spanKey = key;
      this.years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
      byId<HTMLInputElement>("am-slider").max = String(this.years.length - 1);
      byId("am-years").replaceChildren(
        ...this.years
          .filter((y) => (y - first) % 2 === 0)
          .map((year) => {
            const b = button(String(year), { className: "timeline-year" });
            b.dataset.year = String(year);
            b.addEventListener("click", () => this.set({ year }, true));
            return b;
          }),
      );
    }
    const note = byId("am-span-note");
    const layer = this.state.layer;
    note.hidden = layer === "politics" || first <= FIRST_YEAR;
    if (!note.hidden && layer !== "politics")
      note.textContent = layer === "food" ? t.spanNoteFood : t.spanNote(t.indicator[layer].name, first);
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
    if (!this.mapClicks) {
      this.mapClicks = true;
      this.drawing.onAreaClick((i) => this.toggleCountry(this.areas[i]!.country));
    }

    this.renderTimeline();
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
    this.renderSources();

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
    this.renderCompare();
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
    const reading = paintAt(this.indicators, layer, area.country, this.state.year, area.code);
    return reading ? String(step(layer, reading.value)) : null;
  }

  private classFor(i: number): string {
    const area = this.areas[i]!;
    if (!this.data.countries[area.country]) return "territory";
    const layer = this.state.layer;
    if (layer === "politics") {
      const family = this.familyOf(i);
      return family === null ? "no-data" : `f-${family}`;
    }
    const reading = paintAt(this.indicators, layer, area.country, this.state.year, area.code);
    if (!reading) return "no-data";
    // A fallback survey (older, or of consumption) is painted in its step, faded.
    return `q${colorStep(layer, step(layer, reading.value))}${reading.fallback ? " fallback" : ""}`;
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
          `<i class="map-key q${colorStep(layer, k)}"></i><span>${copy.step(from, STEPS[layer][k + 1])}</span><span class="n">${integer(counts[k]!)}</span>`,
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
    const fallback = Object.keys(this.data.countries).some(
      (iso) => paintAt(this.indicators, layer, iso, this.state.year)?.fallback,
    );
    const source = document.createElement("span");
    source.className = "map-steps";
    source.innerHTML = `${copy.unit} · <i class="map-key no-data"></i> ${t.indicatorNoData}${
      fallback ? ` · <i class="map-key fallback"></i> ${t.indicatorFallbackKey}` : ""
    } · ${t.indicatorSource(escapeHtml(this.indicators.indicators[layer].source))}`;
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
    const reading = paintAt(this.indicators, layer, iso, this.state.year);
    if (!reading) {
      // Before a source's first year (FAO's food insecurity starts in 2015), say that instead.
      const first = firstDataYear(this.indicators, layer);
      const why =
        first !== null && this.state.year < first
          ? layer === "food"
            ? t.foodNotYet(first)
            : null
          : (indicator.missingWhy?.[iso] ?? null);
      return (
        `<div class="tt-s">${t.indicatorNoData}</div>` +
        (why ? `<div class="tt-s tt-foot">${escapeHtml(why)}</div>` : "")
      );
    }
    const first = valueAt(this.indicators, layer, iso, this.indicators.firstYear);
    // A fallback survey is shown but not ranked: it is not measured like the others.
    const position = reading.fallback ? null : rank(this.indicators, layer, iso, this.state.year);
    const official = officialAt(this.indicators, layer, region, this.state.year);
    const notes = [
      layer === "hdi" ? t.hdiTier[hdiTier(reading.value)] : null,
      position ? t.indicatorRank(...position) : null,
      reading.fallback === "consumption"
        ? t.indicatorFallbackConsumption(reading.year)
        : reading.fallback
          ? t.indicatorFallbackOld(reading.year)
          : reading.year < this.state.year
            ? t.indicatorLatest(reading.year)
            : null,
      first && first.year < reading.year ? t.indicatorThen(copy.format(first.value), first.year) : null,
      indicator.urbanOnly?.includes(iso) ? t.indicatorUrbanOnly : null,
      official ? t.indicatorOfficial(copy.format(official.value), official.year) : null,
      official ? t.indicatorOfficialNote : null,
      layer === "food" ? t.foodPeriod(reading.year) : null,
      layer === "food" && indicator.belowFloor?.includes(iso) ? t.foodBelowFloor : null,
      ...(layer === "food" ? this.foodStateNotes(region) : []),
    ].filter(Boolean);
    return (
      `<div class="row"><span class="key"><i class="map-key q${colorStep(layer, step(layer, reading.value))}"></i>${copy.name}</span><b>${copy.format(reading.value)}</b></div>` +
      notes.map((n) => `<div class="tt-s tt-foot">${n}</div>`).join("")
    );
  }

  /** A US or Brazilian state's food insecurity on its country's own scale (USDA, IBGE): the latest
   * period up to the year shown, the earlier ones compactly, and why it is not the map's color. */
  private foodStateNotes(region: string): string[] {
    const ended = (period: string) => Number(period.slice(-4));
    const rows = stateSeries(this.indicators, "food", region).filter(
      (r) => ended(r.period) <= this.state.year,
    );
    const last = rows.at(-1);
    if (!last) return [];
    const us = region.startsWith("US-");
    const format = t.indicator.food.format;
    const earlier = rows
      .slice(0, -1)
      .reverse()
      .map((r) => `${r.period}: ${format(r.value)}`)
      .join(" · ");
    return [
      us ? t.foodUsState(last.period, format(last.value)) : t.foodBrState(last.period, format(last.value)),
      earlier ? t.foodStateEarlier(earlier) : null,
      us ? t.foodUsNote : t.foodBrNote,
    ].filter((n): n is string => n !== null);
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
      `<div class="row"><span class="key"><i class="map-key q${colorStep(layer, step(layer, reading.value))}"></i>${t.indicatorRegionName[layer] ?? copy.name}</span><b>${copy.format(reading.value)}</b></div>` +
      notes.map((n) => `<div class="tt-s tt-foot">${n}</div>`).join("")
    );
  }

  /** Below the map: the countries clicked, as bars for the year (a race while ▶ plays), their
   * series as lines, or, on the politics layer, who governed each year as a strip of colors. */
  private renderCompare(): void {
    const s = this.state;
    const list = s.compare;
    const empty = list.length === 0;
    const hint = byId("am-compare-hint");
    this.hintText ??= hint.textContent ?? "";
    hint.hidden = !empty && !this.full;
    hint.textContent = this.full ? t.compareFull : this.hintText;
    byId("am-compare-clear").hidden = empty;
    this.renderCompareChips();

    const bars = byId("am-compare-bars");
    const lines = byId("am-compare-lines");
    const strips = byId("am-compare-strips");
    const politics = s.layer === "politics";
    bars.hidden = empty || politics;
    lines.hidden = empty || politics;
    strips.hidden = empty || !politics;
    this.renderCompareYear(empty);
    if (empty) {
      this.shownYear = null;
      return;
    }
    if (s.layer === "politics") this.renderStrips(strips);
    else {
      this.renderBars(bars, s.layer);
      this.renderLines(lines, s.layer);
    }
    this.shownYear = s.year;
  }

  private colorOf(iso: string): string {
    return `var(--c-${COMPARE_COLORS[this.state.compare.indexOf(iso) % COMPARE_COLORS.length]})`;
  }

  private renderCompareChips(): void {
    byId("am-compare-chips").replaceChildren(
      ...this.state.compare.map((iso) => {
        const name = this.data.countries[iso]!.name;
        const b = button(
          `<i class="swatch" style="background:${this.colorOf(iso)}"></i>${escapeHtml(name)}<span aria-hidden="true">×</span>`,
          { className: "chip am-compare-chip" },
        );
        b.setAttribute("aria-label", t.compareRemove(name));
        b.addEventListener("click", () => this.set({ compare: toggleCompared(this.state.compare, iso) }));
        return b;
      }),
    );
  }

  /** The year beside the panel's title; while playing, it counts up to the new one. */
  private renderCompareYear(empty: boolean): void {
    const el = byId("am-compare-year");
    const year = this.state.year;
    if (empty) {
      el.textContent = "";
      return;
    }
    const from = this.shownYear;
    if (from === null || from === year || !this.timer || reducedMotion()) {
      el.textContent = String(year);
      return;
    }
    select(el)
      .transition()
      .duration(PLAY_STEP_MS * 0.6)
      .textTween(() => (k) => String(Math.round(from + (year - from) * k)));
  }

  /** Values of the year, the better end on top; bars slide and grow between years. */
  private renderBars(host: HTMLElement, layer: IndicatorKey): void {
    const year = this.state.year;
    const rows = comparedReadings(this.indicators, layer, this.state.compare, year);
    const format = t.indicator[layer].format;
    // One scale for every year of the span, so a bar grows only when the value does.
    const [first, last] = yearSpan(this.data, this.indicators, layer);
    let max = 0;
    for (const iso of this.state.compare)
      for (let y = first; y <= last; y++)
        max = Math.max(max, paintAt(this.indicators, layer, iso, y)?.value ?? 0);
    const width = (v: number | null) => (v === null || !max ? 0 : (v / max) * 100);
    const note = (r: ComparedReading) =>
      r.value === null
        ? ""
        : r.fallback
          ? t.compareFallback
          : r.year !== null && r.year < year
            ? t.compareFrom(r.year)
            : "";
    const animate = this.shownYear !== null && !reducedMotion() && !document.hidden;
    const duration = this.timer ? PLAY_STEP_MS * 0.85 : 350;

    host.style.height = `${rows.length * BAR_ROW}px`;
    const joined = select(host)
      .selectAll<HTMLDivElement, ComparedReading>("div.am-bar-row")
      .data(rows, (d) => d.iso)
      .join((enter) => {
        const row = enter.append("div").attr("class", "am-bar-row").attr("role", "listitem");
        row.append("span").attr("class", "am-bar-name");
        const track = row.append("div").attr("class", "am-bar-track");
        track.append("div").attr("class", "am-bar");
        row.append("span").attr("class", "am-bar-value");
        row.style("transform", (_, i) => `translateY(${i * BAR_ROW}px)`);
        return row;
      });
    joined.attr("aria-label", (d) =>
      t.compareRow(
        this.data.countries[d.iso]!.name,
        d.value === null ? t.compareNoData : format(d.value),
        note(d),
      ),
    );
    joined
      .select(".am-bar-name")
      .html(
        (d) =>
          `<i class="swatch" style="background:${this.colorOf(d.iso)}"></i>${escapeHtml(this.data.countries[d.iso]!.name)}`,
      );
    joined
      .select(".am-bar")
      .attr("class", (d) =>
        d.value === null
          ? "am-bar"
          : `am-bar q${colorStep(layer, step(layer, d.value))}${d.fallback ? " fallback" : ""}`,
      );
    const values = joined.select<HTMLSpanElement>(".am-bar-value");
    const label = (d: ComparedReading) =>
      d.value === null ? t.compareNoData : format(d.value) + (note(d) ? ` · ${note(d)}` : "");
    if (!animate) {
      joined.interrupt().style("transform", (_, i) => `translateY(${i * BAR_ROW}px)`);
      joined.select<HTMLDivElement>(".am-bar").style("width", (d) => `${width(d.value)}%`);
      values.text(label).each(function (d) {
        this.dataset.v = d.value === null ? "" : String(d.value);
      });
      return;
    }
    joined
      .transition()
      .duration(duration)
      .style("transform", (_, i) => `translateY(${i * BAR_ROW}px)`);
    joined
      .select<HTMLDivElement>(".am-bar")
      .transition()
      .duration(duration)
      .style("width", (d) => `${width(d.value)}%`);
    // The number runs from the last year's value to this one's, then settles on its label.
    values.each(function (d) {
      const from = this.dataset.v ? Number(this.dataset.v) : null;
      this.dataset.v = d.value === null ? "" : String(d.value);
      const el = select(this);
      if (from === null || d.value === null) {
        el.text(label(d));
        return;
      }
      const to = d.value;
      el.transition()
        .duration(duration)
        .textTween(() => (k) => (k < 1 ? format(from + (to - from) * k) : label(d)));
    });
  }

  /**
   * Each compared country's series over the layer's years, with a reading bar: a vertical line
   * on one year and, beside it, every compared country's value that year. It follows the
   * timeline; a pointer (mouse, or a finger dragging sideways), a tap or the arrow keys move it,
   * and it goes back to the timeline's year when the pointer leaves or the timeline moves.
   */
  private renderLines(host: HTMLElement, layer: IndicatorKey): void {
    const [first, last] = yearSpan(this.data, this.indicators, layer);
    const format = t.indicator[layer].format;
    const series = this.state.compare.map((iso) => ({
      iso,
      points: Array.from({ length: last - first + 1 }, (_, i) => first + i).flatMap((y) => {
        // Only the years actually measured: the latest-reading rule would draw a flat line
        // past the last survey.
        const r = paintAt(this.indicators, layer, iso, y);
        return r && r.year === y ? [{ y, v: r.value }] : [];
      }),
    }));
    const all = series.flatMap((d) => d.points.map((p) => p.v));
    host.replaceChildren();
    if (this.linesYear !== this.state.year) this.scrubYear = null;
    this.linesYear = this.state.year;
    if (!all.length) return;
    const W = Math.max(300, host.clientWidth || 640);
    const H = 190;
    const m = { top: 12, right: 14, bottom: 24, left: 52 };
    const x = scaleLinear()
      .domain([first, last])
      .range([m.left, W - m.right]);
    const lowest = Math.min(...all);
    const y = scaleLinear()
      .domain([lowest > 0 && lowest > Math.max(...all) / 2 ? lowest * 0.9 : 0, Math.max(...all)])
      .nice()
      .range([H - m.bottom, m.top]);
    const svg = select(host)
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("class", "am-lines-chart")
      .attr("role", "img")
      .attr("aria-label", t.compareLines(t.indicator[layer].name, first, last));
    const axis = svg.append("g").attr("class", "tick");
    for (const v of y.ticks(4)) {
      axis
        .append("line")
        .attr("x1", m.left)
        .attr("x2", W - m.right)
        .attr("y1", y(v))
        .attr("y2", y(v))
        .attr("class", "am-grid");
      axis
        .append("text")
        .attr("x", m.left - 6)
        .attr("y", y(v))
        .attr("dy", "0.32em")
        .attr("text-anchor", "end")
        .text(format(v));
    }
    const step = last - first > 12 ? 5 : 2;
    for (let yr = first; yr <= last; yr++) {
      if ((yr - first) % step && yr !== last) continue;
      // The last year always gets its label; a regular tick too close to it gives way.
      if (yr !== last && x(last) - x(yr) < 34) continue;
      axis
        .append("text")
        .attr("x", x(yr))
        .attr("y", H - 6)
        .attr("text-anchor", "middle")
        .text(String(yr));
    }
    const draw = line<{ y: number; v: number }>()
      .x((p) => x(p.y))
      .y((p) => y(p.v));
    for (const d of series) {
      if (!d.points.length) continue;
      svg
        .append("path")
        .attr("d", draw(d.points))
        .attr("fill", "none")
        .attr("stroke", this.colorOf(d.iso))
        .attr("stroke-width", 2.5)
        .attr("stroke-linejoin", "round");
    }

    // The reading bar, its dots and the readout beside it.
    const bar = svg.append("g").attr("class", "am-reading");
    const rule = bar
      .append("line")
      .attr("class", "am-now")
      .attr("y1", m.top)
      .attr("y2", H - m.bottom);
    const dots = bar.append("g");
    const readout = document.createElement("div");
    readout.className = "am-readout";
    const live = document.createElement("div");
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    host.append(readout, live);
    // Years a pointer snaps to: any compared country measured that year.
    const measured = [...new Set(series.flatMap((d) => d.points.map((p) => p.y)))].sort((a, b) => a - b);
    const note = (r: ComparedReading, year: number) =>
      r.value === null
        ? ""
        : r.fallback
          ? t.compareFallback
          : r.year !== null && r.year < year
            ? t.compareFrom(r.year)
            : "";

    const show = (year: number, announce: boolean) => {
      const bx = x(year);
      rule.attr("x1", bx).attr("x2", bx);
      const rows = comparedReadings(this.indicators, layer, this.state.compare, year);
      dots.selectAll("circle").remove();
      for (const r of rows) {
        if (r.value === null || r.year === null) continue;
        dots
          .append("circle")
          .attr("cx", x(r.year))
          .attr("cy", y(r.value))
          .attr("r", r.year === year ? 5 : 3.5)
          .attr("fill", r.year === year ? this.colorOf(r.iso) : "var(--surface)")
          .attr("stroke", r.year === year ? "var(--surface)" : this.colorOf(r.iso))
          .attr("stroke-width", 2);
      }
      const name = (iso: string) => escapeHtml(this.data.countries[iso]!.name);
      readout.innerHTML =
        `<b class="am-readout-year">${year}</b>` +
        rows
          .map((r) => {
            const value = r.value === null ? t.compareNoData : format(r.value);
            const extra = note(r, year);
            return (
              `<span class="am-readout-row${r.value === null ? " none" : ""}">` +
              `<i class="swatch" style="background:${this.colorOf(r.iso)}"></i>${name(r.iso)} ` +
              `<b>${value}</b>${extra ? ` <small>${escapeHtml(extra)}</small>` : ""}</span>`
            );
          })
          .join("");
      // Beside the bar, on the side with room; never over the bar's own dots.
      const share = (bx / W) * 100;
      const flip = share > 55;
      readout.classList.toggle("flip", flip);
      readout.style.left = flip ? "" : `calc(${share}% + 10px)`;
      readout.style.right = flip ? `calc(${100 - share}% + 10px)` : "";
      readout.dataset.year = String(year);
      if (announce)
        live.textContent = `${year}: ${rows
          .map((r) =>
            t.compareRow(
              this.data.countries[r.iso]!.name,
              r.value === null ? t.compareNoData : format(r.value),
              note(r, year),
            ),
          )
          .join("; ")}`;
    };
    show(this.scrubYear ?? this.state.year, false);

    // Pointer: the viewBox x of the event, then the nearest measured year.
    const node = svg.node()!;
    node.setAttribute("tabindex", "0");
    const yearAt = (clientX: number) => {
      const box = node.getBoundingClientRect();
      const px = box.width ? ((clientX - box.left) / box.width) * W : clientX;
      return nearestYear(measured, x.invert(px));
    };
    const scrub = (clientX: number) => {
      const year = yearAt(clientX);
      if (year === null || year === this.scrubYear) return;
      this.scrubYear = year;
      show(year, true);
    };
    const release = () => {
      this.scrubYear = null;
      show(this.state.year, false);
    };
    node.addEventListener("pointerdown", (e) => {
      // Keep a finger's drag on the chart even when it strays off it.
      if (e.pointerType !== "mouse")
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // Not an active pointer (a synthetic event): nothing to capture.
        }
      scrub(e.clientX);
    });
    node.addEventListener("pointermove", (e) => {
      // A finger only scrubs while down (a drag); a mouse scrubs on hover.
      if (e.pointerType !== "mouse" && !e.buttons) return;
      scrub(e.clientX);
    });
    // A mouse leaving gives the bar back to the timeline; a tap leaves it where it was put.
    node.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") release();
    });
    node.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const from = this.scrubYear ?? this.state.year;
      const year = clampYear(from + (e.key === "ArrowLeft" ? -1 : 1), [first, last]);
      this.scrubYear = year;
      show(year, true);
    });
    node.addEventListener("blur", release);
  }

  /** Politics: one strip per country, a cell per year in the color of who governed. */
  private renderStrips(host: HTMLElement): void {
    const [first, last] = yearSpan(this.data, this.indicators, "politics");
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const caption = document.createElement("p");
    caption.className = "map-note";
    caption.textContent = t.compareGoverned(first, last);
    host.replaceChildren(
      caption,
      ...this.state.compare.map((iso) => {
        const country = this.data.countries[iso]!;
        const row = document.createElement("div");
        row.className = "am-strip-row";
        const cells = years.map((y) => {
          const f = familyAt(country, y);
          return { y, f, label: `${y}: ${f ? t.family[f] : t.americasNoResult}` };
        });
        row.setAttribute("role", "img");
        row.setAttribute("aria-label", t.compareStrip(country.name, cells.map((c) => c.label).join("; ")));
        const name = document.createElement("span");
        name.className = "am-bar-name";
        name.innerHTML = `<i class="swatch" style="background:${this.colorOf(iso)}"></i>${escapeHtml(country.name)}`;
        const strip = document.createElement("div");
        strip.className = "am-strip";
        strip.style.gridTemplateColumns = `repeat(${years.length}, 1fr)`;
        strip.append(
          ...cells.map((c) => {
            const cell = document.createElement("span");
            cell.className = `${c.f ? `f-${c.f}` : "no-data"}${c.y === this.state.year ? " now" : ""}`;
            cell.title = c.label;
            return cell;
          }),
        );
        row.append(name, strip);
        return row;
      }),
    );
  }

  /** Links behind the map: the layer's source, and, for a country picked, its election's article. */
  private renderSources(): void {
    const s = this.state;
    const S = t.sources;
    const layer =
      s.layer === "politics"
        ? [S.globalPartySurvey, S.naturalEarth]
        : s.layer === "hdi"
          ? [S.undpHdr, S.atlas, S.naturalEarth]
          : s.layer === "income" || s.layer === "poverty"
            ? [S.worldBankPip, S.naturalEarth]
            : s.layer === "food"
              ? [S.faoFies, S.usdaFoodSecurity, S.ibgeEbia, S.naturalEarth]
              : [S.vdem, S.naturalEarth];
    const country = s.country ? this.data.countries[s.country] : undefined;
    const e = country ? electionAt(country, s.year) : null;
    const article = e
      ? [
          {
            label: S.wikipediaElection(e.article),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(e.article.replace(/ /g, "_"))}`,
          },
        ]
      : [];
    byId("am-sources").innerHTML = sourcesHtml([...article, ...layer]);
  }
}
