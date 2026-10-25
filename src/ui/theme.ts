import { t } from "../i18n/pt-BR";
import { byId, cssVar } from "./dom";

/**
 * Light, dark or the system's: the choice sets `data-theme` on <html>, which the CSS and
 * the charts already follow. A script in index.html's <head> applies the stored choice
 * before the first paint, so the page does not flash the other theme.
 */
export type ThemeMode = "auto" | "light" | "dark";

export const THEME_KEY = "urna-theme";
const ORDER: ThemeMode[] = ["auto", "light", "dark"];

const ICONS: Record<ThemeMode, string> = {
  auto: `<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/>`,
  light:
    `<circle cx="8" cy="8" r="3"/>` +
    `<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/>`,
  dark: `<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>`,
};

function stored(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function store(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Private window or blocked storage: the choice lasts until the page closes.
  }
}

function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = mode;
  // Browser chrome (mobile address bar) in the page's background color. index.html has one
  // tag per system scheme; a forced theme wins over both.
  const bg = cssVar("--bg");
  if (bg)
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = bg));
}

function paint(el: HTMLButtonElement, mode: ThemeMode): void {
  el.innerHTML =
    `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${ICONS[mode]}</svg>` +
    `<span>${t.theme.mode[mode]}</span>`;
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
  el.setAttribute("aria-label", t.theme.aria(t.theme.mode[mode], t.theme.mode[next]));
  el.title = el.getAttribute("aria-label")!;
}

export function setupTheme(): void {
  const el = byId<HTMLButtonElement>("theme-toggle");
  let mode = stored();
  apply(mode);
  paint(el, mode);
  el.addEventListener("click", () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    store(mode);
    apply(mode);
    paint(el, mode);
  });
  // In automatic mode the system can switch under us; keep the browser chrome in step.
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => apply(mode));
}
