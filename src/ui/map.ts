import { geoMercator, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryObject } from "topojson-specification";

import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import { MARGIN_STEPS, margin, shade, winsByCandidate } from "../model/municipal";
import type { MunicipalMap, MunicipalRace } from "../types";
import { byId } from "./dom";

/** Internal drawing size; the SVG scales to its container through viewBox. */
const WIDTH = 800;
const HEIGHT = 780;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Shapes {
  svg: SVGSVGElement;
  paths: SVGPathElement[];
}

let shapes: Shapes | null = null;
let currentRace: MunicipalRace | null = null;
let hideTooltip = () => {};

/** Projects the 5,570 municipalities once; later renders only change classes. */
function drawShapes(map: MunicipalMap): Shapes {
  const object = map.topology.objects.municipalities;
  const collection = feature(map.topology, object);
  const projection = geoMercator().fitSize([WIDTH, HEIGHT], collection);
  const path = geoPath(projection);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("role", "img");
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "municipalities");
  const paths = collection.features.map((f, i) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", path(f) ?? "");
    p.dataset.i = String(i);
    group.appendChild(p);
    return p;
  });

  // State borders: arcs shared by municipalities of different states.
  const ufOf = new Map<GeometryObject, string>(
    object.geometries.map((g, i) => [g, map.municipalities.uf[i]!]),
  );
  const borders = document.createElementNS(SVG_NS, "path");
  borders.setAttribute("class", "state-borders");
  borders.setAttribute("d", path(mesh(map.topology, object, (a, b) => ufOf.get(a) !== ufOf.get(b))) ?? "");
  svg.append(group, borders);
  return { svg, paths };
}

function tooltipHtml(map: MunicipalMap, race: MunicipalRace, i: number): string {
  const name = `${escapeHtml(map.municipalities.names[i]!)} (${map.municipalities.uf[i]})`;
  if (race.winner[i]! < 0) return `<div class="tt-h">${name}</div><div class="tt-s">${t.mapNoData}</div>`;
  const row = (c: number, share: number) =>
    `<div class="row"><span class="key"><i class="map-key c-${race.colors[race.candidates[c]!]}"></i>${escapeHtml(
      race.candidates[c]!,
    )}</span><b>${percent(share / 10)}</b></div>`;
  return (
    `<div class="tt-h">${name}</div>` +
    `<div class="tt-s">${t.mapVotes(integer(race.votes[i]!))}</div>` +
    row(race.winner[i]!, race.winnerShare[i]!) +
    (race.second[i]! >= 0 ? row(race.second[i]!, race.secondShare[i]!) : "")
  );
}

/** Presidential results by municipality, shaded by margin of victory. */
export function renderMap(map: MunicipalMap, race: MunicipalRace | undefined, title: string): void {
  const panel = byId("map-panel");
  panel.hidden = !race;
  if (!race) return;

  const host = byId("map");
  if (!shapes) {
    shapes = drawShapes(map);
    host.appendChild(shapes.svg);
    attachTooltip(host, map, () => currentRace);
  }
  if (race !== currentRace) hideTooltip(); // its numbers belong to the previous race
  currentRace = race;
  shapes.svg.setAttribute("aria-label", t.mapAria(title));
  shapes.paths.forEach((p, i) => {
    const w = race.winner[i]!;
    p.setAttribute(
      "class",
      w < 0 ? "no-data" : `c-${race.colors[race.candidates[w]!]} s${shade(margin(race, i))}`,
    );
  });

  const wins = winsByCandidate(race);
  byId("map-meta").textContent = wins.map((w) => t.mapWins(w.candidate, integer(w.wins))).join(" · ");
  const steps = MARGIN_STEPS.map((start, i) => {
    const end = MARGIN_STEPS[i + 1];
    return end === undefined ? `${start}+` : `${start}–${end}`;
  });
  byId("map-legend").innerHTML =
    wins
      .map(
        (w) =>
          `<span class="map-scale">${MARGIN_STEPS.map(
            (_, s) => `<i class="map-key c-${race.colors[w.candidate]} s${s}"></i>`,
          ).join("")}${escapeHtml(w.candidate)}</span>`,
      )
      .join("") + `<span class="map-steps">${t.mapMargin(steps.join(" · "))}</span>`;
}

function attachTooltip(host: HTMLElement, map: MunicipalMap, race: () => MunicipalRace | null): void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  host.appendChild(tip);
  let active: SVGPathElement | null = null;

  const clear = () => {
    active?.classList.remove("active");
    active = null;
    tip.hidden = true;
  };
  hideTooltip = clear;
  host.addEventListener("pointerleave", clear);
  host.addEventListener("pointermove", (event) => {
    const target = event.target as Element;
    const r = race();
    if (!(target instanceof SVGPathElement) || target.dataset.i === undefined || !r) {
      clear();
      return;
    }
    if (target !== active) {
      active?.classList.remove("active");
      active = target;
      // Draw the hovered outline on top of its neighbours.
      target.parentNode!.appendChild(target);
      target.classList.add("active");
      tip.innerHTML = tooltipHtml(map, r, Number(target.dataset.i));
    }
    tip.hidden = false;
    const box = host.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const left = x + 14 + tip.offsetWidth > host.clientWidth ? x - tip.offsetWidth - 14 : x + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, Math.min(host.clientHeight - tip.offsetHeight, y - tip.offsetHeight / 2))}px`;
  });
}
