import "./styles.css";

import dataset from "../data/generated/elections.json";
import { load, peek } from "./data";
import { formatDate, formatIsoDate, dayToDate } from "./format";
import { t } from "./i18n/pt-BR";
import type { AmericasData } from "./model/americas";
import type { CongressData } from "./model/congress";
import type { GovernismoData } from "./model/governismo";
import type { IdeologyData } from "./model/ideology";
import {
  decodeCensusVote,
  decodeElection,
  type CensusVote,
  type EncodedCensusVote,
  type EncodedElection,
} from "./model/census-vote";
import type { Capital, CapitalsData } from "./model/capitals";
import type { MandateData } from "./model/mandate";
import type { ProfilesData } from "./model/profiles";
import type { ProgramsData } from "./model/programs";
import type { WatchData } from "./model/watch";
import { MapData } from "./model/map-data";
import { buildView, finalAverage, partyKey, type FinalAverage } from "./model/view";
import { defaultState, fromSearch, latestYear, raceFor, toSearch, type AppState } from "./state";
import type { Dataset, EncodedMapRace, MunicipalMap, Race, RoundId } from "./types";
import { renderChart } from "./ui/chart";
import { renderContext } from "./ui/context";
import { renderControls, setupControls } from "./ui/controls";
import { byId, colorOf } from "./ui/dom";
import { AmericasView, americasFromSearch, americasToSearch } from "./ui/americas-view";
import { ApuracaoView, apuracaoFromSearch, apuracaoToSearch, defaultRound } from "./ui/apuracao-view";
import { CongressView, congressFromSearch, congressToSearch } from "./ui/congress-view";
import { CensusView, censusFromSearch, censusToSearch } from "./ui/census-view";
import { PeopleView, peopleFromSearch, peopleToSearch } from "./ui/people-view";
import { ProgramsView } from "./ui/programs-view";
import { renderLegend } from "./ui/legend";
import { setupShare } from "./ui/share";
import { setupTheme } from "./ui/theme";
import { MapView, mapFromSearch, mapToSearch } from "./ui/map-view";
import { WatchView, watchFromSearch, watchToSearch } from "./ui/watch-view";
import { WhereView, fromCensusLink, whereFromSearch, whereToSearch } from "./ui/where-view";
import {
  renderAccuracy,
  renderComparison,
  renderErrorScenarios,
  renderHighlightBar,
  renderPollTable,
} from "./ui/tables";

const VIEWS = [
  "home",
  "polls",
  "programs",
  "apuracao",
  "congress",
  "people",
  "watch",
  "map",
  "census",
  "where",
  "americas",
] as const;
type View = (typeof VIEWS)[number];

const data = dataset as unknown as Dataset;
let params = new URLSearchParams(window.location.search);
// "Quem mora onde" lived in the Voto e Censo tab: its old links open its own tab now.
if (params.get("view") === "census") {
  const moved = fromCensusLink(params);
  if (moved) {
    params = moved;
    window.history.replaceState(null, "", `?${moved.toString()}`);
  }
}
// No view in the address: the home page, unless the address carries the polls' options
// (links made before the home page existed, like ?office=governor&uf=SP).
const POLL_KEYS = ["office", "year", "round", "uf", "exclude"];
let view: View =
  VIEWS.find((v) => v === params.get("view")) ?? (POLL_KEYS.some((k) => params.has(k)) ? "polls" : "home");
let state: AppState = fromSearch(data, view === "polls" ? window.location.search : "");

// Each tab downloads its data the first time it opens (src/data.ts); the polls ship with
// the page. Views are built once, when their data arrives.
let municipalMap: MunicipalMap | null = null;
let mapView: MapView | null = null;

async function loadMunicipalMap(): Promise<MunicipalMap> {
  municipalMap ??= await load<MunicipalMap>("map");
  return municipalMap;
}

const stateNames = () => Object.fromEntries(Object.values(data.states).map((st) => [st.uf, st.name]));

/** One promise per view, so a second click waits on the first download. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= make().catch((e) => {
      p = null; // let the next click try again
      throw e;
    });
    return p;
  };
}

const ensureMap = once(async () => {
  const map = await loadMunicipalMap();
  const mapData = new MapData(map, (key) => load<EncodedMapRace>(`map-race/${key}`));
  const initial = mapFromSearch(mapData, view === "map" ? params : new URLSearchParams());
  mapView = new MapView(
    mapData,
    initial,
    () => {
      syncUrl();
      mapView!.render(map);
    },
    stateNames(),
  );
  return mapView;
});

let apuracaoView: ApuracaoView | null = null;

/** What the polls' final average said for a race of the count tab: president, or a state's
 * governor; every poll counts (the polls tab's filters do not apply here). */
