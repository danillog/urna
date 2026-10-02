import { geoMercator } from "d3-geo";

import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  MARGIN_STEPS,
  NONE,
  OTHERS,
  margin,
  raceKey,
  shade,
  winsByGroup,
  type MapData,
  type MapOffice,
  type GroupWins,
  type MapRace,
} from "../model/map-data";
import type { MunicipalMap, RoundId } from "../types";
import { button, byId } from "./dom";
import { STEPS, hdiTier, step } from "../model/indicators";
import { ChoroplethMap } from "./map";

export interface MapState {
  office: MapOffice;
  year: number;
  round: RoundId;
  /** Color group (candidate or party lineage) standing out on the map. */
  focus: string | null;
  /** State the map is zoomed to; null shows the whole country. */
  uf: string | null;
}

/** Time between elections while the timeline plays. */
const PLAY_STEP_MS = 1400;
/** How long the "ctrl + scroll to zoom" hint stays up. */
const HINT_MS = 1500;

export function defaultMapState(data: MapData): MapState {
  return { office: "president", year: data.years("president").at(-1)!, round: "r1", focus: null, uf: null };
}

/** Pulls the state back to an election that exists (nearest year, first round if needed). */
export function normalizeMapState(data: MapData, s: MapState): MapState {
  const years = data.years(s.office);
  const year = years.includes(s.year)
    ? s.year
    : years.reduce((best, y) => (Math.abs(y - s.year) <= Math.abs(best - s.year) ? y : best));
  const round = s.office === "president" && !data.rounds(year).includes(s.round) ? "r1" : s.round;
  return { ...s, year, round };
}

export function mapFromSearch(data: MapData, params: URLSearchParams): MapState {
  const s = defaultMapState(data);
  const office = params.get("office");
  if (office === "president" || office === "mayor" || office === "idhm") s.office = office;
  const year = Number(params.get("year"));
  if (year) s.year = year;
  if (params.get("round") === "r2") s.round = "r2";
  s.focus = params.get("focus");
  s.uf = params.get("uf")?.toUpperCase() ?? null;
  return normalizeMapState(data, s);
}

export function mapToSearch(s: MapState, params: URLSearchParams): void {
  params.set("office", s.office);
  params.set("year", String(s.year));
  if (s.office === "president" && s.round === "r2") params.set("round", "r2");
  if (s.focus) params.set("focus", s.focus);
  if (s.uf) params.set("uf", s.uf);
}

function tooltip(map: MunicipalMap, race: MapRace, i: number): string {
  const place = `${escapeHtml(map.municipalities.names[i]!)} (${map.municipalities.uf[i]})`;
  const w = race.winner[i]!;
  if (w === NONE) return `<div class="tt-h">${place}</div><div class="tt-s">${t.mapNoData}</div>`;
  const key = (label: number) =>
    `<i class="map-key c-${race.groupColors[race.groups[label]!] ?? "gray"}"></i>`;
  const row = (label: number, name: string, share: number) =>
    `<div class="row"><span class="key">${key(label)}${name}</span><b>${percent(share / 10)}</b></div>`;
  const winnerName =
    race.office === "mayor"
      ? `${escapeHtml(race.mayors![i]!)} (${escapeHtml(race.labels[w]!)})`
      : escapeHtml(race.labels[w]!);
  const s = race.second[i]!;
  return (
    `<div class="tt-h">${place}</div>` +
    `<div class="tt-s">${race.office === "mayor" ? t.mapMayorElected(race.year) : t.mapVotes(integer(race.votes[i]!))}</div>` +
    row(w, winnerName, race.winnerShare[i]!) +
    (s !== NONE ? row(s, escapeHtml(race.labels[s]!), race.secondShare[i]!) : "") +
    (race.office === "mayor"
      ? `<div class="tt-s tt-foot">${s === NONE ? t.mapUnopposed : t.mapVotes(integer(race.votes[i]!))}</div>`
      : "")
  );
}

