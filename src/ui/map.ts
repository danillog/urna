import { geoPath, type GeoProjection } from "d3-geo";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";

const SVG_NS = "http://www.w3.org/2000/svg";
const ZOOM_STEP = 2;
const ZOOM_MS = 600;
/** Share of the map a group (state, country) fills when it is selected. */
const GROUP_FILL = 0.9;

type Bounds = [[number, number], [number, number]];

/** Animate camera moves unless the user asked for less motion (or nobody can see them). */
const animated = () => !document.hidden && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Zoom per wheel event. d3's default multiplies ctrl+wheel by 10 for trackpad
 * pinches, which makes a single mouse-wheel notch jump straight to max zoom;
 * keep that boost only for the small deltas pinches produce.
 */
function wheelDelta(event: WheelEvent): number {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
  const pinch = event.ctrlKey && Math.abs(event.deltaY) < 50 ? 10 : 1;
  return -event.deltaY * unit * pinch;
}

/** What to draw: areas (municipalities, provinces) and the group each belongs to. */
export interface MapGeometry {
  topology: Topology;
  object: GeometryCollection;
  /** Per area, in geometry order: its state or country. Borders are drawn between groups. */
  groups: string[];
  /** Unfitted projection; it is fitted to the drawing size. */
  projection: GeoProjection;
  /** Internal drawing size; the SVG scales to its container through viewBox. */
  width: number;
  height: number;
  maxZoom: number;
}

/**
 * A choropleth of many small areas, projected once. Switching elections only
 * changes each path's class, so stepping through a timeline stays fast.
 *
 * Zoom: buttons, double click, pinch, and ctrl/⌘ + wheel (a bare wheel keeps
 * scrolling the page). Dragging pans once zoomed in.
 *
 * Keeping it fast: restyling thousands of SVG paths is what costs, not the
 * JavaScript. Switching elections only touches paths whose class changed, and
 * highlighting a party never restyles the base map: a veil covers it and copies
 * of the highlighted municipalities are drawn on top.
 */
export class ChoroplethMap {
  private readonly svg: SVGSVGElement;
  private readonly paths: SVGPathElement[];
  /** Class currently set on each path, to skip writes that would change nothing. */
  private readonly classes: string[] = [];
  private readonly focusLayer: SVGGElement;
  private readonly tip: HTMLDivElement;
  private readonly behavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly groupBounds = new Map<string, Bounds>();
  private readonly width: number;
  private readonly height: number;
  private active: SVGPathElement | null = null;
  private tooltipFor: (i: number) => string = () => "";
  private scale = 1;

  constructor(
    private readonly host: HTMLElement,
    geometry: MapGeometry,
    private readonly onWheelWithoutModifier: () => void = () => {},
  ) {
    const { topology, object, groups } = geometry;
    const [WIDTH, HEIGHT] = [geometry.width, geometry.height];
    this.width = WIDTH;
    this.height = HEIGHT;
    const collection = feature(topology, object);
    const path = geoPath(geometry.projection.fitSize([WIDTH, HEIGHT], collection));

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    this.svg.setAttribute("role", "img");
    const viewport = document.createElementNS(SVG_NS, "g");
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "areas");
    this.paths = collection.features.map((f, i) => {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", path(f) ?? "");
      p.dataset.i = String(i);
      group.appendChild(p);
      this.extendGroupBounds(groups[i]!, path.bounds(f));
      return p;
    });

    // Group borders: arcs shared by areas of different groups (states, countries).
    const groupOf = new Map<GeometryObject, string>(object.geometries.map((g, i) => [g, groups[i]!]));
    const borders = document.createElementNS(SVG_NS, "path");
    borders.setAttribute("class", "group-borders");
    borders.setAttribute(
      "d",
      path(mesh(topology, object, (a, b) => groupOf.get(a) !== groupOf.get(b))) ?? "",
    );
    // Highlight layer: a veil over the map, then copies of the highlighted municipalities.
    this.focusLayer = document.createElementNS(SVG_NS, "g");
    this.focusLayer.setAttribute("class", "focus-layer");
    viewport.append(group, this.focusLayer, borders);
    this.svg.appendChild(viewport);

