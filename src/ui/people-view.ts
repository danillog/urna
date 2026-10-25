import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import { houseOf, rightOf } from "../model/ideology";
import { allowanceMedian, share, type MandateData, type MandateEntry } from "../model/mandate";
import {
  KINDS,
  PROFILE_OFFICES,
  articleUrl,
  byKind,
  filterPeople,
  feminineTitle,
  legalMark,
  renewal,
  type RenewalRow,
  newsUrl,
  partyPath,
  type Kind,
  type PeopleFilter,
  type Person,
  type ProfileOffice,
  type ProfilesData,
} from "../model/profiles";
import { byId } from "./dom";
import { sourcesHtml } from "./sources";

export interface PeopleState extends PeopleFilter {
  /** The open profile. */
  person: string | null;
}

/** Cards shown before "Mostrar mais". */
const PAGE = 60;
/** One fixed color per kind, never by rank. */
const KIND_COLORS: Record<Kind, string> = {
  new: "teal",
  tried: "sky",
  appointed: "gold",
  "other-office": "violet",
  returning: "orange",
};

const fromSlug = <T extends string>(all: readonly T[], s: string | null): T | null =>
  s && (all as readonly string[]).includes(s) ? (s as T) : null;

/** "Republicanos" or "PCdoB" (as Congress writes them) → the TSE's "REPUBLICANOS", "PCDOB". */
const plainParty = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

export function partyIn(data: ProfilesData, asked: string | null): string | null {
  if (!asked) return null;
  return data.people.find((p) => plainParty(p.party) === plainParty(asked))?.party ?? null;
}

export function peopleFromSearch(data: ProfilesData, params: URLSearchParams): PeopleState {
  const person = params.get("p");
  return {
    office: fromSlug(PROFILE_OFFICES, params.get("cargo")),
    uf: params.get("uf")?.toUpperCase() ?? null,
    party: partyIn(data, params.get("partido")),
    kind: fromSlug(KINDS, params.get("trajetoria")),
    query: params.get("q") ?? "",
    person: data.people.some((p) => p.id === person) ? person : null,
  };
}

