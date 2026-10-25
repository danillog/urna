import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import {
  agreement,
  closer,
  deck,
  momentLink,
  pageLink,
  result,
  type Answer,
  type ProgramCandidate,
  type ProgramCard,
  type ProgramSource,
  type ProgramsData,
} from "../model/programs";
import { byId } from "./dom";
import { SHARES } from "./share";
import { programsImage, type ProgramsCard } from "./share-programs";

/** How far a card is dragged before it counts as an answer, in pixels. */
const SWIPE = 80;
/** Answers before "see the result now" shows up. */
const EARLY_RESULT = 6;

type Stage = "intro" | "deck" | "result";

/**
 * The "Programas" tab: a deck of proposals without their author, then the result, every
 * proposal with its author and page, what both programs propose and each candidacy.
 * Nothing the reader answers leaves the page.
 */
export class ProgramsView {
  private stage: Stage = "intro";
  private cards: ProgramCard[];
  private position = 0;
  private answers = new Map<string, Answer>();
  /** "Only show me the proposals": the full list without doing the quiz. */
  private browsing = false;
  /** The result as the share card draws it; null before there is one. */
  card: ProgramsCard | null = null;

  constructor(
    private readonly data: ProgramsData,
    /** Candidate id → the color the polls chart gives them. */
    private readonly colors: Record<string, string>,
    seed = Math.floor(Math.random() * 2 ** 32),
  ) {
    this.cards = deck(data, seed);
  }

  private candidate(id: string): ProgramCandidate {
    return this.data.candidates.find((c) => c.id === id)!;
  }

  private themeName(id: string): string {
    return this.data.themes.find((th) => th.id === id)?.name ?? id;
  }

  render(): void {
    const stage = byId("pg-stage");
    stage.dataset.stage = this.stage;
    if (this.stage === "intro") this.renderIntro(stage);
    else if (this.stage === "deck") this.renderCard(stage);
    else this.renderResult(stage);
    const all = byId<HTMLDetailsElement>("pg-all-card");
    all.hidden = !(this.browsing || this.stage === "result");
    if (!all.hidden) this.renderAll();
    this.renderDebates();
    this.renderAgree();
    this.renderCandidates();
    this.renderMethod();
  }

