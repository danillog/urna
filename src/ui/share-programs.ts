/**
 * The quiz result as a status card (1080 × 1920, the shape of a WhatsApp or Instagram
 * status): the result in the closer candidate's color, each candidate's share as a big
 * number and a bar, the themes where each came closer and the address.
 *
 * A status covers the top of the image with its progress bar, photo and name, and the
 * bottom with the reply box: everything is drawn inside the band between them, in type
 * large enough to read on a phone (nothing under 30 px on a 1080 px wide card).
 *
 * Drawn straight onto a canvas from the result, not copied from the page: the page's
 * tiles are HTML, which a canvas cannot draw. Always light, whatever the page's theme,
 * so every copy of the card looks the same.
 */

import { t } from "../i18n/pt-BR";
import { shortUrl, wrap } from "./share";

export interface ProgramsCard {
  headline: string;
  /** Id of the closer candidate; null on a tie. */
  winner: string | null;
  candidates: {
    id: string;
    name: string;
    number: number;
    color: string;
    /** 0–1, or null with none of their proposals answered. */
    share: number | null;
    agreed: number;
    answered: number;
  }[];
  /** Who came closer in each theme: a candidate id, "tie", or null with a side unanswered. */
  themes: { name: string; closer: string | null }[];
}

const W = 1080;
const H = 1920;
/** The band a status leaves visible: below its header, above its reply box. */
export const SAFE_TOP = 270;
export const SAFE_BOTTOM = 1600;
const P = 80;
const INNER = W - 2 * P;

const BG = "#f3f4f6";
const PANEL = "#ffffff";
const INK = "#14171c";
const INK_2 = "#4a505a";
const MUTED = "#6b717b";
const TRACK = "#e6e8ec";
const NEUTRAL = "#4a505a";

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The family a CSS variable names, for the canvas font shorthand. */
function family(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "sans-serif";
}

/** The themes grouped by who came closer: each candidate's, then the ties. */
function groups(card: ProgramsCard, ties: boolean): { label: string; color: string; names: string[] }[] {
  const p = t.share.programs;
  const out = card.candidates.map((c) => ({
    label: p.closerIn(c.name),
    color: c.color || NEUTRAL,
    names: card.themes.filter((th) => th.closer === c.id).map((th) => th.name),
  }));
  if (ties)
    out.push({
      label: p.tieIn,
      color: MUTED,
      names: card.themes.filter((th) => th.closer === "tie").map((th) => th.name),
    });
  return out.filter((g) => g.names.length);
}

/**
 * Lays the card out from top; draws it too when draw is set. Returns the content's height,
 * so a first pass can choose what fits and center it in the visible band.
 */
