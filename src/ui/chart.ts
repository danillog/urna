import { scaleLinear, scaleTime } from "d3-scale";
import { pointer, select } from "d3-selection";
import { area, curveMonotoneX, line } from "d3-shape";
import { timeDay, timeMonth } from "d3-time";

import {
  dayToDate,
  escapeHtml,
  formatDate,
  formatDayMonth,
  formatIsoDate,
  integer,
  percent,
  shortName,
} from "../format";
import { t } from "../i18n/pt-BR";
import type { TrendPoint } from "../model/smoothing";
import { finalPoint, type View } from "../model/view";
import { UNDECIDED, type Poll, type TimelineEvent } from "../types";
import { colorOf, cssVar } from "./dom";

export interface ChartOptions {
  year: number;
  title: string;
  events: TimelineEvent[];
  highlight: string | null;
}

interface Dot {
  poll: Poll;
  series: string;
  cx: number;
  cy: number;
}

interface EndLabel {
  series: string;
  value: number;
  result?: number;
  y: number;
  /** Label position after collision avoidance. */
  ly: number;
}

const NARROW_WIDTH = 560;
const MIN_WIDTH = 320;
/** Below this span the x axis shows days instead of months. */
const MONTH_AXIS_MIN_DAYS = 60;
/** Squared pixel distance under which the pointer snaps to a poll. */
const SNAP_DISTANCE_SQ = 100;
const EVENT_ROW_HEIGHT = 13;

const seriesLabel = (series: string) => t.series[series] ?? series;

