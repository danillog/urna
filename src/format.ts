import { timeFormat } from "d3-time-format";

import { t } from "./i18n/pt-BR";

export const formatDate = timeFormat("%d/%m/%Y");
export const formatDayMonth = timeFormat("%d/%m");

/** Day index (days since January 1st) to a local Date. */
export const dayToDate = (year: number, day: number) => new Date(year, 0, 1 + day);

/** "2026-10-04" → "04/10/2026" without going through time zones. */
export const formatIsoDate = (iso: string) => iso.split("-").reverse().join("/");

const decimal = (v: number) => v.toFixed(1).replace(".", ",");

export const percent = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : `${decimal(v)}%`;
export const points = (v: number) => `${decimal(v)} p.p.`;
export const signedPoints = (v: number) => `${v > 0 ? "+" : ""}${points(v)}`;
export const integer = (v: number) => v.toLocaleString(t.locale);

/** "Eduardo Paes" → "E. Paes" when space is tight. */
export function shortName(name: string, narrow: boolean): string {
  if (!narrow || name.length <= 11) return name;
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first![0]}. ${rest.join(" ")}` : name;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Data comes from our own files, but names are still escaped before reaching innerHTML. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
