import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import { history, type CongressData, type CongressParty, type House } from "../model/congress";
import { pattern, stances, type GovernismoData, type GovHouse } from "../model/governismo";
import { sourcesHtml } from "./sources";

const groupClass = (p: CongressParty) => `g-${p.group ?? "none"}`;

/** "PFL (1990–2006) → DEM (2010–2018)": the acronyms a party line ran under, in order. */
export function namesOverTime(
  data: CongressData,
  lineage: string,
): { name: string; from: number; to: number }[] {
  const years = new Map<number, string>();
  for (const house of ["chamber", "senate"] as House[])
    data.houses[house].forEach((e) => {
      const p = e.parties.find((x) => x.lineage === lineage);
      if (p && !years.has(e.year)) years.set(e.year, p.party);
    });
  const out: { name: string; from: number; to: number }[] = [];
  for (const [year, name] of [...years].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && last.name === name) last.to = year;
    else out.push({ name, from: year, to: year });
  }
  return out;
}

/** Seats per election in one house, as bars. */
function seatsChart(data: CongressData, house: House, lineage: string): string {
  const elections = data.houses[house];
  const line = history(elections, lineage);
  const max = Math.max(1, ...line.map((p) => p?.seats ?? 0));
  const W = 560;
  const H = 120;
  const m = { l: 8, r: 8, t: 18, b: 22 };
  const step = (W - m.l - m.r) / elections.length;
  const bars = elections.map((e, k) => {
    const p = line[k];
    const n = p?.seats ?? 0;
    const h = ((H - m.t - m.b) * n) / max;
    const x = m.l + k * step + step * 0.18;
    const w = step * 0.64;
    return (
      (n
        ? `<rect x="${x.toFixed(1)}" y="${(H - m.b - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${groupClass(p!)}"><title>${e.year}: ${t.congress.seats(n)}</title></rect>` +
          `<text x="${(x + w / 2).toFixed(1)}" y="${(H - m.b - h - 4).toFixed(1)}" class="pm-value" text-anchor="middle">${n}</text>`
        : "") +
      `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" class="cv-tick" text-anchor="middle">${String(e.year).slice(2)}</text>`
    );
  });
  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t.party.seatsAria(t.congress.houseName[house]!))}">` +
    `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" class="cv-zero"/>` +
    bars.join("") +
    `</svg>`
  );
}

/** Left–right place per Chamber election, higher for further right. */
function ideologyChart(data: CongressData, lineage: string): string {
  const elections = data.houses.chamber;
  const line = history(elections, lineage);
  const W = 560;
  const H = 130;
  const m = { l: 64, r: 10, t: 10, b: 22 };
  const x = (k: number) => m.l + (k * (W - m.l - m.r)) / Math.max(1, elections.length - 1);
  const y = (v: number) => m.t + ((1 - v) / 2) * (H - m.t - m.b);
  const points = line
    .map((p, k) => ({ p, k }))
    .filter((d): d is { p: CongressParty; k: number } => d.p !== null && d.p.score !== null);
  if (!points.length) return `<p class="meta">${t.party.noIdeology}</p>`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t.party.ideologyAria)}">` +
    [1, 0, -1]
      .map(
        (v) =>
          `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "cv-zero" : "cv-rule"}"/>` +
          `<text x="${m.l - 8}" y="${y(v)}" dy="0.32em" class="cv-tick" text-anchor="end">${t.party.axis[String(v)]}</text>`,
      )
      .join("") +
    `<polyline points="${points.map(({ p, k }) => `${x(k).toFixed(1)},${y(p.score!).toFixed(1)}`).join(" ")}" class="pm-line"/>` +
    points
      .map(
        ({ p, k }) =>
          `<circle cx="${x(k).toFixed(1)}" cy="${y(p.score!).toFixed(1)}" r="5" class="${groupClass(p)}"><title>${elections[k]!.year}: ${t.congress.score(p.score!)} · ${t.congress.group[p.group ?? "none"]}</title></circle>`,
      )
      .join("") +
    elections
      .map(
        (e, k) =>
          `<text x="${x(k).toFixed(1)}" y="${H - 6}" class="cv-tick" text-anchor="middle">${String(e.year).slice(2)}</text>`,
      )
      .join("") +
    `</svg>`
  );
}