export function renderChart(host: HTMLElement, view: View, opts: ChartOptions): void {
  host.innerHTML = "";
  if (!view.polls.length) {
    host.innerHTML = `<div class="empty">${t.noPolls}</div>`;
    return;
  }
  const { race, order } = view;
  const toDate = (day: number) => dayToDate(opts.year, day);
  const color = (series: string) => colorOf(race, series);

  const W = Math.max(MIN_WIDTH, host.clientWidth);
  const narrow = W < NARROW_WIDTH;
  const H = narrow ? 380 : 460;
  const m = { top: 30, right: narrow ? 92 : 128, bottom: 34, left: 34 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const x0 = toDate(view.firstDay - 2);
  const x1 = toDate(view.endDay);
  const x = scaleTime().domain([x0, x1]).range([0, iw]);
  const values = view.polls.flatMap((p) => race.series.map((c) => p.v[c]).filter((v) => v != null));
  const resultMax = race.result ? Math.max(...Object.values(race.result)) : 0;
  const yMax = Math.max(60, Math.ceil((Math.max(...values, resultMax) + 4) / 10) * 10);
  const y = scaleLinear().domain([0, yMax]).range([ih, 0]);

  const svg = select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", t.chartAria(opts.title));
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Horizontal grid and percent labels.
  const yAxis = g.append("g").attr("class", "tick");
  for (const tick of y.ticks(yMax / 10)) {
    yAxis
      .append("line")
      .attr("x1", 0)
      .attr("x2", iw)
      .attr("y1", y(tick))
      .attr("y2", y(tick))
      .attr("stroke", cssVar(tick === 0 ? "--axis" : "--grid"))
      .attr("stroke-dasharray", tick === 0 ? null : "3 4");
    if (tick > 0) {
      yAxis
        .append("text")
        .attr("x", -8)
        .attr("y", y(tick))
        .attr("dy", "0.32em")
        .attr("text-anchor", "end")
        .text(`${tick}%`);
    }
  }

  // Months for a full year, days for a short runoff campaign.
  const xAxis = g.append("g").attr("class", "month").attr("transform", `translate(0,${ih})`);
  const spanDays = view.endDay - view.firstDay;
  const tickMark = (d: Date) =>
    xAxis
      .append("line")
      .attr("x1", x(d))
      .attr("x2", x(d))
      .attr("y1", 0)
      .attr("y2", 5)
      .attr("stroke", cssVar("--axis"));
  if (spanDays > MONTH_AXIS_MIN_DAYS) {
    for (const d of timeMonth.range(timeMonth.ceil(x0), x1)) {
      tickMark(d);
      const mid = new Date(d.getFullYear(), d.getMonth(), 15);
      if (mid < x1 && (!narrow || d.getMonth() % 2 === 0)) {
        xAxis
          .append("text")
          .attr("x", x(mid))
          .attr("y", 22)
          .attr("text-anchor", "middle")
          .text(t.months[d.getMonth()]!);
      }
    }
  } else {
    const step = narrow || spanDays > 30 ? 7 : 3;
    for (const d of timeDay.range(timeDay.ceil(x0), x1, step)) {
      tickMark(d);
      xAxis
        .append("text")
        .attr("x", x(d))
        .attr("y", 22)
        .attr("text-anchor", "middle")
        .text(formatDayMonth(d));
    }
  }

  // Campaign events, skipped when they would collide with the end labels.
  const events = opts.events
    .map((e) => ({ ...e, date: toDate(e.day) }))
    .filter(
      (e) =>
        e.date > x0 &&
        e.date < x1 &&
        spanDays > MONTH_AXIS_MIN_DAYS &&
        (e.pinned || view.hasResult || x(x1) - x(e.date) > (narrow ? 90 : 70)),
    );
  const eventLayer = g.append("g");
  for (const e of events) {
    const ex = x(e.date);
    eventLayer
      .append("line")
      .attr("x1", ex)
      .attr("x2", ex)
      .attr("y1", -4 + e.row * EVENT_ROW_HEIGHT)
      .attr("y2", ih)
      .attr("stroke", cssVar("--axis"))
      .attr("stroke-dasharray", "2 3");
    eventLayer
      .append("text")
      .attr("x", ex - 4)
      .attr("y", -8 + e.row * EVENT_ROW_HEIGHT)
      .attr("text-anchor", "end")
      .attr("fill", cssVar("--muted"))
      .attr("font-size", narrow ? 10 : 11)
      .text(e.label);
  }

  // Election day (or latest poll) marker.
  const endX = x(x1);
  g.append("line")
    .attr("x1", endX)
    .attr("x2", endX)
    .attr("y1", -18)
    .attr("y2", ih)
    .attr("stroke", cssVar("--ink"))
    .attr("stroke-width", 1.2);
  g.append("text")
    .attr("class", "end-date")
    .attr("x", endX)
    .attr("y", -22)
    .attr("text-anchor", "middle")
    .attr("fill", cssVar("--ink"))
    .text(view.hasResult ? formatIsoDate(race.date).slice(0, 5) : formatDayMonth(toDate(view.endDay - 1)));
  if (!view.hasResult) {
    g.append("text")
      .attr("x", endX - 5)
      .attr("y", -8)
      .attr("text-anchor", "end")
      .attr("fill", cssVar("--muted"))
      .attr("font-size", 11)
      .text(t.electionOn(formatIsoDate(race.date).slice(0, 5)));
  }

  const px = (d: TrendPoint) => x(toDate(d.d));
  const band = area<TrendPoint>()
    .x(px)
    .y0((d) => y(Math.max(0, d.lo)))
    .y1((d) => y(d.hi))
    .curve(curveMonotoneX);
  const trendLine = line<TrendPoint>()
    .x(px)
    .y((d) => y(d.y))
    .curve(curveMonotoneX);

  const bands = g.append("g");
  for (const series of order.filter((c) => c !== UNDECIDED)) {
    bands
      .append("path")
      .attr("d", band(view.trends[series]!))
      .attr("fill", color(series))
      .attr("fill-opacity", cssVar("--band-opacity"));
  }

  // One dot per poll and series.
  const dots: Dot[] = [];
  for (const poll of view.polls) {
    for (const series of race.series) {
      const v = poll.v[series];
      if (v == null || (!view.trends[series] && series !== UNDECIDED)) continue;
      dots.push({ poll, series, cx: x(toDate(poll.d)), cy: y(v) });
    }
  }
  const isHighlighted = (d: Dot) => opts.highlight !== null && d.poll.p === opts.highlight;
  const radius = narrow ? 2.4 : 3;
  const dotLayer = g.append("g");
  dotLayer
    .selectAll("circle")
    .data(dots)
    .join("circle")
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", (d) => (isHighlighted(d) ? (narrow ? 4 : 5) : radius))
    .attr("fill", (d) => color(d.series))
    .attr("fill-opacity", (d) =>
      opts.highlight ? (isHighlighted(d) ? 0.95 : 0.1) : d.series === UNDECIDED ? 0.28 : 0.42,
    )
    .attr("stroke", (d) => (isHighlighted(d) ? cssVar("--surface") : null))
    .attr("stroke-width", 1.5);
  if (opts.highlight) dotLayer.selectAll<SVGCircleElement, Dot>("circle").filter(isHighlighted).raise();

  // Trend lines, each with a halo so crossings stay readable.
  const lines = g.append("g");
  for (const series of order) {
    const undecided = series === UNDECIDED;
    const d = trendLine(view.trends[series]!);
    lines
      .append("path")
      .attr("d", d)
      .attr("fill", "none")
      .attr("stroke", cssVar("--surface"))
      .attr("stroke-width", undecided ? 4 : 6)
      .attr("stroke-linejoin", "round");
    lines
      .append("path")
      .attr("d", d)
      .attr("fill", "none")
      .attr("stroke", color(series))
      .attr("stroke-width", undecided ? 2 : 3)
      .attr("stroke-linecap", "round")
      .attr("stroke-dasharray", undecided ? "5 4" : race.dashed.includes(series) ? "7 4" : null);
  }

  // Official results as diamonds on election day.
  const result = race.result ?? {};
  const results = g.append("g");
  for (const [series, v] of Object.entries(result)) {
    if (!race.colors[series]) continue;
    results
      .append("rect")
      .attr("x", endX - 5)
      .attr("y", y(v) - 5)
      .attr("width", 10)
      .attr("height", 10)
      .attr("transform", `rotate(45 ${endX} ${y(v)})`)
      .attr("fill", cssVar("--surface"))
      .attr("stroke", color(series))
      .attr("stroke-width", 2.2);
  }

  drawEndLabels(g, view, { y, endX, ih, narrow, result, toX: (d) => x(toDate(d)) });
  attachTooltip(host, g, view, { x, y, iw, ih, m, dots, toDate, color, year: opts.year });
}

type Group = ReturnType<typeof select<SVGGElement, unknown>>;

/** Name and latest value at the right edge, pushed apart so they never overlap. */
function drawEndLabels(
  g: Group,
  view: View,
  o: {
    y: (v: number) => number;
    toX: (d: number) => number;
    endX: number;
    ih: number;
    narrow: boolean;
    result: Record<string, number>;
  },
): void {
  const gap = o.narrow ? 30 : 34;
  const maxY = o.ih + 16;
  const right: EndLabel[] = [];
  const layer = g.append("g");

  const stopsEarly: string[] = [];
  for (const series of view.order) {
    const end = finalPoint(view, series);
    if (end) right.push({ series, value: end.y, result: o.result[series], y: o.y(end.y), ly: o.y(end.y) });
    else stopsEarly.push(series);
  }

  right.sort((a, b) => a.y - b.y);
  right.forEach((l, i) => {
    l.ly = i === 0 ? l.y : Math.max(l.y, right[i - 1]!.ly + gap);
  });
  const lastLabel = right.at(-1);
  if (lastLabel && lastLabel.ly > maxY) {
    lastLabel.ly = maxY;
    for (let i = right.length - 2; i >= 0; i--) right[i]!.ly = Math.min(right[i]!.ly, right[i + 1]!.ly - gap);
  }

  const lx = o.endX + 12;
  for (const l of right) {
    layer
      .append("text")
      .attr("class", "series-name")
      .attr("x", lx)
      .attr("y", l.ly - 3)
      .attr("fill", cssVar("--ink"))
      .attr("font-size", o.narrow ? 14 : 16)
      .text(shortName(seriesLabel(l.series), o.narrow));
    layer
      .append("rect")
      .attr("x", lx - 7)
      .attr("y", l.ly - 14)
      .attr("width", 3)
      .attr("height", o.narrow ? 26 : 30)
      .attr("rx", 1.5)
      .attr("fill", colorOf(view.race, l.series));
    layer
      .append("text")
      .attr("class", "series-value")
      .attr("x", lx)
      .attr("y", l.ly + 12)
      .attr("fill", cssVar("--ink-2"))
      .attr("font-size", o.narrow ? 12 : 13)
      .text(percent(l.value) + (l.result != null && !o.narrow ? `  ◇ ${percent(l.result)}` : ""));
  }

  // Lines that stop early (a candidate who left the race) get a label at their tip.
  for (const series of stopsEarly) {
    const last = view.trends[series]!.at(-1)!;
    layer
      .append("text")
      .attr("class", "series-name")
      .attr("x", o.toX(last.d) + 6)
      .attr("y", o.y(last.y) - 8)
      .attr("fill", cssVar("--ink"))
      .attr("font-size", 14)
      .text(seriesLabel(series));
  }
}

/** Near a dot: that poll. Elsewhere: the averages on the hovered day. */
function attachTooltip(
  host: HTMLElement,
  g: Group,
  view: View,
  o: {
    x: ReturnType<typeof scaleTime<number, number>>;
    y: (v: number) => number;
    iw: number;
    ih: number;
    m: { top: number; left: number };
    dots: Dot[];
    toDate: (d: number) => Date;
    color: (series: string) => string;
    year: number;
  },
): void {
  const tip = select(host).append("div").attr("class", "tooltip").attr("hidden", true);
  const cross = g
    .append("line")
    .attr("y1", 0)
    .attr("y2", o.ih)
    .attr("stroke", cssVar("--ink-2"))
    .style("display", "none");
  const ring = g
    .append("circle")
    .attr("r", 6)
    .attr("fill", "none")
    .attr("stroke-width", 2)
    .style("display", "none");
  const markers = g.append("g").style("display", "none");

  const row = (series: string, v: number) =>
    `<div class="row"><span class="key"><i style="background:${o.color(series)}"></i>${escapeHtml(
      seriesLabel(series),
    )}</span><b>${percent(v)}</b></div>`;
  const undecidedLast = (a: string, b: string) => Number(a === UNDECIDED) - Number(b === UNDECIDED);

  const hide = () => {
    tip.attr("hidden", true);
    cross.style("display", "none");
    ring.style("display", "none");
    markers.style("display", "none");
  };
  const place = (px: number, py: number) => {
    const node = tip.node()!;
    const tw = node.offsetWidth;
    const th = node.offsetHeight;
    let left = o.m.left + px + 14;
    if (left + tw > host.clientWidth) left = o.m.left + px - tw - 14;
    const top = Math.max(0, Math.min(host.clientHeight - th, o.m.top + py - th / 2));
    tip.style("left", `${left}px`).style("top", `${top}px`);
  };

  g.append("rect")
    .attr("width", o.iw + 6)
    .attr("height", o.ih)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("pointerleave", hide)
    .on("pointermove", (event: PointerEvent) => {
      const [px, py] = pointer(event);
      let nearest: Dot | null = null;
      let best = SNAP_DISTANCE_SQ;
      for (const d of o.dots) {
        const dist = (d.cx - px) ** 2 + (d.cy - py) ** 2;
        if (dist < best) {
          best = dist;
          nearest = d;
        }
      }
      tip.attr("hidden", null);

      if (nearest) {
        const p = nearest.poll;
        cross.style("display", "none");
        markers.style("display", "none");
        ring
          .style("display", null)
          .attr("cx", nearest.cx)
          .attr("cy", nearest.cy)
          .attr("stroke", o.color(nearest.series));
        const rows = view.race.series
          .filter((c) => p.v[c] != null)
          .sort((a, b) => undecidedLast(a, b) || p.v[b]! - p.v[a]!)
          .map((c) => row(c, p.v[c]!))
          .join("");
        const sample = p.n ? ` · ${t.tooltipInterviews(integer(p.n))}` : "";
        tip.html(
          `<div class="tt-h">${escapeHtml(p.p)}</div><div class="tt-s">${formatDate(o.toDate(p.d))}${sample}</div>${rows}`,
        );
        place(nearest.cx, nearest.cy);
        return;
      }

      ring.style("display", "none");
      const date = o.x.invert(Math.max(0, Math.min(o.iw, px)));
      const day = Math.round((date.getTime() - new Date(o.year, 0, 1).getTime()) / 864e5);
      const points = view.order
        .map((series) => ({ series, pt: view.trends[series]!.find((tp) => tp.d === day) }))
        .filter((v): v is { series: string; pt: TrendPoint } => v.pt !== undefined);
      if (!points.length) {
        hide();
        return;
      }
      const cx = o.x(o.toDate(day));
      cross.style("display", null).attr("x1", cx).attr("x2", cx);
      markers
        .style("display", null)
        .selectAll("circle")
        .data(points)
        .join("circle")
        .attr("cx", cx)
        .attr("cy", (v) => o.y(v.pt.y))
        .attr("r", 4.5)
        .attr("fill", (v) => o.color(v.series))
        .attr("stroke", cssVar("--surface"))
        .attr("stroke-width", 2);
      const rows = [...points]
        .sort((a, b) => undecidedLast(a.series, b.series) || b.pt.y - a.pt.y)
        .map((v) => row(v.series, v.pt.y))
        .join("");
      tip.html(
        `<div class="tt-h">${formatDate(o.toDate(day))}</div><div class="tt-s">${t.tooltipAverage}</div>${rows}`,
      );
      place(cx, py);
    });
}
