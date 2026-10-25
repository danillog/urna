import { geoMercator } from "d3-geo";

import { dayToDate, escapeHtml, formatDate, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  OFFICES,
  UFS,
  candidateColors,
  displayName,
  holdsSeat,
  isOffice,
  lead,
  noChoice,
  noChoiceShare,
  partyColor,
  seatsOf,
  started,
  type ApOffice,
  type Apuracao,
  type Candidate,
  type NoChoiceKind,
  type PartyList,
  type Tally,
} from "../model/apuracao";
import {
  NO_CITY_RESULT,
  decodeCityCount,
  type CityCount,
  type EncodedCityCount,
} from "../model/apuracao-cidades";
import { simulate } from "../model/apuracao-sim";
import { groupOf, weightedBreaks } from "../model/census-vote";
import { shade } from "../model/map-data";
import { partyKey, type FinalAverage } from "../model/view";
import type { ColorName, MunicipalMap, RoundId } from "../types";
import { byId } from "./dom";
import { sourcesHtml } from "./sources";
import { ChoroplethMap } from "./map";

export interface ApuracaoState {
  office: ApOffice;
  round: RoundId;
  /** State shown in the bars and framed on the map; null is the whole country. */
  uf: string | null;
  /** Map painted by state (live) or by municipality (the build's snapshot). */
  level: MapLevel;
  /** Map painted by who leads, or by who chose no one: null votes, blank votes, abstention. */
  paint: Paint;
  /** The legend entry brought forward on the map, as in the Mapa tab: a party (who leads) or
   * a step "0"…"9" (who chose no one); null shows everything. */
  focus: string | null;
}

export type Paint = "lead" | NoChoiceKind;
const PAINT_SLUGS: Record<NoChoiceKind, string> = { nulls: "nulos", blank: "brancos", absent: "abstencao" };

export type MapLevel = "uf" | "mun";

/**
 * Where the numbers come from: the Worker for real (live), the Worker's 2024
 * data (test: real numbers, any day), or a count made up in the browser (sim).
 */
export type ApuracaoSource = "live" | "test" | "sim";

/** The Worker's address: wrangler dev locally, VITE_APURACAO_URL in the build. */
const API: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_APURACAO_URL ?? "http://localhost:8787")
  : import.meta.env.VITE_APURACAO_URL;

// The TSE refreshes its files about once a minute (max-age=55): asking more often only spends requests.
const POLL_MS: Record<ApuracaoSource, number> = { live: 60_000, test: 60_000, sim: 2_000 };
/** Deputies' races are per state; this one opens when none is chosen. */
const DEFAULT_UF = "SP";
/** Best-voted candidates left out of a delegation, listed under the seats. */
const TOP_LEFT_OUT = 10;

type Status = "loading" | "waiting" | "live" | "done" | "error";

const isUf = (uf: string | null | undefined): uf is string =>
  Boolean(uf) && (UFS as readonly string[]).includes(uf!);

/** Pulls a state back to something the office can show. */
function normalize(s: ApuracaoState): ApuracaoState {
  const info = OFFICES[s.office];
  return {
    ...s,
    round: info.runoff ? s.round : "r1",
    uf: info.proportional && !s.uf ? DEFAULT_UF : s.uf,
  };
}

/**
 * The round the tab opens on when the link names none: the runoff from the day after the
 * 1st round (`firstRound`, "2026-10-04") on, by the calendar in Brasília.
 */
export function defaultRound(firstRound: string | undefined, now = new Date()): RoundId {
  const today = now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // "2026-10-25"
  return firstRound && today > firstRound ? "r2" : "r1";
}

export function apuracaoFromSearch(
  params: URLSearchParams,
  fallbackRound: RoundId = "r1",
): {
  state: ApuracaoState;
  source: ApuracaoSource;
} {
  const round = params.get("round");
  const uf = params.get("uf")?.toUpperCase() ?? null;
  const office = params.get("cargo") ?? "";
  return {
    state: normalize({
      office: isOffice(office) ? office : "presidente",
      round: round === "r1" || round === "r2" ? round : fallbackRound,
      uf: isUf(uf) ? uf : null,
      level: params.get("mapa") === "estados" ? "uf" : "mun",
      paint:
        (Object.keys(PAINT_SLUGS) as NoChoiceKind[]).find((k) => PAINT_SLUGS[k] === params.get("pintar")) ??
        "lead",
      focus: params.get("focus"),
    }),
    source: params.has("simular") ? "sim" : params.get("fonte") === "teste" ? "test" : "live",
  };
}

