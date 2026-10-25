import { escapeHtml, integer } from "../format";
import { t } from "../i18n/pt-BR";
import {
  BOARDS,
  WATCH_HOUSES,
  houseMedians,
  memberKey,
  search,
  top,
  type Board,
  type WatchData,
  type WatchHouse,
  type WatchMember,
} from "../model/watch";
import { byId } from "./dom";

export interface WatchState {
  house: WatchHouse;
  uf: string | null;
  /** The member opened, by `memberKey`. */
  person: string | null;
}

const SLUG: Record<WatchHouse, string> = {
  camara: "camara",
  senado: "senado",
  alesp: "alesp",
  cmsp: "camara-sp",
};

export function watchFromSearch(data: WatchData, params: URLSearchParams): WatchState {
  const asked = WATCH_HOUSES.find((h) => SLUG[h] === params.get("casa"));
  const house = asked && data.houses[asked] ? asked : (WATCH_HOUSES.find((h) => data.houses[h]) ?? "camara");
  // ?id=: a member by their code in the house (links from the Eleitos 2026 tab).
  const id = params.get("id");
  const byId = id ? data.houses[house]?.members.find((m) => m.id === id) : undefined;
  return {
    house,
    uf: params.get("uf")?.toUpperCase() ?? null,
    person: byId ? memberKey(byId) : params.get("p"),
  };
}

export function watchToSearch(s: WatchState, params: URLSearchParams): void {
  if (s.house !== "camara") params.set("casa", SLUG[s.house]);
  if (s.uf) params.set("uf", s.uf);
  if (s.person) params.set("p", s.person);
}