export function peopleToSearch(s: PeopleState, params: URLSearchParams): void {
  if (s.office) params.set("cargo", s.office);
  if (s.uf) params.set("uf", s.uf);
  if (s.party) params.set("partido", s.party);
  if (s.kind) params.set("trajetoria", s.kind);
  if (s.query) params.set("q", s.query);
  if (s.person) params.set("p", s.person);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An office as the person holds it: "Governadora" for a woman (the TSE's declared gender). */
function officeOf(p: Person, office: string): string {
  return (p.feminine ? t.people.officeFeminine[office] : t.people.office[office]) ?? office;
}

/** The "Eleitos 2026" tab: renewal at a glance, a searchable list and one profile at a time. */
export class PeopleView {
  private shown = PAGE;
  /** States whose news are already in `data.people`. */
  private readonly newsIn = new Set<string>();
  /** The current term in Congress, downloaded with the first profile opened. */
  private mandate: MandateData | null = null;
  private mandateAsked = false;

  constructor(
    private readonly data: ProfilesData,
    private state: PeopleState,
    private readonly onChange: () => void,
    private readonly loadNews?: (uf: string) => Promise<Record<string, Person["news"]>>,
    private readonly loadMandate?: () => Promise<MandateData>,
  ) {
    const uf = byId<HTMLSelectElement>("pp-uf");
    uf.add(new Option(t.people.allUfs, ""));
    [...new Set(data.people.map((p) => p.uf))].sort().forEach((u) => uf.add(new Option(u, u)));
    uf.addEventListener("change", () => this.set({ uf: uf.value || null }));
    const party = byId<HTMLSelectElement>("pp-party");
    party.add(new Option(t.people.allParties, ""));
    [...new Set(data.people.map((p) => p.party))].sort().forEach((x) => party.add(new Option(x, x)));
    party.addEventListener("change", () => this.set({ party: party.value || null }));
    byId("pp-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.addEventListener("click", () =>
          this.set({ office: (b.dataset.office || null) as ProfileOffice | null }),
        ),
      );
    const search = byId<HTMLInputElement>("pp-search");
    search.value = this.state.query;
    search.addEventListener("input", () => this.set({ query: search.value }, false));
    byId("pp-kinds").addEventListener("click", (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]")?.dataset.kind as
        Kind | undefined;
      if (k) this.set({ kind: this.state.kind === k ? null : k });
    });
    byId("pp-list").addEventListener("click", (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-person]")?.dataset.person;
      if (id) {
        this.set({ person: id });
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        byId("pp-profile").scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "start" });
      }
    });
    byId("pp-profile").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-close]")) this.set({ person: null });
    });
    byId("pp-more").addEventListener("click", () => {
      this.shown += PAGE;
      this.renderList();
    });
  }

  get current(): PeopleState {
    return this.state;
  }

  private set(patch: Partial<PeopleState>, resetPage = true): void {
    this.state = { ...this.state, ...patch };
    if (resetPage) this.shown = PAGE;
    this.onChange();
  }

  render(): void {
    const s = this.state;
    byId("pp-offices")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.office || null) === s.office)));
    byId<HTMLSelectElement>("pp-uf").value = s.uf ?? "";
    byId<HTMLSelectElement>("pp-party").value = s.party ?? "";
    // The renewal bar counts everyone the other filters keep, whatever the kind chosen.
    const pool = filterPeople(this.data.people, { ...s, kind: null });
    byId("pp-title").textContent = t.people.title(pool.length);
    byId("pp-meta").textContent = t.people.meta(this.data.officialDeputies);
    this.renderRenewal(pool);
    this.renderRenew();
    this.renderDefeated();
    byId("pp-warning").textContent = t.people.warning;
    this.renderProfile();
    this.renderList();
    byId("pp-note").textContent = t.people.note;
    byId("pp-sources").innerHTML = sourcesHtml([
      t.sources.tseCandidates,
      t.sources.tseResults,
      t.sources.camaraOpenData,
      t.sources.senateOpenData,
      t.sources.wikidata,
      t.sources.googleNews,
    ]);
  }

  /** One bar split by kind, and the kinds as chips that filter the list. */
  private renderRenewal(pool: Person[]): void {
    const counts = byKind(pool);
    const total = pool.length || 1;
    byId("pp-renewal").innerHTML =
      `<div class="pp-bar" role="img" aria-label="${escapeHtml(t.people.renewalAria)}">` +
      KINDS.map(
        (k) =>
          `<span class="c-${KIND_COLORS[k]}" style="width:${((counts[k] / total) * 100).toFixed(2)}%" title="${escapeHtml(`${t.people.kind[k]}: ${t.people.share(counts[k], total)}`)}"></span>`,
      ).join("") +
      `</div>`;
    byId("pp-kinds").innerHTML = KINDS.map(
      (k) =>
        `<button type="button" class="chip map-chip" data-kind="${k}" aria-pressed="${this.state.kind === k}" title="${escapeHtml(t.people.kindLong[k]!)}">` +
        `<i class="map-key c-${KIND_COLORS[k]}"></i><span>${t.people.kind[k]}</span><span class="n">${t.people.share(counts[k], total)}</span></button>`,
    ).join("");
  }

  private renderList(): void {
    const list = filterPeople(this.data.people, this.state);
    byId("pp-list-title").textContent = t.people.listTitle(list.length, this.data.people.length);
    byId("pp-list").innerHTML = list.length
      ? list
          .slice(0, this.shown)
          .map((p) => {
            const status =
              p.status !== "elected" ? `<span class="pp-tag">${t.people.status[p.status]}</span>` : "";
            const mark = legalMark(p);
            const legal = mark
              ? `<span class="pp-tag pp-legal g-${mark}" title="${escapeHtml(t.people.legal.gradeLong[mark]!)}">${t.people.legal.grade[mark]}</span>`
              : "";
            return (
              `<li><button type="button" class="pp-card${p.id === this.state.person ? " on" : ""}" data-person="${p.id}">` +
              `<i class="map-key c-${KIND_COLORS[p.kind]}" title="${escapeHtml(t.people.kind[p.kind]!)}"></i>` +
              `<b>${escapeHtml(p.name)}</b>` +
              `<span class="pp-card-meta">${escapeHtml(officeOf(p, p.office))} · ${escapeHtml(p.party)} · ${p.uf}</span>` +
              status +
              legal +
              `</button></li>`
            );
          })
          .join("")
      : `<li class="meta">${t.people.none}</li>`;
    const more = byId<HTMLButtonElement>("pp-more");
    more.hidden = list.length <= this.shown;
    more.textContent = t.people.more(Math.min(PAGE, list.length - this.shown));
  }

  private renderProfile(): void {
    const box = byId("pp-profile");
    const p = this.data.people.find((x) => x.id === this.state.person);
    box.hidden = !p;
    if (!p) {
      box.replaceChildren();
      return;
    }
    if (this.loadMandate && !this.mandateAsked) {
      this.mandateAsked = true;
      void this.loadMandate().then(
        (m) => {
          this.mandate = m;
          if (this.state.person) this.renderProfile();
        },
        () => {}, // the profile stays useful without it
      );
    }
    if (this.loadNews && this.data.newsStates?.includes(p.uf) && !this.newsIn.has(p.uf)) {
      const uf = p.uf;
      void this.loadNews(uf).then(
        (news) => {
          this.newsIn.add(uf);
          for (const x of this.data.people) if (x.uf === uf && news[x.id]) x.news = news[x.id];
          if (this.state.person === p.id) this.renderProfile();
        },
        () => this.newsIn.add(uf), // the profile stays useful without them
      );
    }
    const office = officeOf(p, p.office);
    const fact = (label: string, v: string | null) =>
      v ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(v)}</dd></div>` : "";
    const c = p.contact;
    const photo = c?.photo ? `<img class="pp-photo" src="${escapeHtml(c.photo)}" alt="" loading="lazy">` : "";
    const status = p.status !== "elected" ? `<span class="pp-tag">${t.people.status[p.status]}</span>` : "";
    const path = partyPath(p);

    const career = p.history.length
      ? `<ol class="pp-career">${p.history
          .map(
            (h) =>
              `<li><span class="pp-year">${h.year}</span><span>${escapeHtml(officeOf(p, h.office))} · ${escapeHtml(h.place)}</span>` +
              `<span class="pp-party">${escapeHtml(h.party)}</span><span class="pp-result r-${h.result}">${t.people.result[h.result]}</span></li>`,
          )
          .join("")}</ol>`
      : `<p class="meta">${t.people.careerEmpty(this.data.historySince)}</p>`;

    const contact = c
      ? `<div class="pp-contact"><h3 class="ap-h">${t.people.contact}</h3><p class="meta">${t.people.contactNote}</p><dl class="pp-facts">` +
        (c.email
          ? `<div><dt>${t.people.email}</dt><dd><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></dd></div>`
          : "") +
        (c.phone
          ? `<div><dt>${t.people.phone}</dt><dd><a href="tel:${escapeHtml(c.phone.replace(/\D/g, ""))}">${escapeHtml(c.phone)}</a></dd></div>`
          : "") +
        fact(t.people.room, c.office) +
        `</dl></div>`
      : `<p class="meta">${p.office === "governador" ? t.people.governorContact : t.people.noContact}</p>`;

    // Accounts and website: the Congress's own list first, Wikidata's for everyone else.
    const socials = p.socials ?? c?.socials ?? [];
    const site = p.site ?? c?.site ?? null;
    const web =
      socials.length || site
        ? `<p class="pp-socials"><b>${t.people.networks}:</b> ` +
          [
            ...socials.map(
              (x) =>
                `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(x.network)}</a>`,
            ),
            ...(site
              ? [`<a href="${escapeHtml(site)}" target="_blank" rel="noopener nofollow">${t.people.site}</a>`]
              : []),
          ].join(" · ") +
          `</p>`
        : "";

    const positions = p.positions?.length
      ? `<h3 class="ap-h">${t.people.positions}</h3><p class="meta">${t.people.positionsNote}</p><ul class="pp-positions">` +
        p.positions
          .map(
            (x) =>
              `<li><span>${escapeHtml(capitalize(p.feminine ? feminineTitle(x.title) : x.title))}</span><span class="pp-years">${t.people.years(x.from, x.to)}</span></li>`,
          )
          .join("") +
        `</ul>`
      : "";

    const day = (iso: string) => iso.split("-").reverse().join("/");
    const term = this.mandate?.people[p.id];
    const mandate = term ? this.mandateHtml(p, term) : "";
    const legal = p.legal?.length
      ? `<section class="pp-legal-box" aria-labelledby="pp-legal-title"><h3 class="ap-h" id="pp-legal-title">${t.people.legal.title}</h3>` +
        `<ul class="pp-legal-list">${p.legal
          .map(
            (x) =>
              `<li><span class="pp-tag pp-legal g-${x.grade}">${t.people.legal.grade[x.grade]}</span> ` +
              `<b>${escapeHtml(x.crime)}</b> · ${escapeHtml(x.court)}, ${escapeHtml(x.case)} · ${t.people.legal.since(day(x.since))}` +
              `<span class="meta">${escapeHtml(t.people.legal.gradeLong[x.grade]!)}${x.note ? ` ${escapeHtml(x.note)}` : ""} ` +
              `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">${t.people.legal.link}</a> · ${t.people.legal.checked(day(x.checked))}` +
              `${x.stale ? ` · <b>${t.people.legal.stale}</b>` : ""}</span></li>`,
          )
          .join("")}</ul>` +
        (p.legal.some((x) => x.grade !== "condenado-definitivo")
          ? `<p class="meta pp-innocence">${t.people.legal.innocence}</p>`
          : "") +
        (this.data.legalChecked
          ? `<p class="meta">${t.people.legal.method(day(this.data.legalChecked))}</p>`
          : "") +
        `</section>`
      : "";

    const news = p.news
      ? `<h3 class="ap-h">${t.people.newsTitle}</h3>` +
        (this.data.newsUpdated
          ? `<p class="meta">${t.people.newsAuto(this.data.newsUpdated.split("-").reverse().join("/"))}</p>`
          : "") +
        (p.news.length
          ? `<ul class="pp-news-list">${p.news
              .map(
                (n) =>
                  `<li><a href="${escapeHtml(articleUrl(n.id))}" target="_blank" rel="noopener nofollow">${escapeHtml(n.title)}</a>` +
                  `<span class="meta">${escapeHtml(n.source)} · ${n.date.split("-").reverse().join("/")}</span></li>`,
              )
              .join("")}</ul>`
          : `<p class="meta">${t.people.noNews}</p>`)
      : "";

    box.innerHTML =
      `<div class="pp-head">${photo}<div>` +
      `<h2 class="panel-title" id="pp-name">${escapeHtml(p.name)}</h2>` +
      `<p class="pp-sub" id="pp-sub">${escapeHtml(p.fullName)} · ${escapeHtml(office)} · ${escapeHtml(p.party)} · ${p.uf} ${status}</p>` +
      `<p><span class="pp-tag pp-kind"><i class="map-key c-${KIND_COLORS[p.kind]}"></i>${t.people.kind[p.kind]}</span></p>` +
      `</div><div class="pm-actions"><button type="button" class="share-btn" data-share="profile" aria-label="${escapeHtml(t.share.aria(p.name))}">${t.share.button}</button>` +
      `<button type="button" class="chip pp-close" data-close>${t.people.close}</button></div></div>` +
      `<dl class="pp-facts">` +
      fact(t.people.facts.age, p.age ? t.people.age(p.age) : null) +
      fact(t.people.facts.from, p.birthplace) +
      fact(t.people.facts.education, p.education) +
      fact(t.people.facts.occupation, p.occupation) +
      fact(
        t.people.facts.votes,
        p.votes !== null && p.share !== null ? t.people.votes(integer(p.votes), percent(p.share)) : null,
      ) +
      `</dl>` +
      `<h3 class="ap-h">${t.people.career}</h3>` +
      (path.length > 1 ? `<p class="meta">${escapeHtml(t.people.partyPath(path.join(" → ")))}</p>` : "") +
      career +
      mandate +
      positions +
      legal +
      contact +
      web +
      news +
      `<p class="pp-links"><a class="pp-link pp-news" href="${escapeHtml(newsUrl(p, office))}" target="_blank" rel="noopener" title="${escapeHtml(t.people.newsNote)}">${p.news ? t.people.moreNews : t.people.news}</a>` +
      (p.wikipedia
        ? ` <a class="pp-link" href="${escapeHtml(p.wikipedia)}" target="_blank" rel="noopener">${t.people.wikipedia}</a>`
        : "") +
      (c
        ? ` <a class="pp-link pp-page" href="${escapeHtml(c.page)}" target="_blank" rel="noopener">${t.people.page(c.house)}</a>`
        : "") +
      `</p>`;
  }

  /** "No mandato atual": votes, the government, bills and the allowance, with what to read them against. */
  private mandateHtml(p: Person, m: MandateEntry): string {
    const M = t.people.mandate;
    const money = (v: number) => `R$ ${integer(v)}`;
    const items: string[] = [];
    if (m.votes) {
      const pct = percent(share(m.votes.cast, m.votes.held));
      items.push(
        `<li>${M.votes(integer(m.votes.cast), integer(m.votes.held), pct)}` +
          (m.votes.from
            ? `<span class="meta">${M.votesFrom(m.votes.from.split("-").reverse().join("/"))}</span>`
            : "") +
          (m.votes.justified ? `<span class="meta">${M.justified(integer(m.votes.justified))}</span>` : "") +
          `</li>`,
      );
    }
    const placed = this.mandate?.ideology?.[houseOf(m.house)];
    const position = placed?.members[m.id];
    if (placed && position) {
      items.push(
        `<li>${M.position(position.score.toFixed(2).replace(".", ","), percent(rightOf(placed, position.score)), m.house)}` +
          `<span class="meta">${M.positionNote}</span></li>`,
      );
    }
    if (m.government) {
      items.push(
        `<li>${M.government(percent(share(m.government.with, m.government.of)), integer(m.government.of))}` +
          `<span class="meta">${M.governmentNote}</span></li>`,
      );
    }
    if (m.activity) {
      const a = m.activity;
      const lead = a.committees.filter((c) => !["Titular", "Suplente"].includes(c.role));
      const titular = a.committees.filter((c) => c.role === "Titular").length;
      const substitute = a.committees.filter((c) => c.role === "Suplente").length;
      items.push(
        `<li>${M.committees(titular, substitute)}` +
          (lead.length
            ? `<span class="meta">${lead.map((c) => `${escapeHtml(c.role)}: ${escapeHtml(c.name)}`).join(" · ")}</span>`
            : "") +
          `</li>`,
        `<li>${M.rapporteur(integer(a.rapporteur), m.house)}</li>`,
        `<li>${a.speeches === null ? M.speechesUnknown : M.speeches(integer(a.speeches))}</li>`,
      );
    }
    items.push(
      `<li>${M.bills(integer(m.bills.first), integer(m.bills.passed), integer(m.bills.law), m.house)}</li>`,
    );
    if (m.allowance) {
      const a = m.allowance;
      const median = allowanceMedian(this.mandate!, p.id);
      items.push(
        `<li>${M.allowance(money(a.perMonth), money(a.total), integer(a.months))}` +
          (median ? `<span class="meta">${M.median(money(median), M.medianWho(m.house, p.uf))}</span>` : "") +
          `<span class="meta">${M.topCategories}: ${a.categories.map((c) => `${escapeHtml(c.name)} (${money(c.value)})`).join(" · ")}</span></li>`,
      );
    }
    const key = this.mandate?.keyVotes?.[m.house === "senado" ? "senate" : "chamber"];
    const mine = key?.votes[m.id];
    const keyList =
      key && mine
        ? `<details class="pp-key"><summary>${escapeHtml(M.keyTitle(key.rolls.length))}</summary>` +
          `<p class="meta">${M.keyNote}</p><div class="scroll"><table><thead><tr><th>${M.keyDate}</th><th>${M.keyBill}</th><th>${M.keyVote}</th><th>${M.keyGov}</th></tr></thead><tbody>` +
          key.rolls
            .map((r, i) => {
              const v = mine[i] ?? "-";
              return (
                `<tr><td>${r.date.split("-").reverse().join("/")}</td>` +
                `<td title="${escapeHtml(r.summary)}">${escapeHtml(r.bill)}<span class="meta">${escapeHtml(r.what)}</span></td>` +
                `<td><b>${M.letters[v] ?? v}</b></td><td>${r.government ? M.letters[r.government] : "—"}</td></tr>`
              );
            })
            .join("") +
          `</tbody></table></div></details>`
        : "";
    const sources =
      m.house === "senado" ? [t.sources.senateMandate, t.sources.ceaps] : [t.sources.camaraMandate];
    return (
      `<h3 class="ap-h">${M.title(M.house[m.house]!)}</h3>` +
      `<ul class="pp-mandate">${items.join("")}</ul>` +
      `<p class="pp-links"><a class="pp-link" data-go href="?view=watch${m.house === "senado" ? "&amp;casa=senado" : ""}&amp;id=${encodeURIComponent(m.id)}">${M.watch}</a></p>` +
      keyList +
      `<p class="meta">${M.note}</p>` +
      `<p class="map-note sources">${sourcesHtml(sources)}</p>`
    );
  }

  /** Renewal by office, then by party and by state for the office picked (deputies by default). */
  private renderRenew(): void {
    const R = t.people.renew;
    const people = this.data.people.filter(
      (p) =>
        (!this.state.uf || p.uf === this.state.uf) && (!this.state.party || p.party === this.state.party),
    );
    const office = this.state.office ?? "deputado-federal";
    const table = (head: string, rows: RenewalRow[], label: (k: string) => string) =>
      `<table><thead><tr><th>${escapeHtml(head)}</th><th>${R.elected}</th><th>${R.reelected}</th><th>${R.rate}</th></tr></thead><tbody>` +
      rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(label(r.key))}</td><td>${integer(r.elected)}</td><td>${integer(r.reelected)}</td><td><b>${percent(r.renewal)}</b></td></tr>`,
        )
        .join("") +
      `</tbody></table>`;
    const officeName = t.people.office[office]!;
    byId("pp-renew-title").textContent = R.title;
    byId("pp-renew-note").textContent = R.note;
    byId("pp-renew").innerHTML =
      table(
        R.office,
        renewal(people, (p) => p.office),
        (k) => t.people.office[k] ?? k,
      ) +
      `<details><summary>${escapeHtml(R.partyFor(officeName))}</summary>` +
      table(
        R.byParty,
        renewal(
          people.filter((p) => p.office === office),
          (p) => p.party,
        ),
        (k) => k,
      ) +
      `</details><details><summary>${escapeHtml(R.stateFor(officeName))}</summary>` +
      table(
        R.byState,
        renewal(
          people.filter((p) => p.office === office),
          (p) => p.uf,
        ),
        (k) => k,
      ) +
      `</details>`;
  }

  /** Those in Congress now who ran in 2026 and lost, with the tab's state and party filters. */
  private renderDefeated(): void {
    const D = t.people.defeated;
    const all = this.data.defeated ?? [];
    const rows = all.filter(
      (d) =>
        (!this.state.uf || d.uf === this.state.uf) && (!this.state.party || d.party === this.state.party),
    );
    byId("pp-defeated-title").textContent = D.title(rows.length);
    byId("pp-defeated-note").textContent = D.note;
    byId("pp-defeated").innerHTML = rows.length
      ? `<table><thead><tr><th>${D.who}</th><th>${D.now}</th><th>${D.ranFor}</th><th>${D.votes}</th><th>${D.result}</th></tr></thead><tbody>` +
        rows
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.name)} <span class="meta">${escapeHtml(d.party)} · ${d.uf}</span></td>` +
              `<td>${D.house[d.house]}</td><td>${escapeHtml(t.people.office[d.ranFor] ?? d.ranFor)}</td>` +
              `<td>${integer(d.votes)}${d.share !== null ? ` <span class="meta">(${percent(d.share)})</span>` : ""}</td>` +
              `<td>${escapeHtml(d.status)}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`
      : `<p class="meta">${D.none}</p>`;
  }
}