/** The map tab: office, round, a timeline of elections and the map itself. */
export class MapView {
  private drawing: ChoroplethMap | null = null;
  private timer: number | undefined;
  private hintTimer: number | undefined;
  /** State currently framed, to move the camera only when the selection changes. */
  private framed: string | null | undefined = undefined;
  /** Election on screen, so a party click only redraws the highlight. */
  /** What is on screen: its key, and the legend group of each municipality. */
  private shown: { key: string; groups: Set<string>; groupOf: (i: number) => string | null } | null = null;
  private timelineOffice: MapOffice | null = null;
  private highlighted: string | null = null;

  constructor(
    private readonly data: MapData,
    private state: MapState,
    private readonly onChange: (s: MapState) => void,
    stateNames: Record<string, string>,
  ) {
    const select = byId<HTMLSelectElement>("map-uf");
    select.add(new Option(t.mapWholeCountry, ""));
    Object.entries(stateNames)
      .sort((a, b) => a[1].localeCompare(b[1], t.locale))
      .forEach(([uf, name]) => select.add(new Option(t.state(name, uf), uf)));
    if (this.state.uf && !(this.state.uf in stateNames)) this.state = { ...this.state, uf: null };
    select.addEventListener("change", () => this.set({ uf: select.value || null }));
    byId("map-zoom-in").addEventListener("click", () => this.drawing?.zoomIn());
    byId("map-zoom-out").addEventListener("click", () => this.drawing?.zoomOut());
    byId("map-zoom-reset").addEventListener("click", () => {
      if (this.state.uf) this.set({ uf: null });
      else this.drawing?.fit(null);
    });

    byId("map-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () =>
          this.set({ office: b.dataset.office as MapOffice, focus: null }, { stop: true }),
        ),
      );
    byId("map-rounds")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => this.set({ round: b.dataset.round as RoundId }, { stop: true })),
      );
    const slider = byId<HTMLInputElement>("map-slider");
    slider.addEventListener("input", () =>
      this.set({ year: this.data.years(this.state.office)[Number(slider.value)]! }, { stop: true }),
    );
    byId("map-play").addEventListener("click", () => (this.timer ? this.stop() : this.play()));
  }

  get current(): MapState {
    return this.state;
  }

  set(patch: Partial<MapState>, opts: { stop?: boolean } = {}): void {
    if (opts.stop) this.stop();
    this.state = normalizeMapState(this.data, { ...this.state, ...patch });
    this.onChange(this.state);
  }

  play(): void {
    const years = this.data.years(this.state.office);
    if (this.state.year === years.at(-1)) this.set({ year: years[0]! });
    this.timer = window.setInterval(() => {
      const ys = this.data.years(this.state.office);
      const next = ys[ys.indexOf(this.state.year) + 1];
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
    const b = byId("map-play");
    b.textContent = this.timer ? "❚❚" : "▶";
    b.setAttribute("aria-label", this.timer ? t.mapPause : t.mapPlay);
    b.setAttribute("aria-pressed", String(Boolean(this.timer)));
  }

  render(map: MunicipalMap): void {
    const s = this.state;
    const key = raceKey(s.office, s.year, s.round);
    this.drawing ??= new ChoroplethMap(
      byId("map"),
      {
        topology: map.topology,
        object: map.topology.objects.municipalities,
        groups: map.municipalities.uf,
        projection: geoMercator(),
        width: 800,
        height: 780,
        maxZoom: 40, // deep enough for the smallest municipalities around São Paulo and Recife
      },
      () => this.showHint(),
    );
    if (this.shown?.key !== key) {
      if (s.office === "idhm") this.renderIdhm(map, key);
      else this.renderElection(map, key);
    }
    this.renderCamera();
    this.renderFocus();
  }

  /** Everything that depends on the election itself. */
  private renderElection(map: MunicipalMap, key: string): void {
    const s = this.state;
    const race = this.data.race(key)!;
    const president = s.office === "president";

    byId("map-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.office === s.office)));
    byId("map-round-group").hidden = !president;
    const rounds = president ? this.data.rounds(s.year) : [];
    byId("map-rounds")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.round === s.round));
        b.disabled = !rounds.includes(b.dataset.round as RoundId);
        b.title = b.disabled ? t.mapNoRunoff : "";
      });
    this.renderTimeline();
    this.renderPlayButton();

    const title = president ? t.mapTitlePresident(s.year, t.round[s.round]) : t.mapTitleMayor(s.year);
    byId("map-title").textContent = title;
    const wins = winsByGroup(race);
    this.shown = {
      key,
      groups: new Set(wins.map((w) => w.group)),
      groupOf: (i) => (race.winner[i] === NONE ? null : race.groups[race.winner[i]!]!),
    };
    this.highlighted = null; // the base map changes under it
    byId("map-meta").textContent = t.mapMunicipalities(integer(wins.reduce((n, w) => n + w.wins, 0)));
    byId("map-note").textContent = president ? t.mapNotePresident : t.mapNoteMayor;
    this.renderLegend(race, wins);

    this.drawing!.paint(
      t.mapAria(title),
      (i) => {
        const w = race.winner[i]!;
        if (w === NONE) return "no-data";
        const color = race.groupColors[race.groups[w]!] ?? "gray";
        return president ? `c-${color} s${shade(margin(race, i))}` : `c-${color}`;
      },
      (i) => tooltip(map, race, i),
    );
  }

  private get areaCount(): number {
    return this.data.map.municipalities.names.length;
  }

  /** The municipal HDI of a census year, on the same map. */
  private renderIdhm(map: MunicipalMap, key: string): void {
    const s = this.state;
    const values = this.data.idhm(s.year);
    const first = this.data.idhm(this.data.years("idhm")[0]!);
    byId("map-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.office === s.office)));
    byId("map-round-group").hidden = true;
    this.renderTimeline();
    this.renderPlayButton();
    const level = this.data.idhmLevel(s.year);
    const title = level === "municipality" ? t.mapTitleIdhm(s.year) : t.mapTitleIdhmStates(s.year);
    byId("map-title").textContent = title;
    const groupOf = (i: number) => (values[i] ? String(step("hdi", values[i]! / 1000)) : null);
    const counts = STEPS.hdi.map(() => 0);
    let n = 0;
    values.forEach((v) => {
      if (v) {
        counts[step("hdi", v / 1000)]! += 1;
        n++;
      }
    });
    this.shown = { key, groups: new Set(STEPS.hdi.map((_, k) => String(k))), groupOf };
    this.highlighted = null;
    byId("map-meta").textContent =
      level === "municipality" ? t.mapMunicipalities(integer(n)) : t.mapIdhmStatesMeta;
    byId("map-note").textContent = t.mapNoteIdhm;
    const legend = byId("map-legend");
    legend.replaceChildren(
      ...STEPS.hdi.map((from, k) => {
        const chip = button(
          `<i class="map-key q${k}"></i><span>${t.indicator.hdi.step(from, STEPS.hdi[k + 1])}</span><span class="n">${integer(counts[k]!)}</span>`,
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
    this.drawing!.paint(
      t.mapAria(title),
      (i) => {
        const g = groupOf(i);
        return g === null ? "no-data" : `q${g}`;
      },
      (i) => {
        const place = `${escapeHtml(map.municipalities.names[i]!)} (${map.municipalities.uf[i]})`;
        const v = values[i]! / 1000;
        if (!v) return `<div class="tt-h">${place}</div><div class="tt-s">${t.mapIdhmNoData}</div>`;
        const before = first[i]! / 1000;
        const label = level === "municipality" ? "IDHM" : t.mapIdhmStateLabel(map.municipalities.uf[i]!);
        return (
          `<div class="tt-h">${place}</div>` +
          `<div class="row"><span class="key"><i class="map-key q${step("hdi", v)}"></i>${label}</span><b>${t.indicator.hdi.format(v)}</b></div>` +
          (level === "state" ? `<div class="tt-s tt-foot">${t.mapIdhmStateNote}</div>` : "") +
          `<div class="tt-s tt-foot">${t.hdiTier[hdiTier(v)]}</div>` +
          (before && s.year !== this.data.years("idhm")[0]
            ? `<div class="tt-s tt-foot">${t.indicatorThen(t.indicator.hdi.format(before), this.data.years("idhm")[0]!)}</div>`
            : "")
        );
      },
    );
  }

  private renderCamera(): void {
    const uf = this.state.uf;
    byId<HTMLSelectElement>("map-uf").value = uf ?? "";
    if (this.framed !== uf) {
      this.drawing!.fit(uf, this.framed !== undefined); // no animation on first load
      this.framed = uf;
    }
  }

  /** The highlighted party or candidate: legend state plus the map's highlight layer. */
  private renderFocus(): void {
    const { groups, groupOf } = this.shown!;
    const focus = this.state.focus && groups.has(this.state.focus) ? this.state.focus : null;
    byId("map-legend")
      .querySelectorAll<HTMLButtonElement>(".map-chip")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === focus)));
    if (focus === this.highlighted) return;
    this.highlighted = focus;
    const indices: number[] = [];
    if (focus) for (let i = 0; i < this.areaCount; i++) if (groupOf(i) === focus) indices.push(i);
    this.drawing!.highlight(focus ? indices : null);
  }

  private showHint(): void {
    const hint = byId("map-hint");
    hint.textContent = /Mac|iPhone|iPad/.test(navigator.userAgent) ? t.mapZoomHintMac : t.mapZoomHint;
    hint.hidden = false;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (hint.hidden = true), HINT_MS);
  }

  private renderTimeline(): void {
    const years = this.data.years(this.state.office);
    const slider = byId<HTMLInputElement>("map-slider");
    slider.max = String(years.length - 1);
    slider.value = String(years.indexOf(this.state.year));
    slider.setAttribute("aria-valuetext", String(this.state.year));
    const list = byId("map-years");
    if (this.timelineOffice !== this.state.office) {
      this.timelineOffice = this.state.office;
      list.replaceChildren(
        ...years.map((year) => {
          const b = button(String(year), { className: "timeline-year" });
          b.dataset.year = String(year);
          b.addEventListener("click", () => this.set({ year }, { stop: true }));
          return b;
        }),
      );
    }
    list
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.year) === this.state.year)));
  }

  private renderLegend(race: MapRace, wins: GroupWins[]): void {
    const el = byId("map-legend");
    el.innerHTML = "";
    const president = race.office === "president";
    for (const w of wins) {
      const color = race.groupColors[w.group] ?? "gray";
      const swatches = president
        ? MARGIN_STEPS.map((_, s) => `<i class="map-key c-${color} s${s}"></i>`).join("")
        : `<i class="map-key c-${color}"></i>`;
      const label = w.group === OTHERS ? t.mapOthers : escapeHtml(w.label);
      const b = button(`${swatches}<span>${label}</span><span class="n">${integer(w.wins)}</span>`, {
        className: "chip map-chip",
        pressed: false,
      });
      b.dataset.group = w.group;
      b.title = t.mapFocus;
      b.addEventListener("click", () => this.set({ focus: this.state.focus === w.group ? null : w.group }));
      el.appendChild(b);
    }
    if (president) {
      const steps = MARGIN_STEPS.map((start, i) =>
        MARGIN_STEPS[i + 1] === undefined ? `${start}+` : `${start}–${MARGIN_STEPS[i + 1]}`,
      );
      const note = document.createElement("span");
      note.className = "map-steps";
      note.textContent = t.mapMargin(steps.join(" · "));
      el.appendChild(note);
    }
  }
}