    this.behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, geometry.maxZoom])
      .wheelDelta(wheelDelta)
      .extent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .filter((event: Event) => {
        if (event instanceof WheelEvent) return event.ctrlKey || event.metaKey;
        if (event.type === "dblclick") return true;
        if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent)
          return event.touches.length > 1 || this.scale > 1;
        // Mouse drag pans only once zoomed in, so a plain click stays a click.
        return !(event as MouseEvent).button && this.scale > 1;
      })
      .on("start", () => this.hideTooltip())
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        viewport.setAttribute("transform", event.transform.toString());
        this.scale = event.transform.k;
        this.host.classList.toggle("zoomed", this.scale > 1);
        // Zoomed out, one finger scrolls the page; zoomed in, it pans the map.
        this.svg.style.touchAction = this.scale > 1 ? "none" : "pan-x pan-y";
      });
    select(this.svg).call(this.behavior);
    this.svg.style.touchAction = "pan-x pan-y";
    this.svg.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) this.onWheelWithoutModifier();
    });

    this.tip = document.createElement("div");
    this.tip.className = "tooltip";
    this.tip.hidden = true;
    host.append(this.svg, this.tip);
    host.addEventListener("pointerleave", () => this.hideTooltip());
    host.addEventListener("pointermove", (e) => this.onPointer(e));
  }

  private extendGroupBounds(group: string, [[x0, y0], [x1, y1]]: Bounds): void {
    const b = this.groupBounds.get(group);
    this.groupBounds.set(
      group,
      b
        ? [
            [Math.min(b[0][0], x0), Math.min(b[0][1], y0)],
            [Math.max(b[1][0], x1), Math.max(b[1][1], y1)],
          ]
        : [
            [x0, y0],
            [x1, y1],
          ],
    );
  }

  /** Sets every municipality's class and the text shown on hover. */
  paint(label: string, classFor: (i: number) => string, tooltipFor: (i: number) => string): void {
    this.hideTooltip(); // its numbers belong to the previous election
    this.svg.setAttribute("aria-label", label);
    this.paths.forEach((p, i) => {
      const c = classFor(i);
      if (this.classes[i] !== c) {
        p.setAttribute("class", c);
        this.classes[i] = c;
      }
    });
    this.tooltipFor = tooltipFor;
  }

  /** Brings these municipalities forward and fades the rest; null clears it. */
  highlight(indices: number[] | null): void {
    this.hideTooltip();
    this.focusLayer.replaceChildren();
    this.host.classList.toggle("focusing", indices !== null);
    if (!indices) return;
    const veil = document.createElementNS(SVG_NS, "rect");
    veil.setAttribute("class", "veil");
    veil.setAttribute("width", String(this.width));
    veil.setAttribute("height", String(this.height));
    this.focusLayer.append(veil, ...indices.map((i) => this.paths[i]!.cloneNode() as SVGPathElement));
  }

  zoomBy(factor: number): void {
    const target = select(this.svg);
    if (animated()) target.transition().duration(ZOOM_MS).call(this.behavior.scaleBy, factor);
    else target.call(this.behavior.scaleBy, factor);
  }

  zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / ZOOM_STEP);
  }

  /** Frames a group (state, country), or everything when `group` is null. */
  fit(group: string | null, animate = true): void {
    const b = group ? this.groupBounds.get(group) : undefined;
    let transform = zoomIdentity;
    if (b) {
      const [[x0, y0], [x1, y1]] = b;
      const maxZoom = this.behavior.scaleExtent()[1];
      const k = Math.min(maxZoom, GROUP_FILL / Math.max((x1 - x0) / this.width, (y1 - y0) / this.height));
      transform = zoomIdentity
        .translate(this.width / 2, this.height / 2)
        .scale(k)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    }
    const target = select(this.svg);
    if (animate && animated()) target.transition().duration(ZOOM_MS).call(this.behavior.transform, transform);
    else target.call(this.behavior.transform, transform);
  }

  hideTooltip(): void {
    this.active?.classList.remove("active");
    this.active = null;
    this.tip.hidden = true;
  }

  private onPointer(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof SVGPathElement) || target.dataset.i === undefined || event.buttons) {
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