  /** Opens the list of every proposal with its author, and brings it into view. */
  private openAll(): void {
    const all = byId<HTMLDetailsElement>("pg-all-card");
    all.open = true;
    all.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  private renderIntro(el: HTMLElement): void {
    const p = t.programs;
    const steps = p.steps.map((s, i) => `<li><b>${i + 1}</b><span>${escapeHtml(s)}</span></li>`).join("");
    el.innerHTML = `<ol class="pg-steps">${steps}</ol>
      <button type="button" class="pg-start" id="pg-start">${p.start}</button>
      <p class="pg-small">${escapeHtml(p.introNote)}</p>
      <button type="button" class="pg-link" id="pg-browse">${p.browse}</button>`;
    byId("pg-start").addEventListener("click", () => {
      this.stage = "deck";
      this.browsing = false;
      this.render();
      byId("pg-card").focus();
    });
    byId("pg-browse").addEventListener("click", () => {
      this.browsing = true;
      this.render();
      this.openAll();
    });
  }

  private renderCard(el: HTMLElement): void {
    const p = t.programs;
    const card = this.cards[this.position]!;
    const n = this.position + 1;
    const total = this.cards.length;
    const answered = [...this.answers.values()].filter((a) => a !== "skip").length;
    const extra = [
      this.position > 0 ? `<button type="button" class="pg-link" id="pg-back">${p.back}</button>` : "",
      answered >= EARLY_RESULT
        ? `<button type="button" class="pg-link" id="pg-finish">${p.finishNow}</button>`
        : "",
    ].join("");
    el.innerHTML = `<div class="pg-progress"><span>${p.progress(n, total)}</span><div class="pg-meter"><i style="width:${(n / total) * 100}%"></i></div></div>
      <div class="pg-deck">
        <article class="pg-card" id="pg-card" tabindex="0" aria-label="${escapeHtml(p.cardAria(n, total, this.themeName(card.theme)))}">
          <span class="pg-theme">${escapeHtml(this.themeName(card.theme))}</span>
          <p class="pg-text">${escapeHtml(card.text)}</p>
        </article>
      </div>
      <div class="pg-answers">
        <button type="button" class="pg-round" id="pg-answer-disagree"><span aria-hidden="true">✕</span>${p.disagree}</button>
        <button type="button" class="pg-skip" id="pg-answer-skip">${p.skip}</button>
        <button type="button" class="pg-round" id="pg-answer-agree"><span aria-hidden="true">✓</span>${p.agree}</button>
      </div>
      <p class="pg-hint">${p.keys}</p>
      ${extra ? `<div class="pg-extra">${extra}</div>` : ""}`;
    byId("pg-answer-agree").addEventListener("click", () => this.answer("agree"));
    byId("pg-answer-disagree").addEventListener("click", () => this.answer("disagree"));
    byId("pg-answer-skip").addEventListener("click", () => this.answer("skip"));
    document.getElementById("pg-back")?.addEventListener("click", () => {
      this.position -= 1;
      this.render();
      byId("pg-card").focus();
    });
    document.getElementById("pg-finish")?.addEventListener("click", () => this.finish());
    const node = byId("pg-card");
    node.addEventListener("keydown", (e) => {
      const key = { ArrowRight: "agree", ArrowLeft: "disagree", ArrowDown: "skip" }[e.key] as
        Answer | undefined;
      if (!key) return;
      e.preventDefault();
      this.answer(key);
    });
    this.swipe(node);
  }

  /** Dragging the card left or right past SWIPE answers it; a shorter drag springs back. */
  private swipe(node: HTMLElement): void {
    let start: number | null = null;
    let dx = 0;
    node.addEventListener("pointerdown", (e) => {
      start = e.clientX;
      dx = 0;
      node.setPointerCapture?.(e.pointerId);
      node.classList.add("dragging");
    });
    node.addEventListener("pointermove", (e) => {
      if (start === null) return;
      dx = e.clientX - start;
      node.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
      node.dataset.lean = dx > SWIPE / 2 ? "agree" : dx < -SWIPE / 2 ? "disagree" : "";
    });
    const end = () => {
      if (start === null) return;
      start = null;
      node.classList.remove("dragging");
      if (Math.abs(dx) >= SWIPE) this.answer(dx > 0 ? "agree" : "disagree");
      else {
        node.style.transform = "";
        node.dataset.lean = "";
      }
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
  }

  private answer(a: Answer): void {
    this.answers.set(this.cards[this.position]!.id, a);
    this.position += 1;
    if (this.position >= this.cards.length) this.finish();
    else {
      this.render();
      byId("pg-card").focus();
    }
  }

  private finish(): void {
    this.stage = "result";
    this.render();
    byId("pg-stage").scrollIntoView?.({ block: "start" });
  }

  private renderResult(el: HTMLElement): void {
    const p = t.programs;
    const r = result(this.data, this.answers);
    const winner = closer(r.overall);
    const headline =
      r.answered === 0 ? p.resultNone : winner ? p.resultCloser(this.candidate(winner).name) : p.resultTie;
    const tiles = r.overall
      .map((s) => {
        const c = this.candidate(s.candidate);
        const share = agreement(s);
        const answered = s.agreed + s.disagreed;
        const label = share === null ? p.resultNoAnswer(c.name) : p.resultBar(s.agreed, answered, c.name);
        const pct = share === null ? "—" : `${Math.round(share * 100)}%`;
        const color = this.colors[c.id] || "var(--ink-2)";
        return `<div class="pg-tile${winner === c.id ? " pg-win" : ""}" style="--who:${color}">
          <span class="pg-tile-name">${escapeHtml(c.name)} <small>${c.number}</small></span>
          <b class="pg-tile-pct">${pct}</b>
          <div class="pg-meter"><i style="width:${(share ?? 0) * 100}%"></i></div>
          <small>${escapeHtml(label)}</small>
        </div>`;
      })
      .join("");
    const closers: (string | null)[] = [];
    const themes = r.byTheme
      .map(({ theme, scores }) => {
        // A side with every card skipped cannot be compared: neither closer nor a tie.
        const sides = scores.filter((s) => s.agreed + s.disagreed > 0).length;
        const who = closer(scores);
        const verdict =
          sides === 0
            ? p.themeNone
            : sides < scores.length
              ? p.themeOneSide
              : who
                ? p.themeCloser(this.candidate(who).name)
                : p.themeTie;
        const dot = who && sides === scores.length ? this.colors[who] || "var(--ink-2)" : "transparent";
        // On the share card: who came closer, only where both sides were answered.
        closers.push(sides === scores.length ? (who ?? "tie") : null);
        return `<li><span>${escapeHtml(this.themeName(theme))}</span><b><i style="background:${dot}"></i>${escapeHtml(verdict)}</b></li>`;
      })
      .join("");
    el.innerHTML = `<p class="pg-kicker">${p.resultTitle}</p>
      <p class="pg-headline" id="pg-headline">${escapeHtml(headline)}</p>
      <div class="pg-tiles">${tiles}</div>
      <p class="pg-kicker">${p.byTheme}</p>
      <ul class="pg-themes">${themes}</ul>
      <p class="pg-caveat">${escapeHtml(p.caveat)}</p>
      <div class="pg-extra">
        <button type="button" class="pg-start" id="pg-reveal">${p.reveal}</button>
        <button type="button" class="pg-link" id="pg-again">${p.again}</button>
        ${r.answered ? `<button type="button" class="share-btn" data-share="programs" aria-label="${escapeHtml(t.share.aria(p.resultTitle))}">${t.share.button}</button>` : ""}
      </div>`;
    const card: ProgramsCard = {
      headline: winner ? t.share.programs.closer(this.candidate(winner).name) : t.share.programs.tie,
      winner,
      candidates: r.overall.map((s) => {
        const c = this.candidate(s.candidate);
        return {
          id: c.id,
          name: c.name,
          number: c.number,
          color: this.colors[c.id] ?? "",
          share: agreement(s),
          agreed: s.agreed,
          answered: s.agreed + s.disagreed,
        };
      }),
      themes: r.byTheme.map(({ theme }, k) => ({ name: this.themeName(theme), closer: closers[k]! })),
    };
    this.card = card;
    SHARES.programs!.render = () => programsImage(card);
    byId("pg-reveal").addEventListener("click", () => this.openAll());
    byId("pg-again").addEventListener("click", () => {
      this.answers.clear();
      this.position = 0;
      this.cards = deck(this.data, Math.floor(Math.random() * 2 ** 32));
      this.stage = "deck";
      this.render();
      byId("pg-card").focus();
    });
  }

  private sourceLinks(c: ProgramCandidate, sources: ProgramSource[]): string {
    const pages = [...new Set(sources.map((s) => s.page))];
    const quotes = sources.map((s) => `“${escapeHtml(s.quote)}”`).join(" … ");
    const links = pages
      .map(
        (page) =>
          `<a href="${pageLink(c, page)}" target="_blank" rel="noopener">${t.programs.readPage(page)}</a>`,
      )
      .join(" · ");
    return `<blockquote>${quotes}</blockquote><span class="pg-src">${links}</span>`;
  }

  private renderAll(): void {
    const p = t.programs;
    byId("pg-all-note").textContent = p.allNote;
    byId("pg-all").innerHTML = this.data.themes
      .map((theme) => {
        const columns = this.data.candidates
          .map((c) => {
            const items = this.data.cards
              .filter((card) => card.theme === theme.id && card.candidate === c.id)
              .map((card) => {
                const a = this.answers.get(card.id);
                const mark = a ? `<span class="pg-mine pg-mine-${a}">${p.yours[a]}</span>` : "";
                return `<li><p>${escapeHtml(card.text)} ${mark}</p>${this.sourceLinks(c, card.sources)}</li>`;
              })
              .join("");
            return `<div class="pg-col"><h4><i style="background:${this.colors[c.id] ?? "var(--ink-2)"}"></i>${escapeHtml(c.name)} (${c.number})</h4><ul>${items}</ul></div>`;
          })
          .join("");
        return `<section class="pg-themeblock"><h3>${escapeHtml(theme.name)}</h3><div class="pg-cols">${columns}</div></section>`;
      })
      .join("");
  }

  /** Debate promises, theme by theme, the two candidates side by side. */
  private renderDebates(): void {
    const p = t.programs;
    const card = byId("pg-debates-card");
    card.hidden = !this.data.promises.length;
    if (card.hidden) return;
    byId("pg-debates-note").textContent = p.debatesNote;
    byId("pg-debates").innerHTML = this.data.debates
      .map((debate) => {
        const mine = this.data.promises.filter((pr) => pr.debate === debate.id);
        const themes = this.data.debateThemes
          .filter((theme) => mine.some((pr) => pr.theme === theme.id))
          .map((theme) => {
            const columns = this.data.candidates
              .map((c) => {
                const items = mine
                  .filter((pr) => pr.theme === theme.id && pr.candidate === c.id)
                  .map(
                    (pr) =>
                      `<li><p>${escapeHtml(pr.text)}</p><blockquote>“${escapeHtml(pr.quote)}”</blockquote><a class="pg-src" href="${escapeHtml(momentLink(debate, pr))}" target="_blank" rel="noopener">${p.watchAt(pr.time)}</a></li>`,
                  )
                  .join("");
                return `<div class="pg-col"><h4><i style="background:${this.colors[c.id] || "var(--ink-2)"}"></i>${escapeHtml(c.name)} (${c.number})</h4><ul>${items}</ul></div>`;
              })
              .join("");
            return `<section class="pg-themeblock"><h3>${escapeHtml(theme.name)}</h3><div class="pg-cols">${columns}</div></section>`;
          })
          .join("");
        return `<p class="pg-debate-name"><b>${escapeHtml(debate.name)}</b> · ${p.debateDate(debate.date)} · <a href="${escapeHtml(debate.video)}" target="_blank" rel="noopener">${escapeHtml(debate.channel)}</a></p>${themes}`;
      })
      .join("");
  }

  private renderAgree(): void {
    byId("pg-agree-note").textContent = t.programs.agreeNote;
    byId("pg-agree").innerHTML = this.data.agree
      .map((item) => {
        const links = this.data.candidates
          .map((c) => {
            const pages = [...new Set((item.sources[c.id] ?? []).map((s) => s.page))];
            const quote = (item.sources[c.id] ?? []).map((s) => `“${escapeHtml(s.quote)}”`).join(" … ");
            const pageLinks = pages
              .map((page) => `<a href="${pageLink(c, page)}" target="_blank" rel="noopener">p. ${page}</a>`)
              .join(", ");
            return `<div><b>${escapeHtml(c.name)}</b> (${pageLinks}): ${quote}</div>`;
          })
          .join("");
        return `<li><p>${escapeHtml(item.text)}</p>${links}</li>`;
      })
      .join("");
  }

  private renderCandidates(): void {
    const p = t.programs;
    byId("pg-who").innerHTML = this.data.candidates
      .map((c) => {
        const channels = Object.entries(c.channels)
          .map(
            ([network, url]) =>
              `<a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow">${p.channel[network] ?? network}</a>`,
          )
          .join(" · ");
        return `<article class="pg-person">
          <h3><i style="background:${this.colors[c.id] ?? "var(--ink-2)"}"></i>${escapeHtml(c.name)}</h3>
          <dl>
            <dt>${p.number(c.number)}</dt><dd>${escapeHtml(c.fullName)} · ${escapeHtml(c.party)}</dd>
            <dt>${p.vice}</dt><dd>${escapeHtml(c.vice)}</dd>
            <dt>${p.coalition}</dt><dd>${escapeHtml(c.coalition)}</dd>
            <dt>${p.channels}</dt><dd>${channels}</dd>
          </dl>
          <a class="pg-pdf" href="${c.pdf}" target="_blank" rel="noopener">${p.program(c.pages)}</a>
        </article>`;
      })
      .join("");
  }

  private renderMethod(): void {
    const p = t.programs;
    const src = this.data.source;
    const [y, m, d] = src.fetched.split("-");
    const each = this.data.cards.length / this.data.candidates.length;
    const items = p
      .method(`${d}/${m}/${y}`, this.data.themes.length, each)
      .map((line) => `<li>${escapeHtml(line)}</li>`);
    items.push(
      `<li>${p.sources}: <a href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.label)}</a> · <a href="${escapeHtml(src.candidates)}" target="_blank" rel="noopener">TSE: candidaturas 2026</a> · <a href="${escapeHtml(src.socials)}" target="_blank" rel="noopener">TSE: redes sociais declaradas</a></li>`,
    );
    byId("pg-method").innerHTML = items.join("");
  }
}
