import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import { hasRound, methodOf, raceFor, withRace, type AppState, type MethodFilter } from "../state";
import type { Dataset, Office, RoundId } from "../types";
import { zoomStart } from "../model/view";
import { button, byId } from "./dom";

export type Update = (next: AppState) => void;

const METHOD_ORDER: MethodFilter[] = ["in_person", "phone", "online", "unknown"];

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** Wires the controls that exist in index.html. Called once. */
export function setupControls(data: Dataset, getState: () => AppState, update: Update): void {
  byId("offices")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) =>
      b.addEventListener("click", () =>
        update(withRace(data, getState(), { office: b.dataset.office as Office })),
      ),
    );

  byId("rounds")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) =>
      b.addEventListener("click", () => {
        if (!b.disabled) update(withRace(data, getState(), { round: b.dataset.round as RoundId }));
      }),
    );

  byId("zooms")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) =>
      b.addEventListener("click", () => {
        if (!b.disabled) update({ ...getState(), zoomDays: Number(b.dataset.days) || null });
      }),
    );

  byId("weighs")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) =>
      b.addEventListener("click", () => update({ ...getState(), weighByRecord: Boolean(b.dataset.record) })),
    );

  const years = byId("years");
  for (const year of Object.keys(data.presidential).sort()) {
    const b = button(year, { id: `year-${year}` });
    b.dataset.year = year;
    b.addEventListener("click", () => update(withRace(data, getState(), { year })));
    years.appendChild(b);
  }

  const select = byId<HTMLSelectElement>("uf-select");
  Object.values(data.states)
    .sort((a, b) => a.name.localeCompare(b.name, t.locale))
    .forEach((st) => select.add(new Option(t.state(st.name, st.uf), st.uf)));
  select.addEventListener("change", () => update(withRace(data, getState(), { uf: select.value })));
}

/** Syncs the static controls with the state and rebuilds the filter chips. */
export function renderControls(data: Dataset, s: AppState, update: Update): void {
  const isPresident = s.office === "president";
  byId("offices")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.office === s.office)));
  byId("years")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.year === s.year)));
  byId("year-group").hidden = !isPresident;
  byId("uf-group").hidden = isPresident;
  byId<HTMLSelectElement>("uf-select").value = s.uf;
  byId("rounds")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      const round = b.dataset.round as RoundId;
      b.setAttribute("aria-pressed", String(round === s.round));
      b.disabled = !hasRound(data, s, round);
      b.title = b.disabled ? (s.office === "senate" ? t.noRunoffSenate : t.noRunoffPolls) : "";
    });
  // A period no shorter than the whole race changes nothing: off, and "Tudo" shows as chosen.
  const race = raceFor(data, s);
  const zooms = (days: number | null) => race !== undefined && zoomStart(race, days) !== null;
  const active = zooms(s.zoomDays) ? s.zoomDays : null;
  byId("zooms")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      const days = Number(b.dataset.days) || null;
      b.disabled = days !== null && !zooms(days);
      b.setAttribute("aria-pressed", String(days === active));
    });
  byId("weighs")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(Boolean(b.dataset.record) === s.weighByRecord)));
  renderMethodChips(data, s, update);
  renderPollsterChips(data, s, update);
  // A folded option that is on (a link with pollsters left out, say) shows itself.
  if (s.excludedPollsters.size || s.excludedMethods.size || s.weighByRecord) {
    const controls = byId("weighs").closest(".controls")!;
    controls.classList.add("open");
    const toggle = controls.querySelector(".more-toggle");
    toggle?.setAttribute("aria-expanded", "true");
    if (toggle) toggle.textContent = "Menos opções";
  }
}

const racePolls = (data: Dataset, s: AppState) => raceFor(data, s)?.polls ?? [];

function renderMethodChips(data: Dataset, s: AppState, update: Update): void {
  const el = byId("methods");
  el.innerHTML = "";
  const counts = countBy(racePolls(data, s), (p) => methodOf(data, p.p));
  for (const m of METHOD_ORDER.filter((m) => counts.has(m))) {
    const b = button(`${t.method[m]} <span class="n">${counts.get(m)}</span>`, {
      id: `method-${m}`,
      className: "chip",
      pressed: !s.excludedMethods.has(m),
    });
    b.addEventListener("click", () => {
      const excluded = new Set(s.excludedMethods);
      const active = [...counts.keys()].filter((k) => !excluded.has(k as MethodFilter));
      if (excluded.has(m)) excluded.delete(m);
      else if (active.length > 1) excluded.add(m); // never filter everything out
      update({ ...s, excludedMethods: excluded });
    });
    el.appendChild(b);
  }
}

function renderPollsterChips(data: Dataset, s: AppState, update: Update): void {
  const el = byId("chips");
  el.innerHTML = "";
  const counts = [...countBy(racePolls(data, s), (p) => p.p)].sort((a, b) => b[1] - a[1]);
  for (const [name, n] of counts) {
    const method = methodOf(data, name);
    const methodOff = s.excludedMethods.has(method);
    const b = button(`${escapeHtml(name)} <span class="n">${n}</span>`, {
      id: `chip-${name.replace(/\W+/g, "-")}`,
      className: "chip",
      pressed: !s.excludedPollsters.has(name) && !methodOff,
    });
    b.disabled = methodOff;
    b.title = t.method[method];
    b.addEventListener("click", () => {
      const excluded = new Set(s.excludedPollsters);
      if (excluded.has(name)) excluded.delete(name);
      else if (excluded.size < counts.length - 1) excluded.add(name);
      update({ ...s, excludedPollsters: excluded });
    });
    el.appendChild(b);
  }
  if (s.excludedPollsters.size) {
    const reset = button(t.showAll, { id: "chip-reset", className: "chip reset" });
    reset.addEventListener("click", () => update({ ...s, excludedPollsters: new Set() }));
    el.appendChild(reset);
  }
}