export function apuracaoToSearch(s: ApuracaoState, source: ApuracaoSource, params: URLSearchParams): void {
  if (s.office !== "presidente") params.set("cargo", s.office);
  // Always written: a link without it opens on whichever round is current when it is followed.
  if (OFFICES[s.office].runoff) params.set("round", s.round);
  if (s.uf) params.set("uf", s.uf);
  if (s.level === "uf") params.set("mapa", "estados");
  if (s.paint !== "lead") params.set("pintar", PAINT_SLUGS[s.paint]);
  if (s.focus) params.set("focus", s.focus);
  if (source === "sim") params.set("simular", "1");
  if (source === "test") params.set("fonte", "teste");
}

/** The live-count tab: a status line, the map by state and the bars. */
export class ApuracaoView {
  private drawing: ChoroplethMap | null = null;
  private data: Apuracao | null = null;
  private status: Status = "loading";
  private timer: number | undefined;
  private running = false;
  /** Bumped whenever a different file is needed, so a late answer for the old one is dropped. */
  private generation = 0;
  private simStart = Date.now();
  private framed: string | null | undefined = undefined;
  /** President: colors stay fixed per party once handed out. */
  private colors: Record<string, ColorName> = {};
  /** What the map shows now, for the legend's highlight: each area's group (party or step). */
  private groupOf: (i: number) => string | null = () => null;
  private decodedCities = new Map<string, CityCount>();