const pollAverageFor = (office: string, round: RoundId, uf: string | null): FinalAverage | null => {
  const base = defaultState(data);
  if (office === "presidente") {
    const race = data.presidential[base.year]?.rounds[round];
    return race ? finalAverage(data, race, { ...base, round }) : null;
  }
  if (office === "governador" && uf) {
    const race = data.states[uf]?.governor[round];
    return race ? finalAverage(data, race, { ...base, office: "governor", round, uf }) : null;
  }
  return null;
};

const ensureApuracao = once(async () => {
  const [map, cities] = await Promise.all([
    loadMunicipalMap(),
    load<ConstructorParameters<typeof ApuracaoView>[1]>("apuracao-cidades"),
  ]);
  const rounds = data.presidential[latestYear(data)]!.rounds;
  const initial = apuracaoFromSearch(
    view === "apuracao" ? params : new URLSearchParams(),
    rounds.r2 ? defaultRound(rounds.r1?.date) : "r1",
  );
  apuracaoView = new ApuracaoView(
    map,
    cities,
    initial.state,
    initial.source,
    { r1: rounds.r1?.colors, r2: rounds.r2?.colors },
    stateNames(),
    () => {
      syncUrl();
      apuracaoView!.render();
    },
    pollAverageFor,
  );
  return apuracaoView;
});

let congressView: CongressView | null = null;
let congressData: CongressData | null = null;

const ensureCongress = once(async () => {
  const [congress, governismo, ideology] = await Promise.all([
    load<CongressData>("congress"),
    load<GovernismoData>("governismo"),
    load<IdeologyData>("ideology"),
  ]);
  congressData = congress;
  const initial = congressFromSearch(congress, view === "congress" ? params : new URLSearchParams());
  congressView = new CongressView(congress, governismo, ideology, initial, () => {
    syncUrl();
    congressView!.render();
  });
  return congressView;
});

let peopleView: PeopleView | null = null;

const ensurePeople = once(async () => {
  const profiles = await load<ProfilesData>("profiles");
  const initial = peopleFromSearch(profiles, view === "people" ? params : new URLSearchParams());
  peopleView = new PeopleView(
    profiles,
    initial,
    () => {
      syncUrl();
      peopleView!.render();
    },
    (uf) => load(`profiles-news/${uf}`),
    () =>
      Promise.all([load<MandateData>("mandate"), load<IdeologyData>("ideology")]).then(([m, ideology]) => ({
        ...m,
        ideology,
      })),
  );
  return peopleView;
});

let programsView: ProgramsView | null = null;

const ensurePrograms = once(async () => {
  const programs = await load<ProgramsData>("programs");
  // Each candidate in the color the polls chart gives them, matched by party.
  const race =
    data.presidential[latestYear(data)]!.rounds.r2 ?? data.presidential[latestYear(data)]!.rounds.r1!;
  const byParty = Object.fromEntries(
    Object.entries(race.parties).map(([series, party]) => [partyKey(party), colorOf(race, series)]),
  );
  const colors = Object.fromEntries(programs.candidates.map((c) => [c.id, byParty[partyKey(c.party)] ?? ""]));
  programsView = new ProgramsView(programs, colors);
  return programsView;
});

let watchView: WatchView | null = null;

const ensureWatch = once(async () => {
  const watch = await load<WatchData>("watch");
  watchView = new WatchView(
    watch,
    watchFromSearch(watch, view === "watch" ? params : new URLSearchParams()),
    () => {
      syncUrl();
      watchView!.render();
    },
  );
  return watchView;
});

let censusView: CensusView | null = null;
let censusData: CensusVote | null = null;
let capitalsData: CapitalsData | null = null;

const ensureCensus = once(async () => {
  const [map, encoded, capitals] = await Promise.all([
    loadMunicipalMap(),
    load<EncodedCensusVote>("census-vote"),
    load<CapitalsData>("capitals"),
  ]);
  censusData = decodeCensusVote(encoded);
  capitalsData = capitals;
  const initial = censusFromSearch(censusData, capitals, view === "census" ? params : new URLSearchParams());
  const capital = capitalLoader(capitals);
  censusView = new CensusView(
    censusData,
    map,
    capitals,
    capital,
    initial,
    () => {
      syncUrl();
      censusView!.render();
    },
    () => load<EncodedElection[]>("census-runoffs").then((rs) => rs.map(decodeElection)),
  );
  return censusView;
});

