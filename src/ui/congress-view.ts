import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import {
  FOCUS_KEYS,
  GROUPS,
  focusSeats,
  hemicycle,
  selectedSeats,
  history,
  seatsByGroup,
  type CongressData,
  type CongressElection,
  type CongressParty,
  type FocusKey,
  type House,
  inOfficeYear,
  type PartySwitch,
  type Measured,
  isCongress,
} from "../model/congress";
import { measuredBase, measuredCentrao, type GovernismoData } from "../model/governismo";
import { byParty, type IdeologyData } from "../model/ideology";
import { button, byId } from "./dom";
import { partyModalHtml } from "./party-modal";
import { sourcesHtml, type SourceLink } from "./sources";

export interface CongressState {
  house: House;
  year: number;
  /** Legend selection: these seats stand out and the table lists only these parties. */
  focus: FocusKey[];
  /** The party line whose history is open in the modal. */
  party: string | null;
  /** The legislature in office: by the party each was elected for, or by the party today. */
  moment: "elected" | "now";
}

/** Houses in the address: ?casa=senado, ?casa=alesp, ?casa=camara-sp. */
const HOUSE_SLUGS: Record<string, House> = { senado: "senate", alesp: "alesp", "camara-sp": "cmsp" };

/** Focus keys in the address: ?destaque=esquerda,centrao. */
const FOCUS_SLUGS: Record<FocusKey, string> = {
  left: "esquerda",
  "centre-left": "centro-esquerda",
  centre: "centro",
  "centre-right": "centro-direita",
  right: "direita",
  none: "sem-classificacao",
  centrao: "centrao",
  base: "base-medida",
  centraoMeasured: "centrao-medido",
  newcomers: "novatos",
};

/** Time between elections while the timeline plays. */
const STEP_MS = 1400;
const SVG = "http://www.w3.org/2000/svg";

const groupClass = (p: CongressParty) => `g-${p.group ?? "none"}${p.centrao ? " cz" : ""}`;

export function congressFromSearch(data: CongressData, params: URLSearchParams): CongressState {
  const house: House = HOUSE_SLUGS[params.get("casa") ?? ""] ?? "chamber";
  const years = data.houses[house].map((e) => e.year);
  const asked = Number(params.get("ano"));
  const slugs = (params.get("destaque") ?? "").split(",");
  // ?centrao=1 came before the legend could select.
  if (params.has("centrao")) slugs.push("centrao");
  const focus = FOCUS_KEYS.filter((k) => slugs.includes(FOCUS_SLUGS[k]));
  // ?partido=PT opens that party's history; matched by line, or by any acronym it used.
  const askedParty = params.get("partido");
  const lines = [...data.houses.chamber, ...data.houses.senate].flatMap((e) => e.parties);
  const party =
    lines.find((p) => p.lineage === askedParty)?.lineage ??
    lines.find((p) => p.party.toUpperCase() === askedParty?.toUpperCase())?.lineage ??
    null;
  const moment = params.get("bancada") === "hoje" && data.now ? "now" : "elected";
  // "Today" exists only for the legislature in office: without a year, open that one, not the
  // one just elected (in 2026, between October and February, those differ).
  const fallback = (moment === "now" && inOfficeYear(data, house)) || years.at(-1)!;
  return { house, year: years.includes(asked) ? asked : fallback, focus, party, moment };
}

export function congressToSearch(s: CongressState, data: CongressData, params: URLSearchParams): void {
  if (s.house !== "chamber")
    params.set(
      "casa",
      Object.keys(HOUSE_SLUGS).find((k) => HOUSE_SLUGS[k] === s.house)!,
    );
  if (s.year !== data.houses[s.house].at(-1)!.year) params.set("ano", String(s.year));
  if (s.focus.length) params.set("destaque", s.focus.map((k) => FOCUS_SLUGS[k]).join(","));
  if (s.party) params.set("partido", s.party);
  if (s.moment === "now" && s.year === inOfficeYear(data, s.house)) params.set("bancada", "hoje");
}

