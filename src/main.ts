import "./styles.css";

import dataset from "../data/generated/elections.json";
// Imported as text: type inference over 2 MB of coordinates would stall the compiler.
import mapJson from "../data/generated/map.json?raw";
import { formatDate, formatIsoDate, dayToDate } from "./format";
import { t } from "./i18n/pt-BR";
import { buildView } from "./model/view";
import { fromSearch, raceFor, toSearch, type AppState } from "./state";
import type { Dataset, MunicipalMap } from "./types";
import { renderChart } from "./ui/chart";
import { renderContext } from "./ui/context";
import { renderControls, setupControls } from "./ui/controls";
import { byId } from "./ui/dom";
import { renderLegend } from "./ui/legend";
import { renderMap } from "./ui/map";
import { renderAccuracy, renderComparison, renderHighlightBar, renderPollTable } from "./ui/tables";

const data = dataset as unknown as Dataset;
const municipalMap = JSON.parse(mapJson) as MunicipalMap;
let state: AppState = fromSearch(data, window.location.search);

function update(next: AppState): void {
  state = next;
  const url = toSearch(data, state) || window.location.pathname;
  window.history.replaceState(null, "", url);
  render();
}

function chartTitle(s: AppState, date: string): string {
  if (s.office === "president") return t.chartTitlePresident(s.year, t.round[s.round], date);
  const round = s.office === "senate" ? null : t.round[s.round];
  return t.chartTitleState(t.office[s.office], data.states[s.uf]!.name, round, date);
}

function render(): void {
  const race = raceFor(data, state)!;
  const view = buildView(data, race, state);
  if (state.highlight && !view.polls.some((p) => p.p === state.highlight))
    state = { ...state, highlight: null };
  const year = Number(race.date.slice(0, 4));
  const title = chartTitle(state, formatIsoDate(race.date));

  renderControls(data, state, update);
  renderHighlightBar(data, view, state, update);
  byId("chart-title").textContent = title;
  const days = view.polls.map((p) => p.d);
  const span = days.length
    ? [Math.min(...days), Math.max(...days)].map((d) => formatDate(dayToDate(year, d)))
    : ["—", "—"];
  byId("chart-meta").textContent = t.chartMeta(
    view.polls.length,
    new Set(view.polls.map((p) => p.p)).size,
    span[0]!,
    span[1]!,
  );
  renderLegend(view);
  renderChart(byId("chart"), view, {
    year,
    title,
    events: state.office === "president" ? data.presidential[state.year]!.events : [],
    highlight: state.highlight,
  });
  renderMap(
    municipalMap,
    state.office === "president" ? municipalMap.races[`${state.year}-${state.round}`] : undefined,
    title,
  );
  renderComparison(view, year);
  renderAccuracy(data, view, state, year, update);
  renderPollTable(view, year);
  renderContext(data, race, state);
}

setupControls(data, () => state, update);
render();

// Colors are read from CSS variables, so redraw on resize and on theme changes.
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 150);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
new MutationObserver(render).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
