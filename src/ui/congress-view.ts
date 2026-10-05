import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import {
  FOCUS_KEYS,
  GROUPS,
  focusSeats,
  hemicycle,
  inFocus,
  history,
  seatsByGroup,
  type CongressData,
  type CongressElection,
  type CongressParty,
  type FocusKey,
  type House,
} from "../model/congress";
import { button, byId } from "./dom";
import { sourcesHtml, type SourceLink } from "./sources";

export interface CongressState {
  house: House;
  year: number;
  /** Legend selection: these seats stand out and the table lists only these parties. */
  focus: FocusKey[];
}

/** Focus keys in the address: ?destaque=esquerda,centrao. */
const FOCUS_SLUGS: Record<FocusKey, string> = {
  left: "esquerda",
  "centre-left": "centro-esquerda",
  centre: "centro",
  "centre-right": "centro-direita",
  right: "direita",
  none: "sem-classificacao",
  centrao: "centrao",
};

/** Time between elections while the timeline plays. */
const STEP_MS = 1400;
const SVG = "http://www.w3.org/2000/svg";

const groupClass = (p: CongressParty) => `g-${p.group ?? "none"}${p.centrao ? " cz" : ""}`;

export function congressFromSearch(data: CongressData, params: URLSearchParams): CongressState {
  const house: House = params.get("casa") === "senado" ? "senate" : "chamber";
  const years = data.houses[house].map((e) => e.year);
  const asked = Number(params.get("ano"));
  const slugs = (params.get("destaque") ?? "").split(",");
  // ?centrao=1 came before the legend could select.
  if (params.has("centrao")) slugs.push("centrao");
  const focus = FOCUS_KEYS.filter((k) => slugs.includes(FOCUS_SLUGS[k]));
  return { house, year: years.includes(asked) ? asked : years.at(-1)!, focus };
}

export function congressToSearch(s: CongressState, data: CongressData, params: URLSearchParams): void {
  if (s.house === "senate") params.set("casa", "senado");
  if (s.year !== data.houses[s.house].at(-1)!.year) params.set("ano", String(s.year));
  if (s.focus.length) params.set("destaque", s.focus.map((k) => FOCUS_SLUGS[k]).join(","));
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
    private state: CongressState,
    private readonly onChange: () => void,
  ) {
    byId("cg-houses")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.addEventListener("click", () => this.set({ house: b.dataset.house as House })));
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
  }

  get current(): CongressState {
    return this.state;
  }

  private get years(): number[] {
    return this.data.houses[this.state.house].map((e) => e.year);
  }

  private get election(): CongressElection {
    return this.data.houses[this.state.house].find((e) => e.year === this.state.year)!;
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

  render(): void {
    const s = this.state;
    const e = this.election;
    byId("cg-houses")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.house === s.house)));
    this.renderTimeline();
    const title = t.congress.title(s.house, e.year) + (e.provisional ? ` · ${t.congress.projection}` : "");
    byId("cg-title").textContent = title;
    byId("cg-meta").textContent = t.congress.meta(e.total, Math.floor(e.total / 2) + 1);
    this.renderLegend(e);
    this.renderChart(e, title);
    this.renderTable(e);
    const c = this.data.centrao;
    byId("cg-note").textContent = [
      e.provisional ? t.congress.provisional : "",
      t.congress.note,
      t.congress.centraoNote(c.since, c.source.outlet),
    ]
      .filter(Boolean)
      .join(" ");
    byId("cg-sources").innerHTML = sourcesHtml(this.sources(e));
  }

  /** The studies and pages behind what is on screen, as links. */
  private sources(e: CongressElection): SourceLink[] {
    const c = this.data.centrao.source;
    const seats =
      e.year === 2026
        ? [t.sources.tseResults, ...(this.state.house === "senate" ? [t.sources.senateOpenData] : [])]
        : [t.sources.seats(e.year)];
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
        `<i class="cg-key ${keyClass}"></i><span>${key === "centrao" ? t.congress.centrao : t.congress.group[key]}</span><span class="n">${n}</span>`,
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
    if (focus.length) {
      const seats = focusSeats(e, focus);
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
      chips.push(hint);
    }
    byId("cg-legend").replaceChildren(...chips);
  }

  /** Whether this election has the Centrão marked (its source is recent). */
  private centraoMarked(e: CongressElection): boolean {
    return e.year >= this.data.centrao.since;
  }

  /** The selection that applies to the election on screen: no Centrão before it is marked. */
  private get focus(): FocusKey[] {
    return this.centraoMarked(this.election)
      ? this.state.focus
      : this.state.focus.filter((k) => k !== "centrao");
  }

  private renderChart(e: CongressElection, title: string): void {
    const { seats, radius } = hemicycle(e.parties.map((p) => p.seats));
    this.svg.setAttribute("aria-label", t.congress.aria(title));
    const dots = seats.map((seat) => {
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("cx", seat.x.toFixed(4));
      c.setAttribute("cy", (-seat.y).toFixed(4));
      c.setAttribute("r", radius.toFixed(4));
      const party = e.parties[seat.party]!;
      c.setAttribute("class", groupClass(party) + (inFocus(party, this.focus) ? " sel" : ""));
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
      if (focus.length && !inFocus(p, focus)) return "";
      const prev = before?.parties.find((q) => q.lineage === p.lineage)?.seats ?? 0;
      const delta = before ? p.seats - prev : 0;
      const change =
        before && delta ? `<span class="cg-delta">${delta > 0 ? "+" : "−"}${Math.abs(delta)}</span>` : "";
      const score = p.score === null ? "—" : t.congress.score(p.score);
      return (
        `<tr data-p="${index}">` +
        `<td><i class="cg-key ${groupClass(p)}"></i><b title="${escapeHtml(p.name)}">${escapeHtml(p.party)}</b>${p.centrao ? ` <span class="cg-tag">${t.congress.centrao}</span>` : ""}</td>` +
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
}