/** A capital's areas come apart from the list (each in its own file); joined back here. */
function capitalLoader(capitals: CapitalsData) {
  const meta = (code: string) => capitals.capitals.find((c) => c.code === code)!;
  return {
    load: (code: string) => load<Capital>(`capital/${code}`).then((c) => ({ ...meta(code), ...c })),
    peek: (code: string) => {
      const c = peek<Capital>(`capital/${code}`);
      return c && { ...meta(code), ...c };
    },
  };
}

let whereView: WhereView | null = null;

const ensureWhere = once(async () => {
  const capitals = await load<CapitalsData>("capitals");
  const capital = capitalLoader(capitals);
  const initial = whereFromSearch(capitals, view === "where" ? params : new URLSearchParams());
  whereView = new WhereView(capitals, capital.load, capital.peek, initial, () => {
    syncUrl();
    whereView!.render();
  });
  return whereView;
});

let americasView: AmericasView | null = null;

const ensureAmericas = once(async () => {
  const [americas, topo, indicators] = await Promise.all([
    load<AmericasData>("americas"),
    load<ConstructorParameters<typeof AmericasView>[1]>("americas-topo"),
    load<ConstructorParameters<typeof AmericasView>[2]>("americas-indicators"),
  ]);
  const initial = americasFromSearch(americas, view === "americas" ? params : new URLSearchParams());
  americasView = new AmericasView(americas, topo, indicators, initial, () => {
    syncUrl();
    americasView!.render();
  });
  return americasView;
});

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
  } else if (view === "people" && peopleView) {
    const p = new URLSearchParams({ view: "people" });
    peopleToSearch(peopleView.current, p);
    search = `?${p.toString()}`;
  } else if (view === "watch" && watchView) {
    const p = new URLSearchParams({ view: "watch" });
    watchToSearch(watchView.current, p);
    search = `?${p.toString()}`;
  } else if (view === "census" && censusView) {
    const p = new URLSearchParams({ view: "census" });
    censusToSearch(censusView.current, censusData!, capitalsData!, p);
    search = `?${p.toString()}`;
  } else if (view === "where" && whereView) {
    const p = new URLSearchParams({ view: "where" });
    whereToSearch(whereView.current, p);
    search = `?${p.toString()}`;
  } else if (view === "americas" && americasView) {
    const p = new URLSearchParams({ view: "americas" });
    americasToSearch(americasView.current, p);
    search = `?${p.toString()}`;
  } else if (view === "home") {
    search = "";
  } else if (view !== "polls") {
    // The tab's data is still on its way: keep a link that opens it, and its options if it
    // was opened from one.
    search = params.get("view") === view ? window.location.search : `?view=${view}`;
  } else {
    search = toSearch(data, state) || "?view=polls";
  }
  window.history.replaceState(null, "", search || window.location.pathname);
  // The ready-made question on screen, if the reader is on one.
  const here = new URLSearchParams(search);
  here.sort();
  document.querySelectorAll<HTMLAnchorElement>(".quick a").forEach((a) => {
    const q = new URLSearchParams(a.search);
    q.sort();
    if (q.toString() === here.toString()) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function update(next: AppState): void {
  state = next;
  syncUrl();
  renderPolls();
}

/** The section a tab belongs to (its data-section in index.html). */
const sectionOf = (v: View): string => byId(`tab-${v}`).dataset.section!;
/** The tab last opened in each section: the section's button opens it again. */
const lastInSection = new Map<string, View>();

function showView(next: View): void {
  view = next;
  if (view !== "map") mapView?.stop();
  if (view !== "americas") americasView?.stop();
  if (view !== "apuracao") apuracaoView?.stop();
  if (view !== "congress") congressView?.stop();
  if (view !== "census") censusView?.stop();
  // Two levels: the section on top, and below it only that section's tabs.
  const section = sectionOf(view);
  lastInSection.set(section, view);
  document
    .querySelectorAll<HTMLButtonElement>(".section")
    .forEach((b) => b.setAttribute("aria-current", String(b.dataset.section === section)));
  byId("tabs").hidden = section === "home";
  for (const v of VIEWS) {
    byId(`${v}-view`).hidden = v !== view;
    const tab = byId(`tab-${v}`);
    tab.setAttribute("aria-selected", String(v === view));
    tab.hidden = v === "home" || tab.dataset.section !== section;
  }
  const copy = t.views[view];
  // The polls view keeps the page's own title; the others say what is on screen.
  document.title = view === "home" ? t.pageTitle : `${copy.headline} | Urna`;
  byId("eyebrow").textContent = copy.eyebrow;
  byId("headline").textContent = copy.headline;
  byId("lede").textContent = copy.lede;
  if (view === "map") open("map", ensureMap, (v) => v.render(municipalMap!));
  else if (view === "americas") open("americas", ensureAmericas, (v) => v.render());
  else if (view === "congress") open("congress", ensureCongress, (v) => v.render());
  else if (view === "census") open("census", ensureCensus, (v) => v.render());
  else if (view === "where") open("where", ensureWhere, (v) => v.render());
  else if (view === "people")
    open("people", ensurePeople, (v) => {
      v.render();
      reveal("pp-profile");
    });
  else if (view === "programs") open("programs", ensurePrograms, (v) => v.render());
  else if (view === "watch")
    open("watch", ensureWatch, (v) => {
      v.render();
      reveal("wt-person");
    });
  else if (view === "apuracao")
    open("apuracao", ensureApuracao, (v) => {
      v.render();
      v.start();
    });
  else {
    byId("view-status").hidden = true;
    if (view === "polls") renderPolls();
  }
  syncUrl();
}

let revealed = false;

/** A link that opens one person (?p=, ?id=): bring their card into sight, once. */
function reveal(id: string): void {
  if (revealed || !(params.has("p") || params.has("id"))) return;
  revealed = true;
  const card = byId(id);
  if (!card.hidden) card.scrollIntoView?.({ block: "start" });
}

/** Draws a tab once its data is here, unless the reader has moved on meanwhile. */
function open<V>(name: View, ensure: () => Promise<V>, render: (v: V) => void): void {
  const status = byId("view-status");
  status.textContent = t.loading;
  status.hidden = false;
  ensure().then(
    (v) => {
      if (view !== name) return;
      status.hidden = true;
      render(v);
      syncUrl();
    },
    () => {
      if (view === name) status.textContent = t.loadFailed;
    },
  );
}

function chartTitle(s: AppState, date: string): string {
  if (s.office === "president") return t.chartTitlePresident(s.year, t.round[s.round], date);
  const round = s.office === "senate" ? null : t.round[s.round];
  return t.chartTitleState(t.office[s.office], data.states[s.uf]!.name, round, date);
}

/** On a runoff: the 1st round's day and what the two finalists got, for the chart. */
function firstRoundOf(race: Race): { day: number; result: Record<string, number> } | null {
  if (state.round !== "r2") return null;
  const first = raceFor(data, { ...state, round: "r1" });
  if (!first?.result) return null;
  const result = Object.fromEntries(
    race.series.filter((c) => first.result![c] != null).map((c) => [c, first.result![c]!]),
  );
  return Object.keys(result).length ? { day: first.electionDay, result } : null;
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
    firstRound: firstRoundOf(race),
  });
  renderComparison(pollsView, year);
  renderErrorScenarios(data, pollsView, state);
  renderAccuracy(data, pollsView, state, year, update);
  renderPollTable(pollsView, year);
  renderContext(data, race, state);
}

