import type { ColorName, Race } from "../types";

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

export function button(label: string, attrs: { id?: string; className?: string; pressed?: boolean } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = label;
  if (attrs.id) b.id = attrs.id;
  if (attrs.className) b.className = attrs.className;
  if (attrs.pressed !== undefined) b.setAttribute("aria-pressed", String(attrs.pressed));
  return b;
}

export const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Resolved color of a series; read at render time so it follows the theme. */
export const colorOf = (race: Race, series: string) =>
  cssVar(`--c-${race.colors[series] ?? ("gray" satisfies ColorName)}`);
