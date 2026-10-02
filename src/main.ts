import "./styles.css";

import dataset from "../data/generated/elections.json";
// Imported as text: type inference over megabytes of coordinates would stall the compiler.
import mapJson from "../data/generated/map.json?raw";
import { formatDate, formatIsoDate, dayToDate } from "./format";
import { t } from "./i18n/pt-BR";
import { MapData } from "./model/map-data";
import { buildView } from "./model/view";
import { fromSearch, raceFor, toSearch, type AppState } from "./state";
import type { Dataset, MunicipalMap } from "./types";
import { renderChart } from "./ui/chart";
import { renderContext } from "./ui/context";
import { renderControls, setupControls } from "./ui/controls";
import { byId } from "./ui/dom";
import { renderLegend } from "./ui/legend";
import { MapView, mapFromSearch, mapToSearch } from "./ui/map-view";
import { renderAccuracy, renderComparison, renderHighlightBar, renderPollTable } from "./ui/tables";

type View = "polls" | "map";

const data = dataset as unknown as Dataset;
const params = new URLSearchParams(window.location.search);
let view: View = params.get("view") === "map" ? "map" : "polls";
let state: AppState = fromSearch(data, view === "polls" ? window.location.search : "");

// The map data is parsed the first time the map tab opens.
let municipalMap: MunicipalMap | null = null;
let mapView: MapView | null = null;

function ensureMap(): MapView {
  if (!mapView) {
    municipalMap = JSON.parse(mapJson) as MunicipalMap;
    const mapData = new MapData(municipalMap);
    const initial = mapFromSearch(mapData, view === "map" ? params : new URLSearchParams());
    const stateNames = Object.fromEntries(Object.values(data.states).map((st) => [st.uf, st.name]));
    mapView = new MapView(
      mapData,
      initial,
      () => {
        syncUrl();
        mapView!.render(municipalMap!);
      },
      stateNames,
    );
  }
  return mapView;
}

function syncUrl(): void {
  let search: string;
  if (view === "map" && mapView) {
    const p = new URLSearchParams({ view: "map" });
    mapToSearch(mapView.current, p);
    search = `?${p.toString()}`;
  } else {
    search = toSearch(data, state);
  }
  window.history.replaceState(null, "", search || window.location.pathname);
}

function update(next: AppState): void {
  state = next;
  syncUrl();
  renderPolls();
}

function showView(next: View): void {
  view = next;
  if (view !== "map") mapView?.stop();
  for (const v of ["polls", "map"] as const) {
    byId(`${v}-view`).hidden = v !== view;
    byId(`tab-${v}`).setAttribute("aria-selected", String(v === view));
  }
  const copy = t.views[view];
  byId("eyebrow").textContent = copy.eyebrow;
  byId("headline").textContent = copy.headline;
  byId("lede").textContent = copy.lede;
  if (view === "map") ensureMap().render(municipalMap!);
  else renderPolls();
  syncUrl();
}

function chartTitle(s: AppState, date: string): string {
  if (s.office === "president") return t.chartTitlePresident(s.year, t.round[s.round], date);
  const round = s.office === "senate" ? null : t.round[s.round];
  return t.chartTitleState(t.office[s.office], data.states[s.uf]!.name, round, date);
}

function renderPolls(): void {
  if (view !== "polls") return;
  const race = raceFor(data, state)!;
  const pollsView = buildView(data, race, state);
  if (state.highlight && !pollsView.polls.some((p) => p.p === state.highlight))
    state = { ...state, highlight: null };
  const year = Number(race.date.slice(0, 4));
  const title = chartTitle(state, formatIsoDate(race.date));

  renderControls(data, state, update);
  renderHighlightBar(data, pollsView, state, update);
  byId("chart-title").textContent = title;
  const days = pollsView.polls.map((p) => p.d);
  const span = days.length
    ? [Math.min(...days), Math.max(...days)].map((d) => formatDate(dayToDate(year, d)))
    : ["—", "—"];
  byId("chart-meta").textContent = t.chartMeta(
    pollsView.polls.length,
    new Set(pollsView.polls.map((p) => p.p)).size,
    span[0]!,
    span[1]!,
  );
  renderLegend(pollsView);
  renderChart(byId("chart"), pollsView, {
    year,
    title,
    events: state.office === "president" ? data.presidential[state.year]!.events : [],
    highlight: state.highlight,
  });
  renderComparison(pollsView, year);
  renderAccuracy(data, pollsView, state, year, update);
  renderPollTable(pollsView, year);
  renderContext(data, race, state);
}

setupControls(data, () => state, update);
for (const v of ["polls", "map"] as const) byId(`tab-${v}`).addEventListener("click", () => showView(v));
showView(view);

// The chart reads colors from CSS variables, so redraw it on resize and theme changes.
// (The map is colored by CSS classes and follows the theme on its own.)
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderPolls, 150);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderPolls);
new MutationObserver(renderPolls).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