/** Closes a dialog; where close() is missing (jsdom, old browsers) does what it would. */
function closeDialog(d: HTMLDialogElement): void {
  if (typeof d.close === "function") d.close();
  else {
    d.removeAttribute("open");
    d.dispatchEvent(new Event("close"));
  }
}

/** The Congress tab: a hemicycle per election, parties left to right, and a table with each party's path. */
export class CongressView {
  private timer: number | undefined;
  private readonly svg: SVGSVGElement;
  private readonly tip: HTMLDivElement;
  /** Party (index in the election) under the pointer, highlighted in the chart and table. */
  private hover: number | null = null;

  constructor(
    private readonly data: CongressData,
    private readonly governismo: GovernismoData,
    private readonly ideology: IdeologyData | null,
    private state: CongressState,
    private readonly onChange: () => void,
  ) {
    byId("cg-houses")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ house: b.dataset.house as House })));
    byId("cg-moment")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () => this.set({ moment: b.dataset.moment as "elected" | "now" })),
      );
    const slider = byId<HTMLInputElement>("cg-slider");
    slider.addEventListener("input", () => this.set({ year: this.years[Number(slider.value)]! }, true));
    byId("cg-legend").addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-focus]");
      if (!chip) return;
      const key = chip.dataset.focus as FocusKey | "clear";
      const focus = this.state.focus;
      if (key === "clear") this.set({ focus: [] });
      else
        this.set({
          focus: focus.includes(key)
            ? focus.filter((k) => k !== key)
            : FOCUS_KEYS.filter((k) => k === key || focus.includes(k)),
        });
    });
    byId("cg-play").addEventListener("click", () => (this.timer ? this.stop() : this.play()));
    byId("cg-years").addEventListener("click", (e) => {
      const year = (e.target as HTMLElement).closest<HTMLElement>("[data-year]")?.dataset.year;
      if (year) this.set({ year: Number(year) }, true);
    });

    const host = byId("cg-chart");
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.setAttribute("viewBox", "-1.06 -1.06 2.12 1.14");
    this.svg.setAttribute("role", "img");
    this.tip = document.createElement("div");
    this.tip.className = "tooltip";
    this.tip.hidden = true;
    host.append(this.svg, this.tip);
    host.addEventListener("pointermove", (e) => this.onPointer(e));
    host.addEventListener("pointerleave", () => this.highlight(null));
    const table = byId("cg-table");
    table.addEventListener("pointerover", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-p]");
      this.highlight(row ? Number(row.dataset.p) : null);
    });
    table.addEventListener("pointerleave", () => this.highlight(null));
    // A party's history: from a seat or its name in the table.
    const open = (index: string | undefined) => {
      const p = index === undefined ? undefined : this.election.parties[Number(index)];
      if (p) this.set({ party: p.lineage });
    };
    host.addEventListener("click", (e) => {
      const dot = (e.target as Element).closest<SVGCircleElement>("circle[data-p]");
      if (dot) open(dot.dataset.p);
    });
    table.addEventListener("click", (e) =>
      open((e.target as HTMLElement).closest<HTMLElement>("[data-open]")?.dataset.open),
    );
    const modal = byId<HTMLDialogElement>("cg-modal");
    modal.addEventListener("click", (e) => {
      // The close button, or a click on the backdrop (the dialog itself, outside its content).
      if ((e.target as HTMLElement).closest("[data-close-modal]") || e.target === modal) closeDialog(modal);
    });
    modal.addEventListener("close", () => {
      if (this.state.party) this.set({ party: null });
    });
  }

  get current(): CongressState {
    return this.state;
  }

  private get years(): number[] {
    return this.data.houses[this.state.house].map((e) => e.year);
  }

  /** Whether the election on screen is the legislature in office (which has a "today"). */
  private get inOffice(): boolean {
    return this.state.year === inOfficeYear(this.data, this.state.house);
  }

  private get election(): CongressElection {
    const elected = this.data.houses[this.state.house].find((e) => e.year === this.state.year)!;
    if (this.state.moment === "now" && this.inOffice && this.data.now)
      return { ...this.data.now[this.state.house as "chamber" | "senate"], year: elected.year };
    return elected;
  }

  private set(patch: Partial<CongressState>, stop = false): void {
    if (stop) this.stop();
    const next = { ...this.state, ...patch };
    // Houses cover different years: keep the closest one.
    const years = this.data.houses[next.house].map((e) => e.year);
    if (!years.includes(next.year))
      next.year = years.reduce((best, y) =>
        Math.abs(y - next.year) < Math.abs(best - next.year) ? y : best,
      );
    this.state = next;
    this.hover = null;
    this.onChange();
  }

  play(): void {
    if (this.state.year === this.years.at(-1)) this.set({ year: this.years[0]! });
    this.timer = window.setInterval(() => {
      const i = this.years.indexOf(this.state.year);
      if (i >= this.years.length - 1) this.stop();
      else this.set({ year: this.years[i + 1]! });
    }, STEP_MS);
    this.renderPlay();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.renderPlay();
  }

  private renderPlay(): void {
    const b = byId("cg-play");
    b.textContent = this.timer ? "❚❚" : "▶";
    b.setAttribute("aria-pressed", String(Boolean(this.timer)));
    b.setAttribute("aria-label", this.timer ? t.congress.pause : t.congress.play);
  }

  /** Opens or closes the party modal to match the state. */
  private renderModal(): void {
    const modal = byId<HTMLDialogElement>("cg-modal");
    if (!this.state.party) {
      if (modal.open) closeDialog(modal);
      return;
    }
    modal.innerHTML = partyModalHtml(this.data, this.governismo, this.state.party);
    if (!modal.open) {
      // jsdom and old browsers lack showModal: the open attribute still shows it.
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }
  }

  render(): void {
    const s = this.state;
    const e = this.election;
    byId("cg-houses")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.house === s.house)));
    this.renderTimeline();
    const today = s.moment === "now" && this.inOffice && this.data.now;
    const title = today
      ? t.congress.titleNow(s.house, this.data.now!.date.split("-").reverse().join("/"))
      : t.congress.title(s.house, e.year) + (e.provisional ? ` · ${t.congress.projection}` : "");
    byId("cg-moment-group").hidden = !this.inOffice || !this.data.now;
    byId("cg-moment")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.moment === (today ? "now" : "elected"))),
      );
    this.renderSwitches();
    this.renderIdeology(e);
    byId("cg-title").textContent = title;
    byId("cg-meta").textContent = t.congress.meta(e.total, Math.floor(e.total / 2) + 1);
    this.renderLegend(e);
    this.renderChart(e, title);
    this.renderTable(e);
    const c = this.data.centrao;
    byId("cg-note").textContent = [
      e.provisional ? t.congress.provisional : "",
      isCongress(this.state.house) ? "" : t.congress.spNote,
      t.congress.note,
      t.congress.centraoNote(c.since, c.source.outlet),
    ]
      .filter(Boolean)
      .join(" ");
    byId("cg-sources").innerHTML = sourcesHtml(this.sources(e));
    this.renderModal();
  }

  /** The studies and pages behind what is on screen, as links. */
  private sources(e: CongressElection): SourceLink[] {
    const c = this.data.centrao.source;
    const seats =
      e.year === 2026
        ? [t.sources.tseResults, ...(this.state.house === "senate" ? [t.sources.senateOpenData] : [])]
        : isCongress(this.state.house)
          ? [t.sources.seats(e.year)]
          : [t.sources.tseCandidates];
    return [
      t.sources.zuccoPower,
      t.sources.zuccoPowerData,
      t.sources.bolognesi,
      { label: t.congress.centraoSource(c.outlet, c.title), url: c.url },
      ...seats,
    ];
  }

  private renderTimeline(): void {
    const years = this.years;
    const slider = byId<HTMLInputElement>("cg-slider");
    slider.max = String(years.length - 1);
    slider.value = String(years.indexOf(this.state.year));
    slider.setAttribute("aria-valuetext", String(this.state.year));
    byId("cg-years").replaceChildren(
      ...years.map((year) => {
        const b = button(String(year), { className: "timeline-year", pressed: year === this.state.year });
        b.dataset.year = String(year);
        return b;
      }),
    );
  }

  /**
   * Seats per group, left to right, and the Centrão: each chip selects (several
   * can be on), and the selected seats are summed against the majority.
   */
  private renderLegend(e: CongressElection): void {
    const by = seatsByGroup(e);
    const focus = this.focus;
    const chip = (key: FocusKey, keyClass: string, n: number) => {
      const b = button(
        `<i class="cg-key ${keyClass}"></i><span>${key === "centrao" ? t.congress.centrao : key === "base" ? t.congress.base : key === "centraoMeasured" ? t.congress.centraoMeasured : key === "newcomers" ? t.congress.newcomers : t.congress.group[key]}</span><span class="n">${n}</span>`,
        { className: "chip map-chip", pressed: focus.includes(key) },
      );
      b.dataset.focus = key;
      return b;
    };
    const chips: HTMLElement[] = [...GROUPS, "none" as const]
      .filter((g) => g !== "none" || by.none > 0)
      .map((g) => chip(g, `g-${g}`, by[g]));
    if (this.centraoMarked(e))
      chips.push(
        chip(
          "centrao",
          "cz-key",
          e.parties.filter((p) => p.centrao).reduce((n, p) => n + p.seats, 0),
        ),
      );
    if (e.parties.some((p) => p.newcomers !== undefined)) {
      const b = chip(
        "newcomers",
        "nv-key",
        e.parties.reduce((n, p) => n + (p.newcomers ?? 0), 0),
      );
      b.title = t.congress.newcomersTitle;
      chips.push(b);
    }
    const centraoM = this.measured(e).centrao;
    if (centraoM) {
      const b = chip("centraoMeasured", "cm-key", focusSeats(e, ["centraoMeasured"], { centrao: centraoM }));
      b.title = t.congress.centraoMeasuredTitle(this.governismo.thresholds.centrao ?? 80);
      chips.push(b);
    }
    const base = this.base(e);
    if (base) {
      const b = chip("base", "bz-key", focusSeats(e, ["base"], { base: base.lineages }));
      b.title = t.congress.baseTitle(base.term.label, this.governismo.thresholds.base);
      chips.push(b);
    }
    if (focus.length) {
      const seats = focusSeats(e, focus, this.measured(e));
      const majority = Math.floor(e.total / 2) + 1;
      const sum = document.createElement("span");
      sum.className = "cg-sum";
      sum.textContent = t.congress.selected(seats, e.total, seats >= majority);
      const clear = button(t.congress.clear, { className: "chip map-chip cg-clear" });
      clear.dataset.focus = "clear";
      chips.push(sum, clear);
    } else {
      const hint = document.createElement("span");
      hint.className = "map-steps";
      hint.textContent = t.congress.legendHint;
      hint.dataset.shareSkip = "";
      chips.push(hint);
    }
    byId("cg-legend").replaceChildren(...chips);
  }

  /** Whether this election has the Centrão marked (its source is recent). */
  private centraoMarked(e: CongressElection): boolean {
    return e.year >= this.data.centrao.since;
  }

  /** The measured sets for this election: its following term's base, and the Centrão
   * (from 2002 on, when the roll-call orientations begin). */
  private measured(e: CongressElection): Measured {
    if (!isCongress(this.state.house)) return {};
    const house = this.state.house;
    const centrao = e.year >= 2002 ? measuredCentrao(this.governismo, house) : undefined;
    return { base: this.base(e)?.lineages, centrao: centrao?.size ? centrao : undefined };
  }

  /** The government's base measured by votes in the term after this election, if there is one. */
  private base(e: CongressElection) {
    return isCongress(this.state.house) ? measuredBase(this.governismo, e.year, this.state.house) : null;
  }

  /** The selection that applies to the election on screen: no Centrão before it is marked,
   * no measured base where there is no measure. */
  private get focus(): FocusKey[] {
    const e = this.election;
    return this.state.focus.filter(
      (k) =>
        (k !== "centrao" || this.centraoMarked(e)) &&
        (k !== "base" || this.base(e) !== null) &&
        (k !== "centraoMeasured" || this.measured(e).centrao !== undefined) &&
        (k !== "newcomers" || e.parties.some((p) => p.newcomers !== undefined)),
    );
  }

  private renderChart(e: CongressElection, title: string): void {
    const { seats, radius } = hemicycle(e.parties.map((p) => p.seats));
    this.svg.setAttribute("aria-label", t.congress.aria(title));
    const measured = this.measured(e);
    const nth = new Map<number, number>(); // seats drawn so far, per party
    const dots = seats.map((seat) => {
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("cx", seat.x.toFixed(4));
      c.setAttribute("cy", (-seat.y).toFixed(4));
      c.setAttribute("r", radius.toFixed(4));
      const party = e.parties[seat.party]!;
      const k = nth.get(seat.party) ?? 0;
      nth.set(seat.party, k + 1);
      // A party's newcomers are its first seats in the drawing: a count, not who they are.
      const on = k < selectedSeats(party, this.focus, measured);
      c.setAttribute("class", groupClass(party) + (on ? " sel" : ""));
      c.dataset.p = String(seat.party);
      return c;
    });
    const total = document.createElementNS(SVG, "text");
    total.setAttribute("class", "cg-total");
    total.setAttribute("y", "-0.06");
    total.textContent = String(e.total);
    const label = document.createElementNS(SVG, "text");
    label.setAttribute("class", "cg-total-label");
    label.setAttribute("y", "0.03");
    label.textContent = t.congress.seats(e.total).replace(/^\d+ /, "");
    this.svg.replaceChildren(...dots, total, label);
    this.svg.classList.toggle("filtering", this.focus.length > 0);
    this.svg.classList.toggle("cz-on", this.focus.includes("centrao"));
    this.svg.classList.toggle("dim", false);
    this.tip.hidden = true;
  }

  private renderTable(e: CongressElection): void {
    const elections = this.data.houses[this.state.house];
    const i = elections.indexOf(e);
    const before = i > 0 ? elections[i - 1]! : null;
    const head =
      `<thead><tr><th>${t.congress.party}</th><th>${t.congress.seatsHead}</th>` +
      `<th>${t.congress.position}</th><th class="cg-traj-h">${t.congress.trajectory}</th></tr></thead>`;
    const focus = this.focus;
    const rows = e.parties.map((p, index) => {
      if (focus.length && !selectedSeats(p, focus, this.measured(e))) return "";
      const prev = before?.parties.find((q) => q.lineage === p.lineage)?.seats ?? 0;
      const delta = before ? p.seats - prev : 0;
      const change =
        before && delta ? `<span class="cg-delta">${delta > 0 ? "+" : "−"}${Math.abs(delta)}</span>` : "";
      const score = p.score === null ? "—" : t.congress.score(p.score);
      return (
        `<tr data-p="${index}">` +
        `<td><i class="cg-key ${groupClass(p)}"></i><button type="button" class="cg-open" data-open="${index}" title="${escapeHtml(t.party.open(p.party))}">${escapeHtml(p.party)}</button>${p.centrao ? ` <span class="cg-tag">${t.congress.centrao}</span>` : ""}</td>` +
        `<td>${p.seats} ${change}</td>` +
        `<td>${score} <span class="cg-group">${t.congress.group[p.group ?? "none"]}</span></td>` +
        `<td class="cg-traj">${this.trajectory(elections, p)}</td>` +
        `</tr>`
      );
    });
    byId("cg-table").innerHTML = `${head}<tbody>${rows.join("")}</tbody>`;
  }

  /**
   * The party's place over time: one dot per election it held seats in, left to
   * right in time, higher for further right; the line at 0 is the centre, and
   * this year's dot is ringed.
   */
  private trajectory(elections: CongressElection[], p: CongressParty): string {
    if (p.score === null) return "";
    const W = 120;
    const H = 30;
    const x = (i: number) => (4 + (i * (W - 8)) / Math.max(1, elections.length - 1)).toFixed(1);
    const y = (v: number) => (3 + ((1 - Math.max(-1, Math.min(1, v))) / 2) * (H - 6)).toFixed(1);
    const points = history(elections, p.lineage)
      .map((q, i) => ({ q, i }))
      .filter((d): d is { q: CongressParty; i: number } => d.q !== null && d.q.score !== null);
    const line = points.map(({ q, i }) => `${x(i)},${y(q.score!)}`).join(" ");
    const dots = points.map(({ q, i }) => {
      const now = elections[i]!.year === this.state.year;
      return `<circle cx="${x(i)}" cy="${y(q.score!)}" r="${now ? 3.5 : 2.2}" class="${groupClass(q)}${now ? " now" : ""}"><title>${elections[i]!.year}: ${t.congress.score(q.score!)}</title></circle>`;
    });
    return (
      `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(t.congress.trajectoryAria(p.party))}">` +
      `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="cg-axis"/>` +
      `<polyline points="${line}"/>` +
      dots.join("") +
      `</svg>`
    );
  }

  private onPointer(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof SVGCircleElement) || target.dataset.p === undefined) {
      this.highlight(null);
      return;
    }
    const index = Number(target.dataset.p);
    this.highlight(index);
    const host = byId("cg-chart");
    const box = host.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    this.tip.hidden = false;
    const { offsetWidth: tw, offsetHeight: th } = this.tip;
    const left = x + 14 + tw > host.clientWidth ? x - tw - 14 : x + 14;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${Math.max(0, Math.min(host.clientHeight - th, y - th / 2))}px`;
  }

  /** Brings one party forward in the chart and the table; null clears it. */
  private highlight(index: number | null): void {
    if (index === this.hover) return;
    this.hover = index;
    this.svg.classList.toggle("dim", index !== null);
    this.svg.querySelectorAll<SVGCircleElement>("circle").forEach((c) => {
      c.classList.toggle("on", Number(c.dataset.p) === index);
    });
    byId("cg-table")
      .querySelectorAll<HTMLElement>("tr[data-p]")
      .forEach((r) => r.classList.toggle("on", Number(r.dataset.p) === index));
    if (index === null) {
      this.tip.hidden = true;
      return;
    }
    this.tip.innerHTML = this.tooltip(this.election.parties[index]!);
  }

  private tooltip(p: CongressParty): string {
    const elections = this.data.houses[this.state.house];
    const line = history(elections, p.lineage);
    const firstAt = line.findIndex((q) => q !== null && q.score !== null);
    const first = firstAt >= 0 ? line[firstAt]! : null;
    const firstYear = firstAt >= 0 ? elections[firstAt]!.year : null;
    return (
      `<div class="tt-h">${escapeHtml(p.party)}</div>` +
      `<div class="tt-s">${escapeHtml(p.name)}</div>` +
      `<div class="row"><span class="key"><i class="cg-key ${groupClass(p)}"></i>${t.congress.group[p.group ?? "none"]}</span><b>${t.congress.seats(p.seats)}</b></div>` +
      (p.score !== null
        ? `<div class="row"><span>${t.congress.position}</span><b>${t.congress.score(p.score)}</b></div>`
        : "") +
      // Where the party started, when that is another election: shows who moved.
      (first && firstYear !== this.state.year
        ? `<div class="tt-s tt-foot">${t.congress.firstSeen(firstYear!, t.congress.score(first.score!), t.congress.group[first.group ?? "none"]!)}</div>`
        : "") +
      (p.centrao
        ? `<div class="tt-s tt-foot">${escapeHtml(t.congress.centraoTip(this.data.centrao.source.outlet, this.data.centrao.source.date.slice(0, 4)))}</div>`
        : "") +
      `<div class="tt-s tt-foot">${escapeHtml(t.congress.source(p.source))}</div>`
    );
  }

  /** Who changed party since elected: for the legislature in office, this house. */
  private renderSwitches(): void {
    const box = byId("cg-switches");
    const all = (this.data.now?.switches ?? []).filter((x) => x.house === this.state.house);
    box.hidden = !this.inOffice || !all.length;
    if (box.hidden) return;
    const moved = all.filter((x) => !x.extinct);
    const folded = all.filter((x) => x.extinct);
    const rows = (list: PartySwitch[]) =>
      list
        .map(
          (x) =>
            `<tr><td>${escapeHtml(x.name)} <span class="meta">${x.uf}</span></td><td>${escapeHtml(x.from)}</td><td>${escapeHtml(x.to)}</td></tr>`,
        )
        .join("");
    const head = `<thead><tr><th>${t.congress.switches.who}</th><th>${t.congress.switches.from}</th><th>${t.congress.switches.to}</th></tr></thead>`;
    box.innerHTML =
      `<summary>${escapeHtml(t.congress.switches.summary(moved.length, folded.length, this.data.now!.date.split("-").reverse().join("/")))}</summary>` +
      `<p class="meta">${t.congress.switches.note}</p>` +
      `<div class="scroll"><table>${head}<tbody>${rows(moved)}</tbody></table></div>` +
      (folded.length
        ? `<h4 class="pm-house">${t.congress.switches.foldedTitle}</h4><div class="scroll"><table>${head}<tbody>${rows(folded)}</tbody></table></div>`
        : "");
  }

  /** The legislature in office, member by member along its votes' left–right line. */
  private renderIdeology(e: CongressElection): void {
    const box = byId("cg-ideo");
    const house = isCongress(this.state.house) ? this.ideology?.[this.state.house] : undefined;
    box.hidden = !this.inOffice || !house;
    if (box.hidden || !house) return;
    const I = t.congress.ideology;
    const groupOf = new Map(e.parties.map((p) => [p.party.toUpperCase(), p.group ?? "none"]));
    const rows = byParty(house, 3);
    const W = 760;
    const row = 22;
    const m = { l: 110, r: 16, t: 26, b: 26 };
    const H = m.t + m.b + rows.length * row;
    const x = (v: number) => m.l + ((v + 1) / 2) * (W - m.l - m.r);
    const dots = rows
      .map(({ party, mean, members }, k) => {
        const y = m.t + k * row + row / 2;
        const g = groupOf.get(party.toUpperCase()) ?? "none";
        return (
          `<text x="${m.l - 8}" y="${y}" dy="0.32em" class="cv-tick" text-anchor="end">${escapeHtml(party)} (${members.length})</text>` +
          `<line x1="${x(-1)}" x2="${x(1)}" y1="${y}" y2="${y}" class="cv-rule"/>` +
          members
            .map(
              (mm) =>
                `<circle cx="${x(mm.score).toFixed(1)}" cy="${y}" r="3.5" class="g-${g} cg-ideo-dot"><title>${escapeHtml(`${mm.name} (${mm.party}-${mm.uf}): ${mm.score.toFixed(2).replace(".", ",")}`)}</title></circle>`,
            )
            .join("") +
          `<line x1="${x(mean).toFixed(1)}" x2="${x(mean).toFixed(1)}" y1="${y - 8}" y2="${y + 8}" class="cg-ideo-mean"/>`
        );
      })
      .join("");
    const axis =
      `<line x1="${x(0)}" x2="${x(0)}" y1="${m.t - 6}" y2="${H - m.b}" class="cv-zero"/>` +
      `<text x="${x(-1)}" y="${m.t - 10}" class="cv-tick">${I.left}</text>` +
      `<text x="${x(1)}" y="${m.t - 10}" class="cv-tick" text-anchor="end">${I.right}</text>`;
    const v = house.validation;
    box.innerHTML =
      `<h3 class="ap-h">${I.title(t.congress.houseName[this.state.house]!)}</h3>` +
      `<p class="meta">${I.note(this.ideology!.minVotes, v.r === null ? "—" : v.r.toFixed(2).replace(".", ","), v.parties)}</p>` +
      `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(I.aria)}">${axis}${dots}</svg></div>`;
  }
}