/** "R$ 1,7 milhão", "R$ 41 mil", "R$ 9.149": money as people say it. */
const money = (v: number) =>
  v >= 1e6
    ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${v >= 2e6 ? "milhões" : "milhão"}`
    : v >= 1e4
      ? `R$ ${Math.round(v / 1e3).toLocaleString("pt-BR")} mil`
      : `R$ ${integer(Math.round(v))}`;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

/** "De olho": four rankings anyone can read, a search, and one member at a time. */
export class WatchView {
  constructor(
    private readonly data: WatchData,
    private state: WatchState,
    private readonly onChange: () => void,
  ) {
    byId("wt-houses").addEventListener("click", (e) => {
      const h = (e.target as HTMLElement).closest<HTMLElement>("[data-house]")?.dataset.house as
        WatchHouse | undefined;
      if (h) this.set({ house: h, uf: null, person: null });
    });
    byId<HTMLSelectElement>("wt-uf").addEventListener("change", (e) =>
      this.set({ uf: (e.target as HTMLSelectElement).value || null, person: null }),
    );
    const q = byId<HTMLInputElement>("wt-search");
    q.addEventListener("input", () => this.renderSearch(q.value));
    const open = (e: Event) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>("[data-member]")?.dataset.member;
      if (key) {
        this.set({ person: key });
        q.value = "";
        this.renderSearch("");
        byId("wt-person").scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    };
    byId("wt-boards").addEventListener("click", open);
    byId("wt-results").addEventListener("click", open);
    byId("wt-person").addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-close]")) this.set({ person: null });
    });
  }

  get current(): WatchState {
    return this.state;
  }

  private set(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }

  private get members(): WatchMember[] {
    const all = this.data.houses[this.state.house]?.members ?? [];
    return this.state.uf ? all.filter((m) => m.uf === this.state.uf) : all;
  }

  render(): void {
    const s = this.state;
    const W = t.watch;
    byId("wt-houses")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.house === s.house));
        b.hidden = !this.data.houses[b.dataset.house as WatchHouse];
      });
    // States only where members come from many (Congress); the São Paulo houses are all SP.
    const federal = s.house === "camara" || s.house === "senado";
    const uf = byId<HTMLSelectElement>("wt-uf");
    byId("wt-uf-group").hidden = !federal;
    if (federal && uf.options.length <= 1) {
      const ufs = [
        ...new Set((this.data.houses.camara?.members ?? []).map((m) => m.uf).filter(Boolean)),
      ].sort();
      ufs.forEach((u) => uf.add(new Option(u!, u!)));
    }
    uf.value = s.uf ?? "";
    const house = this.data.houses[s.house];
    byId("wt-intro").textContent = W.intro[s.house]!(
      house ? house.since.split("-").reverse().join("/") : "",
      this.data.date.split("-").reverse().join("/"),
      house?.members.length ?? 0,
    );
    const members = this.members;
    const medians = houseMedians(members);
    byId("wt-boards").innerHTML = BOARDS.map((board) => this.board(board, members, medians)).join("");
    this.renderPerson(medians);
    byId("wt-method").innerHTML = W.method[s.house]!;
  }

  private line(m: WatchMember, board: Board): string {
    const W = t.watch;
    if (board === "spendMost" || board === "spendLeast") {
      const sp = m.spend!;
      // A few reais in years reads better as what it is than as "R$ 0/mês".
      if (sp.perMonth < 100)
        return sp.total
          ? `<b>${money(sp.total)}</b> <span>${W.inAll(sp.months)}</span>`
          : `<b>${W.nothing}</b> <span>${W.inMonths(sp.months)}</span>`;
      return sp.capPct !== undefined
        ? `<b>${money(sp.perMonth)}</b>/mês <span>${W.ofCap(pct(sp.capPct))}</span>`
        : `<b>${money(sp.perMonth)}</b>/mês <span>${W.inMonths(sp.months)}</span>`;
    }
    const p = m.presence!;
    return `<b>${pct(p.pct)}</b> <span>${W.ofHeld(integer(p.attended), integer(p.held))}</span>`;
  }

  private board(board: Board, members: WatchMember[], medians: ReturnType<typeof houseMedians>): string {
    const W = t.watch;
    const list = top(members, board);
    const isSpend = board === "spendMost" || board === "spendLeast";
    const max = Math.max(
      1,
      ...list.map((m) => (isSpend ? (m.spend!.capPct ?? m.spend!.perMonth) : m.presence!.pct)),
    );
    const median = isSpend ? (medians.capPct ?? medians.perMonth) : medians.presence;
    return (
      `<section class="wt-board wt-${board}" aria-labelledby="wt-h-${board}">` +
      `<h3 id="wt-h-${board}">${W.boards[board]}</h3>` +
      `<p class="meta">${W.boardNote[board]!(median === null ? "—" : isSpend && medians.capPct === null ? money(median) : pct(median))}</p>` +
      (list.length
        ? `<ol>${list
            .map((m) => {
              const v = isSpend ? (m.spend!.capPct ?? m.spend!.perMonth) : m.presence!.pct;
              return (
                `<li><button type="button" class="wt-row" data-member="${memberKey(m)}">` +
                `<span class="wt-name">${escapeHtml(m.name)} <span class="meta wt-party">${escapeHtml(m.party)}${m.uf && this.state.house !== "alesp" && this.state.house !== "cmsp" ? `-${m.uf}` : ""}</span></span>` +
                `<span class="wt-value">${this.line(m, board)}</span>` +
                `<span class="wt-bar"><span style="width:${((v / max) * 100).toFixed(1)}%"></span></span>` +
                `</button></li>`
              );
            })
            .join("")}</ol>`
        : `<p class="meta">${W.none}</p>`) +
      `</section>`
    );
  }

  private renderSearch(q: string): void {
    const found = search(this.data.houses[this.state.house]?.members ?? [], q);
    byId("wt-results").innerHTML = found
      .map(
        (m) =>
          `<li><button type="button" class="chip" data-member="${memberKey(m)}">${escapeHtml(m.name)} <span class="meta">${escapeHtml(m.party)}${m.uf ? ` · ${m.uf}` : ""}</span></button></li>`,
      )
      .join("");
    byId("wt-results").hidden = !found.length;
  }

  private renderPerson(medians: ReturnType<typeof houseMedians>): void {
    const box = byId("wt-person");
    const all = this.data.houses[this.state.house]?.members ?? [];
    const m = all.find((x) => memberKey(x) === this.state.person);
    box.hidden = !m;
    if (!m) {
      box.replaceChildren();
      return;
    }
    const W = t.watch;
    const facts: string[] = [];
    if (m.spend) {
      const sp = m.spend;
      facts.push(
        `<li><span class="wt-big">${money(sp.perMonth)}<small>/mês</small></span>` +
          `<span>${W.spendLine(money(sp.total), sp.months, sp.capPct === undefined ? null : pct(sp.capPct))}</span>` +
          `<span class="meta">${W.versus(medians.perMonth === null ? "—" : money(medians.perMonth))}</span></li>`,
      );
    } else facts.push(`<li><span class="meta">${W.noSpend(this.data.minMonths)}</span></li>`);
    if (m.presence) {
      const p = m.presence;
      facts.push(
        `<li><span class="wt-big">${pct(p.pct)}</span>` +
          `<span>${W.presenceLine(integer(p.attended), integer(p.held), p.of)}</span>` +
          `<span class="meta">${W.versusPresence(medians.presence === null ? "—" : pct(medians.presence))}</span></li>`,
      );
    } else facts.push(`<li><span class="meta">${W.noPresence}</span></li>`);
    if (m.rollCalls)
      facts.push(
        `<li><span>${W.rollCalls(integer(m.rollCalls.voted), integer(m.rollCalls.held))}</span></li>`,
      );
    box.innerHTML =
      `<div class="pm-head"><div><h3 class="panel-title">${escapeHtml(m.name)}</h3>` +
      `<p class="meta">${escapeHtml(m.party)}${m.uf ? ` · ${m.uf}` : ""} · ${t.watch.houseName[this.state.house]}</p></div>` +
      `<button type="button" class="chip" data-close>${t.people.close}</button></div>` +
      `<ul class="wt-facts">${facts.join("")}</ul>` +
      `<p class="pp-links"><a class="pp-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${W.official}</a>` +
      (m.profile
        ? ` <a class="pp-link" data-go href="?view=people&amp;p=${encodeURIComponent(m.profile)}">${W.profile}</a>`
        : "") +
      `</p>` +
      `<p class="meta">${W.fair}</p>`;
  }
}
