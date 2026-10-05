import { scaleLinear, scaleLog } from "d3-scale";

import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";

/** One dot: x in data units, y a vote share (0–100), radius in pixels, a color class. */
export interface Dot {
  x: number;
  y: number;
  r: number;
  cls: string;
  /** Handed back to `tooltip` on hover. */
  id: number;
}

export interface ScatterSpec {
  dots: Dot[];
  log: boolean;
  /** Round ticks for a log axis; a linear axis picks its own. */
  logTicks?: number[];
  format: (x: number) => string;
  /** Drawn over the dots, in data units: the vote by tenth of the population. */
  line?: { x: number; y: number }[];
  aria: string;
  axisLabel: string;
  tooltip: (id: number) => string;
}

const W = 640;
const H = 440;
const M = { l: 52, r: 14, t: 12, b: 42 };
const SVG_NS = "http://www.w3.org/2000/svg";

/** A vote-share scatter with a hover tooltip on the nearest dot. */
export class Scatter {
  private readonly tip: HTMLDivElement;
  private points: { x: number; y: number; id: number }[] = [];
  private tooltip: (id: number) => string = () => "";

  constructor(private readonly host: HTMLElement) {
    this.tip = document.createElement("div");
    this.tip.className = "tooltip";
    this.tip.hidden = true;
    host.append(this.tip);
    host.addEventListener("pointermove", (e) => this.onPointer(e));
    host.addEventListener("pointerleave", () => (this.tip.hidden = true));
  }

  draw(spec: ScatterSpec): void {
    const xs = spec.dots.map((d) => d.x);
    const lo = Math.max(spec.log ? 1 : 0, Math.min(...xs));
    const hi = Math.max(lo + 1, ...xs);
    const x = (spec.log ? scaleLog() : scaleLinear())
      .domain([lo, hi])
      .range([M.l, W - M.r])
      .nice();
    const y = scaleLinear()
      .domain([0, 100])
      .range([H - M.b, M.t]);
    const [d0, d1] = x.domain() as [number, number];
    const ticks =
      spec.log && spec.logTicks ? spec.logTicks.filter((v) => v >= d0 && v <= d1) : (x.ticks(6) as number[]);
    const xTicks = ticks.map(
      (v) =>
        `<g transform="translate(${x(v).toFixed(1)},0)"><line y1="${M.t}" y2="${H - M.b}" class="cv-rule"/><text y="${H - M.b + 18}" class="cv-tick" text-anchor="middle">${escapeHtml(spec.format(v))}</text></g>`,
    );
    const yTicks = [0, 25, 50, 75, 100].map(
      (v) =>
        `<g transform="translate(0,${y(v).toFixed(1)})"><line x1="${M.l}" x2="${W - M.r}" class="cv-rule"/><text x="${M.l - 8}" dy="0.32em" class="cv-tick" text-anchor="end">${v}%</text></g>`,
    );
    // Big dots first, so small ones stay visible on top.
    const order = [...spec.dots].sort((a, b) => b.r - a.r);
    this.points = order.map((d) => ({ x: x(Math.max(lo, d.x)), y: y(d.y), id: d.id }));
    const circles = order.map(
      (d, k) =>
        `<circle cx="${this.points[k]!.x.toFixed(1)}" cy="${this.points[k]!.y.toFixed(1)}" r="${d.r.toFixed(1)}" class="${d.cls}"/>`,
    );
    const line = spec.line?.map((p) => `${x(Math.max(lo, p.x)).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", spec.aria);
    svg.innerHTML =
      xTicks.join("") +
      yTicks.join("") +
      `<line x1="${M.l}" x2="${W - M.r}" y1="${y(50)}" y2="${y(50)}" class="cv-half"/>` +
      `<g class="cv-dots">${circles.join("")}</g>` +
      (line ? `<polyline points="${line}" class="cv-line"/>` : "") +
      `<text x="${W - M.r}" y="${H - 6}" class="cv-axis-label" text-anchor="end">${escapeHtml(spec.axisLabel)}</text>`;
    this.host.querySelector("svg")?.remove();
    this.host.prepend(svg);
    this.tooltip = spec.tooltip;
    this.tip.hidden = true;
  }

  private onPointer(event: PointerEvent): void {
    const svg = this.host.querySelector("svg");
    if (!svg || !this.points.length) return;
    const box = svg.getBoundingClientRect();
    const scale = W / box.width;
    const px = (event.clientX - box.left) * scale;
    const py = (event.clientY - box.top) * scale;
    let best: { id: number } | null = null;
    let bestD = 14 * scale;
    for (const p of this.points) {
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) {
      this.tip.hidden = true;
      return;
    }
    this.tip.innerHTML = this.tooltip(best.id);
    this.tip.hidden = false;
    const hb = this.host.getBoundingClientRect();
    const hx = event.clientX - hb.left;
    const hy = event.clientY - hb.top;
    const { offsetWidth: tw, offsetHeight: th } = this.tip;
    this.tip.style.left = `${Math.max(0, hx + 14 + tw > this.host.clientWidth ? hx - tw - 14 : hx + 14)}px`;
    this.tip.style.top = `${Math.max(0, Math.min(this.host.clientHeight - th, hy - th / 2))}px`;
  }
}

/** "Cor: % de evangélicos: menos ■■■…■ mais", and the line's key, under a scatter or map. */
export function decileLegend(label: string, line: boolean): string {
  return (
    `<span class="map-steps">${escapeHtml(label)}: ${t.census.decileLow}</span>` +
    Array.from({ length: 10 }, (_, k) => `<i class="map-key q${k}"></i>`).join("") +
    `<span class="map-steps">${t.census.decileHigh}</span>` +
    (line ? `<span class="map-steps"><i class="cv-line-key"></i>${t.census.line}</span>` : "")
  );
}