  constructor(
    private readonly map: MunicipalMap,
    /** The count per municipality, keyed "presidente-r1": a snapshot from the build. */
    private readonly cityCounts: Partial<Record<string, EncodedCityCount>>,
    private state: ApuracaoState,
    private readonly source: ApuracaoSource,
    /** Poll-chart colors per round ("Lula" → red), reused for president. */
    private readonly knownColors: Partial<Record<RoundId, Record<string, ColorName>>>,
    private readonly stateNames: Record<string, string>,
    private readonly onChange: () => void,
    /** The polls' final average for a race shown here, to mark on each candidate's bar. */
    private readonly pollAverage: (
      office: ApOffice,
      round: RoundId,
      uf: string | null,
    ) => FinalAverage | null = () => null,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    const select = byId<HTMLSelectElement>("ap-uf");
    select.add(new Option(t.mapWholeCountry, ""));
    Object.entries(stateNames)
      .sort((a, b) => a[1].localeCompare(b[1], t.locale))
      .forEach(([uf, name]) => select.add(new Option(t.state(name, uf), uf)));
    select.addEventListener("change", () => this.set({ uf: select.value || null }));
    byId("ap-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ office: b.dataset.office as ApOffice })));
    byId("ap-rounds")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ round: b.dataset.round as RoundId })));
    byId("ap-levels")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ level: b.dataset.level as MapLevel })));
    byId("ap-paint")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ paint: b.dataset.paint as Paint })));
    // The legend filters the map, as in the Mapa tab: a click brings one entry forward.
    byId("ap-legend").addEventListener("click", (e) => {
      const group = (e.target as HTMLElement).closest<HTMLElement>("[data-group]")?.dataset.group;
      if (group !== undefined) this.set({ focus: this.state.focus === group ? null : group });
    });
    byId("ap-zoom-in").addEventListener("click", () => this.drawing?.zoomIn());
    byId("ap-zoom-out").addEventListener("click", () => this.drawing?.zoomOut());
    byId("ap-zoom-reset").addEventListener("click", () => {
      if (this.proportional) this.drawing?.fit(null);
      else this.set({ uf: null });
    });
    // The national list of governors and senators links to each state.
    byId("ap-results").addEventListener("click", (e) => {
      const uf = (e.target as HTMLElement).closest<HTMLElement>("[data-uf]")?.dataset.uf;
      if (uf) this.set({ uf });
    });
    document.addEventListener("visibilitychange", () => {
      if (!this.running) return;
      if (document.hidden) window.clearTimeout(this.timer);
      else void this.refresh();
    });
  }

  get current(): ApuracaoState {
    return this.state;
  }

  get currentSource(): ApuracaoSource {
    return this.source;
  }

  private get proportional(): boolean {
    return OFFICES[this.state.office].proportional;
  }

  /** The municipal snapshot for what is on screen; null for deputies, test and sim data. */
  private get cities(): CityCount | null {
    if (this.source !== "live" || this.proportional) return null;
    const key = `${this.state.office}-${this.state.round}`;
    const encoded = this.cityCounts[key];
    if (!encoded) return null;
    if (!this.decodedCities.has(key)) this.decodedCities.set(key, decodeCityCount(encoded));
    return this.decodedCities.get(key)!;
  }

  /** Whether the map is painted by municipality right now. */
  private get byCity(): boolean {
    return this.state.level === "mun" && this.cities !== null;
  }

  private set(patch: Partial<ApuracaoState>): void {
    const before = this.state;
    // A highlight belongs to the map it was picked on: another office, round, level or paint drops it.
    const redraws = (["office", "round", "level", "paint"] as const).some(
      (k) => k in patch && patch[k] !== before[k],
    );
    this.state = normalize({ ...before, ...(redraws ? { focus: null } : {}), ...patch });
    // Deputies have no national view: clearing the state keeps the one shown.
    if (this.proportional && !this.state.uf) this.state = { ...this.state, uf: before.uf ?? DEFAULT_UF };
    const s = this.state;
    const newFile =
      s.office !== before.office || s.round !== before.round || (this.proportional && s.uf !== before.uf);
    if (newFile) {
      this.generation++;
      this.data = null;
      this.colors = {};
      this.status = "loading";
      this.simStart = Date.now();
      if (this.running) void this.refresh();
    }
    this.onChange();
  }

  /** Starts polling; called when the tab opens. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
  }

  /** Stops polling; called when another tab opens. */
  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
  }

  /** The Worker path for what is on screen: /governador/r1, /deputado-federal/r1/sp… */
  private path(): string {
    const s = this.state;
    const parts = [s.office, s.round, ...(this.proportional ? [s.uf!.toLowerCase()] : [])];
    return (this.source === "test" ? ["teste", ...parts] : parts).join("/");
  }

  private async load(): Promise<Apuracao> {
    const s = this.state;
    if (this.source === "sim") return simulate(s.office, s.round, (Date.now() - this.simStart) / 1000, s.uf);
    if (!API) throw new Error("not configured");
    const res = await this.fetcher(`${API.replace(/\/$/, "")}/${this.path()}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Apuracao;
  }

  /** One round trip, then the next one is scheduled. */
  async refresh(): Promise<void> {
    window.clearTimeout(this.timer);
    const generation = this.generation;
    try {
      const data = await this.load();
      if (generation !== this.generation) return;
      this.data = data;
      this.status = !started(data.br) ? "waiting" : data.br.counted >= 100 ? "done" : "live";
    } catch {
      if (generation !== this.generation) return;
      this.status = "error";
    }
    this.render();
    // A finished count does not change any more; nothing to ask for.
    const canPoll = this.source === "sim" || API !== undefined;
    if (this.running && canPoll && this.status !== "done")
      this.timer = window.setTimeout(() => void this.refresh(), POLL_MS[this.source]);
  }

  /** Color of a party: the poll chart's for president, the party map's otherwise. */
  private colorOf(party: string): ColorName {
    if (this.state.office === "presidente" && this.source !== "test") return this.colors[party] ?? "gray";
    return partyColor(party, this.map.lineages);
  }

  render(): void {
    const s = this.state;
    const info = OFFICES[s.office];
    byId("ap-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.office === s.office)));
    byId("ap-rounds")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.round === s.round));
        b.disabled = b.dataset.round === "r2" && !info.runoff;
        b.title = b.disabled ? t.apuracao.noRunoff : "";
      });
    const hasCities = this.cities !== null;
    byId("ap-levels")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        const level = b.dataset.level as MapLevel;
        b.setAttribute("aria-pressed", String(level === (hasCities ? s.level : "uf")));
        b.disabled = level === "mun" && !hasCities;
        b.title = b.disabled ? t.apuracao.noCities : "";
      });
    // Deputies' races are read one state at a time: no country to paint by who chose no one.
    byId("ap-paint-group").hidden = info.proportional;
    byId("ap-paint")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.paint === this.paint)));
    const select = byId<HTMLSelectElement>("ap-uf");
    select.value = s.uf ?? "";
    select.options[0]!.disabled = info.proportional; // deputies are counted state by state
    const place = s.uf ? t.state(this.stateNames[s.uf] ?? s.uf, s.uf) : t.apuracao.brazil;
    const title = t.apuracao.title(t.apuracao.office[s.office], info.runoff ? t.round[s.round] : null, place);
    byId("ap-title").textContent = title;
    byId("ap-note").textContent =
      this.source === "sim"
        ? t.apuracao.simNote
        : this.source === "test"
          ? info.proportional
            ? t.apuracao.testNoteCouncil
            : t.apuracao.testNote
          : info.proportional
            ? t.apuracao.noteProportional
            : this.byCity
              ? `${t.apuracao.note} ${t.apuracao.citiesNote(this.cities!.totalizedAt ?? "")}`
              : t.apuracao.note;

    byId("ap-sources").innerHTML = sourcesHtml([t.sources.tseResults]);

    const data = this.data;
    if (data && s.office === "presidente") this.assignColors(data);
    const tally = data ? (s.uf ? (data.uf[s.uf] ?? null) : data.br) : null;
    this.renderStatus(tally ?? data?.br ?? null);
    const results = byId("ap-results");
    if (!data) results.replaceChildren();
    else if (info.proportional) results.innerHTML = tally ? this.proportionalHtml(tally) : "";
    else if (!s.uf && s.office !== "presidente") results.innerHTML = this.byStateHtml(data);
    else results.innerHTML = tally ? this.barsHtml(tally) : "";
    byId("ap-totals").innerHTML = tally && started(tally) ? this.noChoiceHtml(tally) : "";
    this.renderMap(title);
  }

  private assignColors(data: Apuracao): void {
    const missing = data.br.candidates.some((c) => !(c.party in this.colors));
    if (missing)
      this.colors = {
        ...candidateColors(data.br.candidates, this.knownColors[this.state.round] ?? {}),
        ...this.colors,
      };
  }

  private renderStatus(tally: Tally | null): void {
    const badge = byId("ap-badge");
    const label =
      this.source === "sim" && this.data
        ? t.apuracao.status.sim
        : this.source === "test" && this.data
          ? t.apuracao.status.test
          : t.apuracao.status[this.status];
    badge.textContent = label;
    badge.dataset.status = this.status;

    const counted = tally?.counted ?? 0;
    byId("ap-progress-bar").style.width = `${Math.min(100, counted)}%`;
    byId("ap-progress").setAttribute("aria-valuenow", counted.toFixed(2));
    byId("ap-counted").textContent = t.apuracao.counted(percent(counted).replace(/,0%$/, "%"));

    const updated = byId("ap-updated");
    const time = this.data?.br.totalizedAt?.split(" ")[1];
    if (!API && this.source !== "sim") updated.textContent = t.apuracao.notConfigured;
    else if (this.status === "error")
      updated.textContent = this.data && time ? t.apuracao.retrying(time) : t.apuracao.noData;
    else if (this.status === "waiting") updated.textContent = t.apuracao.waiting;
    else if (time)
      updated.textContent = (this.source === "sim" ? t.apuracao.simUpdated : t.apuracao.updated)(time);
    else updated.textContent = "";
  }

  /** What the map is painted by: who chose no one only where the office has a country view. */
  private get paint(): Paint {
    return this.proportional ? "lead" : this.state.paint;
  }

  /** Who chose no one: null and blank votes, abstention, in people, and the whole electorate
   * counted as one bar. */
  private noChoiceHtml(tally: Tally): string {
    const n = noChoice(tally);
    const row = (kind: NoChoiceKind) =>
      `<div class="ap-nc-row"><i class="map-key ap-nc-${kind}"></i><span>${t.apuracao.noChoice[kind]}</span>` +
      `<b>${integer(n[kind])}</b><span class="meta">${t.apuracao.noChoiceOf[kind](percent(noChoiceShare(n, kind) ?? 0))}</span></div>`;
    const width = (x: number) => (n.electorate ? ((x / n.electorate) * 100).toFixed(2) : "0");
    return (
      `<h3 class="ap-nc-h">${t.apuracao.noChoiceTitle}</h3>` +
      `<div class="ap-nc-bar" role="img" aria-label="${escapeHtml(t.apuracao.noChoiceAria(integer(n.electorate)))}">` +
      `<span class="ap-nc-valid" style="width:${width(tally.valid)}%"></span>` +
      `<span class="ap-nc-blank" style="width:${width(n.blank)}%"></span>` +
      `<span class="ap-nc-nulls" style="width:${width(n.nulls)}%"></span>` +
      `<span class="ap-nc-absent" style="width:${width(n.absent)}%"></span></div>` +
      `<div class="ap-nc-row"><i class="map-key ap-nc-valid"></i><span>${t.apuracao.noChoice.valid}</span><b>${integer(tally.valid)}</b><span class="meta"></span></div>` +
      row("nulls") +
      row("blank") +
      row("absent") +
      `<p class="meta">${t.apuracao.noChoiceNote}</p>`
    );
  }

  /** One candidate: name, party, share, votes and a bar, with the polls' final average marked. */
  private candidateRow(
    c: Candidate,
    opts: { majority: boolean; tag?: string; average?: FinalAverage | null },
  ): string {
    const color = this.colorOf(c.party);
    const tag = opts.tag ?? t.apuracao.statusTag[c.status];
    const avg = opts.average?.byParty[partyKey(c.party)];
    return (
      `<li class="ap-row">` +
      `<div class="ap-name"><i class="map-key c-${color}"></i><b>${escapeHtml(displayName(c.name))}</b>` +
      `<span class="ap-party">${escapeHtml(c.party)} · ${escapeHtml(c.number)}</span>` +
      (tag ? `<span class="ap-tag">${escapeHtml(tag)}</span>` : "") +
      `</div>` +
      `<div class="ap-num"><b>${percent(c.share)}</b><span>${t.apuracao.votes(integer(c.votes))}</span>` +
      (avg != null ? `<span class="ap-poll-note">${t.apuracao.pollAverage(percent(avg))}</span>` : "") +
      `</div>` +
      `<div class="ap-track${opts.majority ? " ap-majority" : ""}"><span class="c-${color}" style="width:${Math.min(100, c.share).toFixed(2)}%"></span>` +
      (avg != null
        ? `<i class="ap-poll" style="left:${Math.min(100, avg).toFixed(2)}%" title="${escapeHtml(t.apuracao.pollAverage(percent(avg)))}"></i>`
        : "") +
      `</div>` +
      `</li>`
    );
  }

  /** Majoritarian races: every candidate, with a cut line under the seats (two senators). */
  private barsHtml(tally: Tally): string {
    const s = this.state;
    const majority = s.round === "r1" && (s.office === "presidente" || s.office === "governador");
    const average = this.pollAverage(s.office, s.round, s.uf);
    const rows = tally.candidates.map((c, i) => {
      const row = this.candidateRow(c, { majority, average });
      return tally.seats > 1 && i === tally.seats - 1 && tally.candidates.length > tally.seats
        ? `${row}<li class="ap-cut">${t.apuracao.cut(tally.seats)}</li>`
        : row;
    });
    const note = average
      ? `<p class="meta ap-poll-legend"><i class="ap-poll-key"></i>${t.apuracao.pollAverageNote(formatDate(dayToDate(average.year, average.day)))}</p>`
      : "";
    return `<ol class="ap-bars">${rows.join("")}</ol>${note}`;
  }

  /** Governors and senators across the country: who leads in each state. */
  private byStateHtml(data: Apuracao): string {
    const rows = UFS.map((uf) => [uf, data.uf[uf]] as const)
      .sort((a, b) => (this.stateNames[a[0]] ?? a[0]).localeCompare(this.stateNames[b[0]] ?? b[0], t.locale))
      .map(([uf, tally]) => {
        const l = tally ? lead(tally) : null;
        const name = escapeHtml(t.state(this.stateNames[uf] ?? uf, uf));
        if (!l)
          return `<li class="ap-row"><div class="ap-name"><button type="button" class="ap-link" data-uf="${uf}">${name}</button></div><div class="ap-num"><span>${t.apuracao.status.waiting}</span></div></li>`;
        const c = l.leader;
        const color = this.colorOf(c.party);
        return (
          `<li class="ap-row">` +
          `<div class="ap-name"><button type="button" class="ap-link" data-uf="${uf}">${name}</button>` +
          `<span class="ap-party"><i class="map-key c-${color}"></i> ${escapeHtml(displayName(c.name))} · ${escapeHtml(c.party)}</span></div>` +
          `<div class="ap-num"><b>${percent(c.share)}</b><span>${t.apuracao.counted(percent(tally!.counted))}</span></div>` +
          `<div class="ap-track"><span class="c-${color}" style="width:${Math.min(100, c.share).toFixed(2)}%"></span></div>` +
          `</li>`
        );
      });
    return `<h3 class="ap-h">${t.apuracao.byState}</h3><ol class="ap-bars">${rows.join("")}</ol>`;
  }

  /** Deputies: seats per party list, then the most voted names. */
  private proportionalHtml(tally: Tally): string {
    const { official, seats } = seatsOf(tally);
    const lists = tally.lists
      .filter((l) => seats(l) > 0)
      .sort((a, b) => seats(b) - seats(a) || b.votes - a.votes);
    const listRows = lists.map((l) => {
      const color = partyColor(l.name, this.map.lineages);
      const n = seats(l);
      return (
        `<li class="ap-row">` +
        `<div class="ap-name"><i class="map-key c-${color}"></i><b>${escapeHtml(l.name)}</b>` +
        `<span class="ap-party">${percent(l.share)} ${t.apuracao.ofVotes}</span></div>` +
        `<div class="ap-num"><b>${n}</b><span>${t.apuracao.seatsWord(n)}</span></div>` +
        `<div class="ap-track"><span class="c-${color}" style="width:${((n / tally.seats) * 100).toFixed(2)}%"></span></div>` +
        `</li>`
      );
    });
    const heading = started(tally)
      ? official
        ? t.apuracao.seatsOfficial(tally.seats)
        : t.apuracao.seatsProjected(tally.seats)
      : t.apuracao.seatsTotal(tally.seats);
    return (
      `<h3 class="ap-h">${heading}</h3>` +
      (listRows.length ? `<ol class="ap-bars">${listRows.join("")}</ol>` : "") +
      (started(tally) ? this.electedHtml(tally, lists) : "")
    );
  }

  /**
   * Everyone in a seat, under their party list: who carried the list past the
   * quotient on their own votes, and who rode in on the list's votes with fewer
   * than the best-voted candidate left out. Then the best-voted left out.
   */
  private electedHtml(tally: Tally, lists: PartyList[]): string {
    const { official } = seatsOf(tally);
    const quotient = tally.valid / tally.seats;
    const inSeat = tally.candidates.filter((c) => holdsSeat(tally, c));
    const out = tally.candidates.filter((c) => !holdsSeat(tally, c));
    const bestOut = out[0];
    const groups = lists.map((l) => {
      const rows = inSeat
        .filter((c) => c.list === l.key)
        .map((c) => {
          const tags = [official ? (t.apuracao.statusTag[c.status] ?? c.status) : t.apuracao.inSeat];
          if (c.votes >= quotient) tags.push(t.apuracao.puller);
          else if (bestOut && c.votes < bestOut.votes) tags.push(t.apuracao.pulled);
          return this.candidateRow(c, { majority: false, tag: tags.filter(Boolean).join(" · ") });
        });
      const color = partyColor(l.name, this.map.lineages);
      return (
        `<li class="ap-group"><div class="ap-group-h"><i class="map-key c-${color}"></i><b>${escapeHtml(l.name)}</b>` +
        `<span class="ap-party">${t.apuracao.listVotes(integer(l.votes), rows.length)}</span></div>` +
        `<ol class="ap-bars">${rows.join("")}</ol></li>`
      );
    });
    const pulled = bestOut ? inSeat.filter((c) => c.votes < bestOut.votes).length : 0;
    const summary = bestOut
      ? t.apuracao.pulledSummary(
          pulled,
          displayName(bestOut.name),
          bestOut.party,
          integer(bestOut.votes),
          integer(Math.round(quotient)),
        )
      : "";
    const left = out.slice(0, TOP_LEFT_OUT).map((c) =>
      this.candidateRow(c, {
        majority: false,
        tag: official ? (t.apuracao.statusTag[c.status] ?? c.status) : "",
      }),
    );
    return (
      `<h3 class="ap-h">${t.apuracao.electedHeading(official)}</h3>` +
      (summary ? `<p class="meta ap-summary">${escapeHtml(summary)}</p>` : "") +
      `<ol class="ap-groups">${groups.join("")}</ol>` +
      (left.length
        ? `<h3 class="ap-h">${t.apuracao.leftOut}</h3><ol class="ap-bars">${left.join("")}</ol>`
        : "")
    );
  }

  private renderMap(title: string): void {
    const map = this.map;
    if (!this.drawing) {
      this.drawing = new ChoroplethMap(byId("ap-map"), {
        topology: map.topology,
        object: map.topology.objects.municipalities,
        groups: map.municipalities.uf,
        projection: geoMercator(),
        width: 800,
        height: 780,
        maxZoom: 12,
      });
      this.drawing.onAreaClick((i) => {
        const uf = map.municipalities.uf[i]!;
        this.set({ uf: this.state.uf === uf && !this.proportional ? null : uf });
      });
    }
    const cities = this.byCity ? this.cities! : null;
    if (this.paint !== "lead") {
      this.paintNoChoice(title, this.paint, cities);
      return;
    }
    if (cities) {
      this.drawing.paint(
        t.apuracao.mapAriaCities(title),
        (i) => {
          const w = cities.winner[i]!;
          if (w === NO_CITY_RESULT) return "no-data";
          const margin = (cities.winnerShare[i]! - cities.secondShare[i]!) / 10;
          return `c-${this.colorOf(cities.parties[w]!)} s${shade(margin)}`;
        },
        (i) => this.cityTooltip(cities, i),
      );
      this.groupOf = (i) => {
        const w = cities.winner[i]!;
        return w === NO_CITY_RESULT ? null : cities.parties[w]!;
      };
      this.renderLegend();
      this.renderFocus();
      this.frame();
      return;
    }
    const data = this.data;
    // Each state in the color of who leads there; for deputies, of the list with most seats.
    const colorByUf = new Map<string, string>();
    const leaderByUf = new Map<string, string>();
    for (const uf of UFS) {
      const tally = data?.uf[uf];
      if (!tally) continue;
      if (this.proportional) {
        const { seats } = seatsOf(tally);
        const top = [...tally.lists].sort((a, b) => seats(b) - seats(a))[0];
        if (top && seats(top) > 0) colorByUf.set(uf, `c-${partyColor(top.name, map.lineages)} s2`);
      } else {
        const l = lead(tally);
        if (l) {
          colorByUf.set(uf, `c-${this.colorOf(l.leader.party)} s${shade(l.margin)}`);
          leaderByUf.set(uf, l.leader.party);
        }
      }
    }
    this.drawing.paint(
      t.apuracao.mapAria(title),
      (i) => colorByUf.get(map.municipalities.uf[i]!) ?? "no-data",
      (i) => this.tooltip(map.municipalities.uf[i]!),
    );
    this.groupOf = (i) => leaderByUf.get(map.municipalities.uf[i]!) ?? null;
    this.renderLegend();
    this.renderFocus();
    this.frame();
  }

  /** The legend entry picked, brought forward on the map (the others under a veil). */
  private renderFocus(): void {
    const legend = byId("ap-legend");
    const groups = new Set(
      [...legend.querySelectorAll<HTMLElement>("[data-group]")].map((b) => b.dataset.group!),
    );
    const focus = this.state.focus !== null && groups.has(this.state.focus) ? this.state.focus : null;
    legend
      .querySelectorAll<HTMLButtonElement>("[data-group]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === focus)));
    const indices: number[] = [];
    if (focus !== null)
      for (let i = 0; i < this.map.municipalities.uf.length; i++)
        if (this.groupOf(i) === focus) indices.push(i);
    // Drawn again on every render: the copies on top must carry the colors just painted.
    this.drawing!.highlight(focus !== null ? indices : null);
  }

  /** Each place in ten steps of null votes, blank votes or abstention, from fewest to most;
   * the steps hold about the same number of voters each. */
  private paintNoChoice(title: string, kind: NoChoiceKind, cities: CityCount | null): void {
    const m = this.map.municipalities;
    const byCity = cities?.[kind] ? cities : null;
    let value: (i: number) => number | null;
    const rows: { x: number; w: number }[] = [];
    if (byCity) {
      const shares = byCity[kind]!;
      value = (i) => (byCity.winner[i] === NO_CITY_RESULT ? null : shares[i]! / 10);
      m.names.forEach((_, i) => {
        const x = value(i);
        if (x !== null) rows.push({ x, w: byCity.votes[i]! });
      });
    } else {
      const byUf = new Map<string, number>();
      for (const uf of UFS) {
        const tally = this.data?.uf[uf];
        if (!tally || !started(tally)) continue;
        const n = noChoice(tally);
        const x = noChoiceShare(n, kind);
        if (x === null) continue;
        byUf.set(uf, x);
        rows.push({ x, w: n.electorate });
      }
      value = (i) => byUf.get(m.uf[i]!) ?? null;
    }
    const breaks = weightedBreaks(rows, 10);
    this.groupOf = (i) => {
      const x = value(i);
      return x === null ? null : String(groupOf(x, breaks));
    };
    this.drawing!.paint(
      t.apuracao.mapAriaNoChoice(title, t.apuracao.noChoice[kind]),
      (i) => {
        const x = value(i);
        return x === null ? "no-data" : `q${groupOf(x, breaks)}`;
      },
      (i) => (byCity ? this.cityTooltip(byCity, i) : this.tooltip(m.uf[i]!)),
    );
    // One chip per step, with how many places fall in it: clicking one brings them forward.
    const counts = Array.from({ length: 10 }, () => new Set<string>());
    m.uf.forEach((uf, i) => {
      const g = this.groupOf(i);
      if (g !== null) counts[Number(g)]!.add(byCity ? String(i) : uf);
    });
    const fmt = (x: number) => percent(x);
    const label = (k: number) =>
      k === 0
        ? t.apuracao.stepUpTo(fmt(breaks[0] ?? 0))
        : k === breaks.length
          ? t.apuracao.stepAbove(fmt(breaks[k - 1]!))
          : `${fmt(breaks[k - 1]!)}–${fmt(breaks[k]!)}`;
    byId("ap-legend").innerHTML =
      `<span class="map-steps">${t.apuracao.noChoiceLegend[kind]}:</span>` +
      counts
        .map((places, k) =>
          places.size
            ? `<button type="button" class="chip map-chip compact" data-group="${k}" aria-pressed="false" title="${escapeHtml(t.mapFocus)}"><i class="map-key q${k}"></i><span>${label(k)}</span><span class="n">${byCity ? t.apuracao.cities(places.size) : t.apuracao.states(places.size)}</span></button>`
            : "",
        )
        .join("");
    this.renderFocus();
    this.frame();
  }

  private frame(): void {
    if (this.framed !== this.state.uf) {
      this.drawing!.fit(this.state.uf, this.framed !== undefined);
      this.framed = this.state.uf;
    }
  }

  private cityTooltip(cities: CityCount, i: number): string {
    const m = this.map.municipalities;
    const head = `<div class="tt-h">${escapeHtml(m.names[i]!)} (${m.uf[i]})</div>`;
    const w = cities.winner[i]!;
    if (w === NO_CITY_RESULT) return `${head}<div class="tt-s">${t.apuracao.status.waiting}</div>`;
    const row = (idx: number, share: number) =>
      `<div class="row"><span class="key"><i class="map-key c-${this.colorOf(cities.parties[idx]!)}"></i>${escapeHtml(displayName(cities.names[idx]!))} · ${escapeHtml(cities.parties[idx]!)}</span><b>${percent(share / 10)}</b></div>`;
    const second = cities.second[i]!;
    return (
      head +
      `<div class="tt-s">${t.apuracao.counted(percent(cities.counted[i]! / 10))}</div>` +
      row(w, cities.winnerShare[i]!) +
      (second === NO_CITY_RESULT ? "" : row(second, cities.secondShare[i]!)) +
      `<div class="tt-s tt-foot">${t.apuracao.validVotes(integer(cities.votes[i]!))}</div>` +
      (cities.nulls && cities.blank && cities.absent
        ? this.noChoiceRows({
            nulls: cities.nulls[i]! / 10,
            blank: cities.blank[i]! / 10,
            absent: cities.absent[i]! / 10,
          })
        : "")
    );
  }

  private tooltip(uf: string): string {
    const tally = this.data?.uf[uf];
    const head = `<div class="tt-h">${escapeHtml(t.state(this.stateNames[uf] ?? uf, uf))}</div>`;
    if (!tally || !started(tally))
      return `${head}<div class="tt-s">${this.proportional && uf !== this.state.uf ? t.apuracao.clickToSee : t.apuracao.status.waiting}</div>`;
    const counted = `<div class="tt-s">${t.apuracao.counted(percent(tally.counted))}</div>`;
    if (this.proportional) {
      const { seats } = seatsOf(tally);
      const rows = [...tally.lists]
        .sort((a, b) => seats(b) - seats(a))
        .slice(0, 4)
        .map(
          (l) =>
            `<div class="row"><span class="key"><i class="map-key c-${partyColor(l.name, this.map.lineages)}"></i>${escapeHtml(l.name)}</span><b>${seats(l)}</b></div>`,
        );
      return head + counted + rows.join("");
    }
    const rows = tally.candidates
      .slice(0, 3)
      .map(
        (c) =>
          `<div class="row"><span class="key"><i class="map-key c-${this.colorOf(c.party)}"></i>${escapeHtml(displayName(c.name))}</span><b>${percent(c.share)}</b></div>`,
      );
    const n = noChoice(tally);
    return (
      head +
      counted +
      rows.join("") +
      this.noChoiceRows({
        nulls: noChoiceShare(n, "nulls") ?? 0,
        blank: noChoiceShare(n, "blank") ?? 0,
        absent: noChoiceShare(n, "absent") ?? 0,
      })
    );
  }

  /** Null and blank votes and abstention, in percent, under a tooltip's candidates. */
  private noChoiceRows(shares: Record<NoChoiceKind, number>): string {
    return (
      `<div class="tt-s tt-foot"></div>` +
      (["nulls", "blank", "absent"] as const)
        .map(
          (k) => `<div class="row"><span>${t.apuracao.noChoice[k]}</span><b>${percent(shares[k])}</b></div>`,
        )
        .join("")
    );
  }

  /** Chips under the title: who leads in how many states (by party outside president). */
  private renderLegend(): void {
    const legend = byId("ap-legend");
    const data = this.data;
    if (!data || this.proportional) {
      legend.replaceChildren();
      return;
    }
    const byParty = this.state.office !== "presidente" || this.source === "test";
    const counts = new Map<string, { n: number; label: string; party: string }>();
    const cities = this.byCity ? this.cities! : null;
    if (cities)
      // By municipality, every office is keyed by party: governors differ by state.
      cities.winner.forEach((w) => {
        if (w === NO_CITY_RESULT) return;
        const party = cities.parties[w]!;
        const label = this.state.office === "presidente" ? displayName(cities.names[w]!) : party;
        counts.set(party, { n: (counts.get(party)?.n ?? 0) + 1, label, party });
      });
    else
      for (const uf of UFS) {
        const l = data.uf[uf] ? lead(data.uf[uf]!) : null;
        if (!l) continue;
        const key = l.leader.party;
        const prev = counts.get(key);
        counts.set(key, {
          n: (prev?.n ?? 0) + 1,
          label: byParty ? key : displayName(l.leader.name),
          party: key,
        });
      }
    legend.replaceChildren(
      ...[...counts.values()]
        .sort((a, b) => b.n - a.n)
        .map((c) => {
          // A filter, as in the Mapa tab: a click brings forward where this one leads.
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip map-chip";
          chip.dataset.group = c.party;
          chip.title = t.mapFocus;
          chip.setAttribute("aria-pressed", "false");
          chip.innerHTML = `<i class="map-key c-${this.colorOf(c.party)}"></i><span>${escapeHtml(c.label)}</span><span class="n">${cities ? t.apuracao.cities(c.n) : t.apuracao.states(c.n)}</span>`;
          return chip;
        }),
    );
  }
}
