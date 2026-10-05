import { escapeHtml, integer, percent } from "../format";
import { t } from "../i18n/pt-BR";
import {
  KINDS,
  PROFILE_OFFICES,
  articleUrl,
  byKind,
  filterPeople,
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

export function peopleFromSearch(data: ProfilesData, params: URLSearchParams): PeopleState {
  const person = params.get("p");
  return {
    office: fromSlug(PROFILE_OFFICES, params.get("cargo")),
    uf: params.get("uf")?.toUpperCase() ?? null,
    party: params.get("partido"),
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

/** The "Eleitos 2026" tab: renewal at a glance, a searchable list and one profile at a time. */
export class PeopleView {
  private shown = PAGE;

  constructor(
    private readonly data: ProfilesData,
    private state: PeopleState,
    private readonly onChange: () => void,
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
            return (
              `<li><button type="button" class="pp-card${p.id === this.state.person ? " on" : ""}" data-person="${p.id}">` +
              `<i class="map-key c-${KIND_COLORS[p.kind]}" title="${escapeHtml(t.people.kind[p.kind]!)}"></i>` +
              `<b>${escapeHtml(p.name)}</b>` +
              `<span class="pp-card-meta">${escapeHtml(t.people.office[p.office]!)} · ${escapeHtml(p.party)} · ${p.uf}</span>` +
              status +
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
    const office = t.people.office[p.office]!;
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
              `<li><span class="pp-year">${h.year}</span><span>${escapeHtml(t.people.office[h.office] ?? h.office)} · ${escapeHtml(h.place)}</span>` +
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
              `<li><span>${escapeHtml(x.title.charAt(0).toUpperCase() + x.title.slice(1))}</span><span class="pp-years">${t.people.years(x.from, x.to)}</span></li>`,
          )
          .join("") +
        `</ul>`
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
      `<h2 class="panel-title">${escapeHtml(p.name)}</h2>` +
      `<p class="pp-sub">${escapeHtml(p.fullName)} · ${escapeHtml(office)} · ${escapeHtml(p.party)} · ${p.uf} ${status}</p>` +
      `<p><span class="pp-tag pp-kind"><i class="map-key c-${KIND_COLORS[p.kind]}"></i>${t.people.kind[p.kind]}</span></p>` +
      `</div><button type="button" class="chip pp-close" data-close>${t.people.close}</button></div>` +
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
      positions +
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
}