setupControls(data, () => state, update);
setupShare();
setupTheme();
for (const v of VIEWS) byId(`tab-${v}`).addEventListener("click", () => showView(v));
document.querySelectorAll<HTMLButtonElement>(".section").forEach((b) =>
  b.addEventListener("click", () => {
    const section = b.dataset.section!;
    // Else the section's first tab, in the menu's order.
    const first = document.querySelector<HTMLElement>(`#tabs [data-section="${section}"]`)!.dataset.view;
    showView(lastInSection.get(section) ?? (first as View));
  }),
);

/** Whether a tab was already built (its state then lives in it, not in the address). */
const built = (v: View): boolean =>
  ({
    home: false,
    polls: false,
    // The quiz has no options in the address: opening it again keeps the answers.
    programs: false,
    apuracao: !!apuracaoView,
    congress: !!congressView,
    people: !!peopleView,
    watch: !!watchView,
    map: !!mapView,
    census: !!censusView,
    where: !!whereView,
    americas: !!americasView,
  })[v];

// Shortcuts (the home page's cards, the links between tabs): open the tab with the link's
// options in place. A tab built before reads its options once, so it reloads instead.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-go]");
  if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const next = new URL(a.href, window.location.href).searchParams;
  const target = VIEWS.find((v) => v === next.get("view")) ?? "polls";
  if (built(target)) return;
  e.preventDefault();
  for (const k of [...params.keys()]) params.delete(k);
  next.forEach((value, key) => params.set(key, value));
  if (target === "polls") state = fromSearch(data, a.search);
  window.history.pushState(null, "", a.search);
  showView(target);
  window.scrollTo(0, 0);
});
// The secondary options stay folded until asked for.
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".more-toggle");
  if (!b) return;
  const open = b.closest(".controls")!.classList.toggle("open");
  b.setAttribute("aria-expanded", String(open));
  b.textContent = open ? "Menos opções" : "Mais opções";
});
// Back from a shortcut: the page as that address opens it.
window.addEventListener("popstate", () => window.location.reload());
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