/** The modal's content for a party line. */
export function partyModalHtml(data: CongressData, gov: GovernismoData, lineage: string): string {
  const names = namesOverTime(data, lineage);
  const latest = [...data.houses.chamber, ...data.houses.senate]
    .sort((a, b) => b.year - a.year)
    .map((e) => e.parties.find((p) => p.lineage === lineage))
    .find(Boolean)!;
  const rows = stances(gov, lineage);
  const summary = pattern(rows);
  const list = (house: GovHouse) =>
    stances(gov, lineage, house)
      .map(
        (r) =>
          `<li class="pm-gov s-${r.stance}"><span class="pm-term">${escapeHtml(r.term.label)} <span class="meta">${r.term.from.slice(0, 4)}–${r.term.to.slice(0, 4)}</span></span>` +
          `<span class="pm-track"><span style="width:${r.share.toFixed(1)}%"></span></span>` +
          `<b>${r.share.toFixed(0)}%</b><span class="pm-stance">${t.party.stance[r.stance]}</span></li>`,
      )
      .join("");
  const gRows = list("chamber");
  const sRows = list("senate");
  return (
    `<div class="pm-head"><div><h2 class="panel-title" id="cg-modal-title">${escapeHtml(latest.party)}</h2>` +
    `<p class="pm-sub" id="pm-sub">${escapeHtml(latest.name)}${latest.centrao ? ` <span class="cg-tag">${t.congress.centrao}</span>` : ""}</p></div>` +
    `<div class="pm-actions"><button type="button" class="share-btn" data-share="party" aria-label="${escapeHtml(t.share.aria(latest.party))}">${t.share.button}</button>` +
    `<button type="button" class="chip" data-close-modal>${t.people.close}</button></div></div>` +
    (names.length > 1
      ? `<p class="meta">${t.party.names}: ${names.map((n) => `${escapeHtml(n.name)} (${n.from === n.to ? n.from : `${n.from}–${n.to}`})`).join(" → ")}</p>`
      : "") +
    `<h3 class="ap-h">${t.party.govTitle}</h3>` +
    (rows.length
      ? `<p class="meta">${t.party.govNote(gov.thresholds.base, gov.thresholds.opposition)}</p>` +
        (summary ? `<p class="pm-summary">${t.party.pattern[summary]}</p>` : "") +
        (sRows ? `<h4 class="pm-house">${t.party.govHouse.chamber}</h4>` : "") +
        `<ul class="pm-govs">${gRows}</ul>`
      : `<p class="meta">${t.party.noGov}</p>`) +
    (sRows
      ? `<h4 class="pm-house">${t.party.govHouse.senate}</h4><ul class="pm-govs">${sRows}</ul>` +
        `<p class="meta">${t.party.senateNote(gov.senateSince!.split("-").reverse().join("/"))}</p>`
      : "") +
    (latest.seats &&
    [...data.houses.chamber, ...data.houses.senate].some(
      (e) => e.year === 2026 && e.parties.some((p) => p.lineage === lineage),
    )
      ? `<p class="pp-links"><a class="pp-link" href="?view=people&partido=${encodeURIComponent(latest.party)}">${t.party.elected2026(latest.party)}</a></p>`
      : "") +
    `<h3 class="ap-h">${t.party.seatsTitle}</h3>` +
    `<div class="pm-charts"><figure id="pm-seats-chamber"><figcaption class="cv-cap">${t.congress.houseName.chamber}</figcaption>${seatsChart(data, "chamber", lineage)}</figure>` +
    `<figure><figcaption class="cv-cap">${t.congress.houseName.senate}</figcaption>${seatsChart(data, "senate", lineage)}</figure></div>` +
    `<h3 class="ap-h">${t.party.ideologyTitle}</h3><div id="pm-ideology">${ideologyChart(data, lineage)}</div>` +
    `<p class="map-note">${t.party.note}</p>` +
    `<p class="map-note sources" id="pm-sources">${sourcesHtml([t.sources.camaraOrientations, ...(sRows ? [t.sources.senateMandate] : []), t.sources.zuccoPower, t.sources.bolognesi])}</p>`
  );
}
