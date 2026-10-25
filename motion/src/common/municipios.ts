/**
 * The 5,570 municipalities on a canvas: the site's topology (data/generated/map.json),
 * projected once per box size into Path2D objects, with state borders as one more path.
 * Shared by the "Mapa" and "Apuracao" motions.
 */
import { geoMercator, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryObject } from "topojson-specification";
import mapJson from "../../../data/generated/map.json";
import type { MunicipalMap } from "../../../src/types";

export const MAP = mapJson as unknown as MunicipalMap;
export const COUNT = MAP.municipalities.names.length;

export interface Geo {
  paths: Path2D[];
  borders: Path2D;
  /** Every municipality's centre, in box pixels, and normalised 0..1 across the box. */
  cx: Float32Array;
  cy: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
}

const cache = new Map<string, Geo>();

/** The map fitted into a box of w × h pixels (built in the browser, on first use). */
export function geo(w: number, h: number): Geo {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const topo = MAP.topology;
  const obj = topo.objects.municipalities;
  const fc = feature(topo, obj);
  const projection = geoMercator().fitSize([w, h], fc);
  const path = geoPath(projection);
  const paths: Path2D[] = [];
  const cx = new Float32Array(COUNT);
  const cy = new Float32Array(COUNT);
  fc.features.forEach((f, i) => {
    paths.push(new Path2D(path(f) ?? ""));
    const [x, y] = path.centroid(f);
    cx[i] = Number.isFinite(x) ? x : w / 2;
    cy[i] = Number.isFinite(y) ? y : h / 2;
  });
  const index = new Map<GeometryObject, number>(obj.geometries.map((g, i) => [g, i]));
  const uf = MAP.municipalities.uf;
  const ufOf = (g: GeometryObject) => uf[index.get(g) ?? -1];
  const borders = new Path2D(path(mesh(topo, obj, (a, b) => a !== b && ufOf(a) !== ufOf(b))) ?? "");
  const norm = (a: Float32Array) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of a) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return a.map((v) => (v - lo) / (hi - lo || 1));
  };
  const g: Geo = { paths, borders, cx, cy, nx: norm(cx), ny: norm(cy) };
  cache.set(key, g);
  return g;
}

/**
 * Paints every municipality with fill(i) (a CSS color, or null to skip) and the state
 * borders on top. The canvas is sized in device pixels equal to CSS pixels: Remotion
 * renders at the composition's own resolution.
 */
export function paint(
  canvas: HTMLCanvasElement,
  g: Geo,
  fill: (i: number) => string | null,
  border: { color: string; width: number },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < g.paths.length; i++) {
    const c = fill(i);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fill(g.paths[i]!);
    // A hairline of the same color closes the seams antialiasing leaves between neighbours.
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.35;
    ctx.stroke(g.paths[i]!);
  }
  ctx.strokeStyle = border.color;
  ctx.lineWidth = border.width;
  ctx.lineJoin = "round";
  ctx.stroke(g.borders);
}

/** Base64 typed arrays of the site's data files. */
export function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
