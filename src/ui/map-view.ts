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
  type MapRace,
} from "../model/map-data";
import type { MunicipalMap, RoundId } from "../types";
import { button, byId } from "./dom";
import { MunicipalityMap } from "./map";

export interface MapState {
  office: MapOffice;
  year: number;
  round: RoundId;
  /** Color group (candidate or party lineage) standing out on the map. */
  focus: string | null;
}

/** Time between elections while the timeline plays. */
const PLAY_STEP_MS = 1400;

export function defaultMapState(data: MapData): MapState {
  return { office: "president", year: data.years("president").at(-1)!, round: "r1", focus: null };
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
  if (office === "president" || office === "mayor") s.office = office;
  const year = Number(params.get("year"));
  if (year) s.year = year;
  if (params.get("round") === "r2") s.round = "r2";
  s.focus = params.get("focus");
  return normalizeMapState(data, s);
}

export function mapToSearch(s: MapState, params: URLSearchParams): void {
  params.set("office", s.office);
  params.set("year", String(s.year));
  if (s.office === "president" && s.round === "r2") params.set("round", "r2");
  if (s.focus) params.set("focus", s.focus);
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
  private drawing: MunicipalityMap | null = null;
  private timer: number | undefined;

  constructor(
    private readonly data: MapData,
    private state: MapState,
    private readonly onChange: (s: MapState) => void,
  ) {
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
    const race = this.data.race(raceKey(s.office, s.year, s.round))!;
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
    byId("map-meta").textContent = t.mapMunicipalities(integer(wins.reduce((n, w) => n + w.wins, 0)));
    byId("map-note").textContent = president ? t.mapNotePresident : t.mapNoteMayor;
    this.renderLegend(race, wins);

    this.drawing ??= new MunicipalityMap(byId("map"), map);
    const focus = s.focus && wins.some((w) => w.group === s.focus) ? s.focus : null;
    byId("map").classList.toggle("focusing", focus !== null);
    this.drawing.paint(
      t.mapAria(title),
      (i) => {
        const w = race.winner[i]!;
        if (w === NONE) return "no-data";
        const group = race.groups[w]!;
        const color = race.groupColors[group] ?? "gray";
        const step = president ? ` s${shade(margin(race, i))}` : "";
        return `c-${color}${step}${focus === group ? " focus" : ""}`;
      },
      (i) => tooltip(map, race, i),
    );
  }

  private renderTimeline(): void {
    const years = this.data.years(this.state.office);
    const slider = byId<HTMLInputElement>("map-slider");
    slider.max = String(years.length - 1);
    slider.value = String(years.indexOf(this.state.year));
    slider.setAttribute("aria-valuetext", String(this.state.year));
    const list = byId("map-years");
    list.innerHTML = "";
    for (const year of years) {
      const b = button(String(year), { className: "timeline-year", pressed: year === this.state.year });
      b.addEventListener("click", () => this.set({ year }, { stop: true }));
      list.appendChild(b);
    }
  }

  private renderLegend(race: MapRace, wins: ReturnType<typeof winsByGroup>): void {
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
        pressed: this.state.focus === w.group,
      });
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
