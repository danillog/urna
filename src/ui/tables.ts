import {
  dayToDate,
  escapeHtml,
  formatDate,
  formatDayMonth,
  formatIsoDate,
  integer,
  percent,
  points,
  signedPoints,
} from "../format";
import { t } from "../i18n/pt-BR";
import { finalPoint, trackRecord, type View } from "../model/view";
import { methodOf, type AppState } from "../state";
import { UNDECIDED, type Dataset } from "../types";
import type { Update } from "./controls";
import { button, byId, colorOf } from "./dom";

const head = (cells: string[]) => `<thead><tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
const label = (series: string) => escapeHtml(t.series[series] ?? series);

/** Final average next to the official result, converted to valid votes when possible. */
export function renderComparison(view: View, year: number): void {
  const { race } = view;
  const result = race.result;
  const undecided = view.trends[UNDECIDED]?.at(-1) ?? null;
  const keys = result ? Object.keys(result) : view.order.filter((c) => c !== UNDECIDED);

  const rows = keys.map((series) => {
    const average = finalPoint(view, series)?.y ?? null;
    let valid: number | null = null;
    if (average !== null && race.validVotesOnly) valid = average;
    else if (average !== null && undecided) valid = (average / (100 - undecided.y)) * 100;
    const official = result?.[series] ?? null;
    const diff = valid !== null && official !== null ? official - valid : null;
    const who = `<span class="who"><i style="background:${colorOf(race, series)}"></i>${label(series)}</span>`;
    const cells = [who, percent(average), percent(valid)];
    if (result) cells.push(`<b>${percent(official)}</b>`, diff === null ? "—" : signedPoints(diff));
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  });

  byId("cmp-title").textContent = result ? t.compareTitleResult : t.compareTitleCurrent;
  byId("cmp").innerHTML =
    head(result ? t.compareHead : t.compareHeadCurrent) + `<tbody>${rows.join("")}</tbody>`;

  let note = result
    ? t.compareNoteResult
    : t.compareNoteCurrent(formatDate(dayToDate(year, view.endDay - 1)), formatIsoDate(race.date));
  if (race.validVotesOnly) note += t.compareValidOnly;
  else if (!undecided) note += t.compareNoUndecided;
  else note += t.compareUndecided(percent(undecided.y));
  byId("cmp-note").textContent = note;
}

/** Ranks pollsters by their final poll, or by their past record while there is no result yet. */
export function renderAccuracy(data: Dataset, view: View, s: AppState, year: number, update: Update): void {
  const active = new Set(view.polls.map((p) => p.p));
  const method = (p: string) => t.method[methodOf(data, p)];
  let rows: { pollster: string; cells: (string | number)[] }[];

  if (view.hasResult) {
    const accuracy = view.race.accuracy.filter((a) => active.has(a.p));
    byId("acc-title").textContent = t.accuracyTitle;
    byId("acc-note").textContent = accuracy.length ? t.accuracyNote : t.accuracyEmpty;
    byId("acc").innerHTML = head(t.accuracyHead);
    rows = accuracy.map((a, i) => ({
      pollster: a.p,
      cells: [
        i + 1,
        escapeHtml(a.p),
        method(a.p),
        formatDayMonth(dayToDate(year, a.d)),
        `<b>${points(a.meanError)}</b>`,
        points(a.marginError),
      ],
    }));
  } else {
    byId("acc-title").textContent = t.historyTitle;
    const past = Object.keys(data.presidential).filter((y) =>
      Object.values(data.presidential[y]!.rounds).some((r) => r.result),
    );
    byId("acc-note").textContent = t.historyNote(String(year), past[0]!, past.at(-1)!);
    byId("acc").innerHTML = head(t.historyHead);
    rows = trackRecord(data, active).map((r, i) => ({
      pollster: r.pollster,
      cells: [
        r.meanError === null ? "" : i + 1,
        escapeHtml(r.pollster),
        method(r.pollster),
        r.rounds || "—",
        `<b>${r.meanError === null ? "—" : points(r.meanError)}</b>`,
        r.marginError === null ? "—" : points(r.marginError),
      ],
    }));
  }

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const on = s.highlight === row.pollster;
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-pressed", String(on));
    tr.classList.toggle("on", on);
    tr.innerHTML = row.cells.map((c) => `<td>${c}</td>`).join("");
    const toggle = () => update({ ...s, highlight: on ? null : row.pollster });
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    body.appendChild(tr);
  }
  byId("acc").appendChild(body);
}

export function renderHighlightBar(data: Dataset, view: View, s: AppState, update: Update): void {
  const bar = byId("hl-bar");
  bar.innerHTML = "";
  bar.hidden = !s.highlight;
  if (!s.highlight) return;
  const polls = view.polls.filter((p) => p.p === s.highlight).length;
  const text = document.createElement("span");
  text.innerHTML = t.highlighting(escapeHtml(s.highlight), polls, t.method[methodOf(data, s.highlight)]);
  const clear = button(t.clearHighlight, { id: "hl-clear", className: "chip reset" });
  clear.addEventListener("click", () => update({ ...s, highlight: null }));
  bar.append(text, clear);
}

export function renderPollTable(view: View, year: number): void {
  const { series } = view.race;
  const rows = [...view.polls]
    .sort((a, b) => b.d - a.d)
    .map((p) => {
      const cells = [
        escapeHtml(p.p),
        formatDate(dayToDate(year, p.d)),
        p.n ? integer(p.n) : "—",
        ...series.map((c) => percent(p.v[c])),
      ];
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
    });
  byId("polls-table").innerHTML =
    head([...t.pollsHead, ...series.map(label)]) + `<tbody>${rows.join("")}</tbody>`;
}
