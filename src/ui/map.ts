import { geoMercator, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryObject } from "topojson-specification";

import type { MunicipalMap } from "../types";

/** Internal drawing size; the SVG scales to its container through viewBox. */
const WIDTH = 800;
const HEIGHT = 780;
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The 5,570 municipalities, projected once. Switching elections only changes
 * each path's class, so stepping through the timeline stays fast.
 */
export class MunicipalityMap {
  private readonly svg: SVGSVGElement;
  private readonly paths: SVGPathElement[];
  private readonly tip: HTMLDivElement;
  private active: SVGPathElement | null = null;
  private tooltipFor: (i: number) => string = () => "";

  constructor(
    private readonly host: HTMLElement,
    map: MunicipalMap,
  ) {
    const object = map.topology.objects.municipalities;
    const collection = feature(map.topology, object);
    const path = geoPath(geoMercator().fitSize([WIDTH, HEIGHT], collection));

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    this.svg.setAttribute("role", "img");
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "municipalities");
    this.paths = collection.features.map((f, i) => {
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
    this.svg.append(group, borders);

    this.tip = document.createElement("div");
    this.tip.className = "tooltip";
    this.tip.hidden = true;
    host.append(this.svg, this.tip);
    host.addEventListener("pointerleave", () => this.hideTooltip());
    host.addEventListener("pointermove", (e) => this.onPointer(e));
  }

  /** Sets every municipality's class and the text shown on hover. */
  paint(label: string, classFor: (i: number) => string, tooltipFor: (i: number) => string): void {
    this.svg.setAttribute("aria-label", label);
    this.paths.forEach((p, i) => p.setAttribute("class", classFor(i)));
    this.tooltipFor = tooltipFor;
    this.hideTooltip(); // its numbers belong to the previous election
  }

  hideTooltip(): void {
    this.active?.classList.remove("active");
    this.active = null;
    this.tip.hidden = true;
  }

  private onPointer(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof SVGPathElement) || target.dataset.i === undefined) {
      this.hideTooltip();
      return;
    }
    if (target !== this.active) {
      this.active?.classList.remove("active");
      this.active = target;
      target.parentNode!.appendChild(target); // outline drawn above its neighbours
      target.classList.add("active");
      this.tip.innerHTML = this.tooltipFor(Number(target.dataset.i));
    }
    this.tip.hidden = false;
    const box = this.host.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const { offsetWidth: tw, offsetHeight: th } = this.tip;
    const left = x + 14 + tw > this.host.clientWidth ? x - tw - 14 : x + 14;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${Math.max(0, Math.min(this.host.clientHeight - th, y - th / 2))}px`;
  }
}
