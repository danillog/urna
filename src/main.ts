import "./styles.css";

import dataset from "../data/generated/elections.json";
// Imported as text: type inference over megabytes of coordinates would stall the compiler.
import mapJson from "../data/generated/map.json?raw";
import americasJson from "../data/generated/americas.json?raw";
import americasTopoJson from "../data/generated/americas.topo.json?raw";
import indicatorsJson from "../data/generated/americas-indicators.json?raw";
import apuracaoCidadesJson from "../data/generated/apuracao-cidades.json?raw";
import congressJson from "../data/generated/congress.json?raw";
import { formatDate, formatIsoDate, dayToDate } from "./format";
import { t } from "./i18n/pt-BR";
import type { AmericasData } from "./model/americas";
import type { CongressData } from "./model/congress";
import { MapData } from "./model/map-data";
import { buildView } from "./model/view";
import { fromSearch, latestYear, raceFor, toSearch, type AppState } from "./state";
import type { Dataset, MunicipalMap } from "./types";
import { renderChart } from "./ui/chart";
import { renderContext } from "./ui/context";
import { renderControls, setupControls } from "./ui/controls";
import { byId } from "./ui/dom";
import { AmericasView, americasFromSearch, americasToSearch } from "./ui/americas-view";
import { ApuracaoView, apuracaoFromSearch, apuracaoToSearch } from "./ui/apuracao-view";
import { CongressView, congressFromSearch, congressToSearch } from "./ui/congress-view";
import { renderLegend } from "./ui/legend";
import { MapView, mapFromSearch, mapToSearch } from "./ui/map-view";
import { renderAccuracy, renderComparison, renderHighlightBar, renderPollTable } from "./ui/tables";

const VIEWS = ["polls", "apuracao", "congress", "map", "americas"] as const;
type View = (typeof VIEWS)[number];

const data = dataset as unknown as Dataset;
const params = new URLSearchParams(window.location.search);
let view: View = VIEWS.find((v) => v === params.get("view")) ?? "polls";
let state: AppState = fromSearch(data, view === "polls" ? window.location.search : "");

// The map data is parsed the first time a tab that draws Brazil opens.
let municipalMap: MunicipalMap | null = null;
let mapView: MapView | null = null;

function loadMunicipalMap(): MunicipalMap {
  municipalMap ??= JSON.parse(mapJson) as MunicipalMap;
  return municipalMap;
}

const stateNames = () => Object.fromEntries(Object.values(data.states).map((st) => [st.uf, st.name]));

function ensureMap(): MapView {
  if (!mapView) {
    const mapData = new MapData(loadMunicipalMap());
    const initial = mapFromSearch(mapData, view === "map" ? params : new URLSearchParams());
    mapView = new MapView(
      mapData,
      initial,
      () => {
        syncUrl();
        mapView!.render(municipalMap!);
      },
      stateNames(),
    );
  }
  return mapView;
}

let apuracaoView: ApuracaoView | null = null;

function ensureApuracao(): ApuracaoView {
  if (!apuracaoView) {
    const initial = apuracaoFromSearch(view === "apuracao" ? params : new URLSearchParams());
    const rounds = data.presidential[latestYear(data)]!.rounds;
    apuracaoView = new ApuracaoView(
      loadMunicipalMap(),
      JSON.parse(apuracaoCidadesJson),
      initial.state,
      initial.source,
      { r1: rounds.r1?.colors, r2: rounds.r2?.colors },
      stateNames(),
      () => {
        syncUrl();
        apuracaoView!.render();
      },
    );
  }
  return apuracaoView;
}

let congressView: CongressView | null = null;
let congressData: CongressData | null = null;

function ensureCongress(): CongressView {
  if (!congressView) {
    congressData = JSON.parse(congressJson) as CongressData;
    const initial = congressFromSearch(congressData, view === "congress" ? params : new URLSearchParams());
    congressView = new CongressView(congressData, initial, () => {
      syncUrl();
      congressView!.render();
    });
  }
  return congressView;
}

let americasView: AmericasView | null = null;

function ensureAmericas(): AmericasView {
  if (!americasView) {
    const americas = JSON.parse(americasJson) as AmericasData;
    const initial = americasFromSearch(americas, view === "americas" ? params : new URLSearchParams());
    americasView = new AmericasView(
      americas,
      JSON.parse(americasTopoJson),
      JSON.parse(indicatorsJson),
      initial,
      () => {
        syncUrl();
        americasView!.render();
      },
    );
  }
  return americasView;
}

function syncUrl(): void {
  let search: string;
  if (view === "map" && mapView) {
    const p = new URLSearchParams({ view: "map" });
    mapToSearch(mapView.current, p);
    search = `?${p.toString()}`;
  } else if (view === "apuracao" && apuracaoView) {
    const p = new URLSearchParams({ view: "apuracao" });
    apuracaoToSearch(apuracaoView.current, apuracaoView.currentSource, p);
    search = `?${p.toString()}`;
  } else if (view === "congress" && congressView) {
    const p = new URLSearchParams({ view: "congress" });
    congressToSearch(congressView.current, congressData!, p);
    search = `?${p.toString()}`;
  } else if (view === "americas" && americasView) {
    const p = new URLSearchParams({ view: "americas" });
    americasToSearch(americasView.current, p);
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
  if (view !== "americas") americasView?.stop();
  if (view !== "apuracao") apuracaoView?.stop();
  if (view !== "congress") congressView?.stop();
  for (const v of VIEWS) {
    byId(`${v}-view`).hidden = v !== view;
    byId(`tab-${v}`).setAttribute("aria-selected", String(v === view));
  }
  const copy = t.views[view];
  // The polls view keeps the page's own title; the others say what is on screen.
  document.title = view === "polls" ? t.pageTitle : `${copy.headline} | Urna`;
  byId("eyebrow").textContent = copy.eyebrow;
  byId("headline").textContent = copy.headline;
  byId("lede").textContent = copy.lede;
  if (view === "map") ensureMap().render(municipalMap!);
  else if (view === "americas") ensureAmericas().render();
  else if (view === "congress") ensureCongress().render();
  else if (view === "apuracao") {
    ensureApuracao().render();
    apuracaoView!.start();
  } else renderPolls();
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
for (const v of VIEWS) byId(`tab-${v}`).addEventListener("click", () => showView(v));
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