function layout(
  ctx: CanvasRenderingContext2D,
  card: ProgramsCard,
  top: number,
  draw: boolean,
  themes: "all" | "closer" | "none",
): number {
  const p = t.share.programs;
  const display = family("--display");
  const body = family("--body");
  const color = (id: string | null) => card.candidates.find((c) => c.id === id)?.color || NEUTRAL;
  const text = (
    s: string,
    x: number,
    y: number,
    font: string,
    fill: string,
    align: CanvasTextAlign = "left",
  ) => {
    if (!draw) return;
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
    ctx.textAlign = "left";
  };
  let y = top;

  // Kicker and question.
  text(p.kicker.toUpperCase(), P, y + 30, `600 34px ${display}`, MUTED);
  y += 54;
  ctx.font = `700 88px ${display}`;
  for (const line of wrap(ctx, p.question, INNER)) {
    text(line, P, y + 76, `700 88px ${display}`, INK);
    y += 90;
  }
  y += 24;

  // The result, on the closer candidate's color.
  ctx.font = `700 62px ${display}`;
  const head = wrap(ctx, card.headline, INNER - 88);
  const headH = head.length * 70 + 56;
  if (draw) {
    ctx.fillStyle = color(card.winner);
    rounded(ctx, P, y, INNER, headH, 30);
    ctx.fill();
  }
  head.forEach((line, k) => text(line, P + 44, y + 28 + 56 + k * 70, `700 62px ${display}`, "#ffffff"));
  y += headH + 22;

  // One panel per candidate: name, share, bar, count.
  for (const c of card.candidates) {
    const h = 214;
    const x = P + 40;
    const fill = c.color || NEUTRAL;
    if (draw) {
      ctx.fillStyle = PANEL;
      rounded(ctx, P, y, INNER, h, 30);
      ctx.fill();
      if (card.winner === c.id) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 6;
        rounded(ctx, P + 3, y + 3, INNER - 6, h - 6, 27);
        ctx.stroke();
      }
    }
    text(c.name, x, y + 76, `700 56px ${display}`, INK);
    ctx.font = `700 56px ${display}`;
    text(String(c.number), x + ctx.measureText(c.name).width + 16, y + 76, `600 44px ${display}`, MUTED);
    text(
      c.share === null ? "—" : `${Math.round(c.share * 100)}%`,
      P + INNER - 40,
      y + 100,
      `700 116px ${display}`,
      fill,
      "right",
    );
    if (draw) {
      ctx.fillStyle = TRACK;
      rounded(ctx, x, y + 120, INNER - 80, 26, 13);
      ctx.fill();
      if (c.share) {
        ctx.fillStyle = fill;
        rounded(ctx, x, y + 120, Math.max(26, (INNER - 80) * c.share), 26, 13);
        ctx.fill();
      }
    }
    text(c.answered ? p.count(c.agreed, c.answered) : p.none, x, y + 190, `36px ${body}`, INK_2);
    y += h + 18;
  }

  // Where each came closer.
  if (themes !== "none") {
    y += 18;
    for (const g of groups(card, themes === "all")) {
      if (draw) {
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.arc(P + 13, y + 22, 13, 0, 2 * Math.PI);
        ctx.fill();
      }
      text(g.label, P + 40, y + 34, `700 40px ${display}`, INK);
      y += 52;
      ctx.font = `34px ${body}`;
      for (const line of wrap(ctx, g.names.join(" · "), INNER - 40)) {
        text(line, P + 40, y + 34, `34px ${body}`, INK_2);
        y += 46;
      }
      y += 16;
    }
  }
  y += 14;

  // The invitation, with the address and the source.
  const footH = 196;
  if (draw) {
    ctx.fillStyle = INK;
    rounded(ctx, P, y, INNER, footH, 30);
    ctx.fill();
  }
  text(p.invite, P + 40, y + 70, `700 56px ${display}`, "#ffffff");
  ctx.font = `600 38px ${body}`;
  const url = shortUrl(window.location.href);
  text(url, P + 40, y + 124, `600 38px ${body}`, "#ffffff");
  text(p.source, P + 40, y + 172, `30px ${body}`, "#aab0b9");
  y += footH;
  return y - top;
}

/** The card as a PNG. */
export async function programsImage(card: ProgramsCard): Promise<Blob> {
  // The canvas draws with whatever font is loaded: wait for the page's.
  const display = family("--display");
  const body = family("--body");
  await Promise.all(
    [`700 88px ${display}`, `600 44px ${display}`, `34px ${body}`, `600 38px ${body}`].map((f) =>
      document.fonts?.load(f).catch(() => undefined),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // As much as fits in the visible band: every theme, then only who came closer, then none.
  const room = SAFE_BOTTOM - SAFE_TOP;
  const themes =
    (["all", "closer", "none"] as const).find((k) => layout(ctx, card, 0, false, k) <= room) ?? "none";
  const height = layout(ctx, card, 0, false, themes);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // Each candidate's color along both edges, in the parts the status covers.
  const band = W / Math.max(1, card.candidates.length);
  card.candidates.forEach((c, k) => {
    ctx.fillStyle = c.color || NEUTRAL;
    ctx.fillRect(k * band, 0, band, 18);
    ctx.fillRect(k * band, H - 18, band, 18);
  });
  ctx.textBaseline = "alphabetic";
  layout(ctx, card, SAFE_TOP + Math.max(0, (room - height) / 2), true, themes);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"),
  );
}
