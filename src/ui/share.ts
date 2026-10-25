/**
 * "Compartilhar": turns a panel's chart or map into a PNG card (title, figure,
 * legend, source and the page's address) and hands it to the phone's share sheet,
 * or downloads it where there is none.
 *
 * The figures are SVG styled by CSS classes and theme variables, which an SVG drawn
 * on its own cannot see; so each one is cloned with its computed styles written in,
 * then drawn onto a canvas.
 */

import { t } from "../i18n/pt-BR";

/** Where each shareable panel keeps its parts (ids in index.html). */
export interface ShareSpec {
  title: string;
  meta?: string;
  /** Boxes holding the figure's SVG; several are laid side by side. */
  figures: string[];
  legends: string[];
  sources?: string;
  /** Source line for panels without a sources paragraph. */
  sourceText?: () => string;
  /** File name: urna-<name>.png. */
  name: string;
  /** Drawn by script after load (the party modal), not in index.html. */
  dynamic?: true;
  /** Text lines for a card without a figure (a profile): each wrapped to the card's width. */
  lines?: () => string[];
  /** A card drawn its own way, instead of from the panel's parts (the quiz result). */
  render?: () => Promise<Blob>;
  /** Text sent along with the image: what the share sheet's apps use as the caption. */
  text?: () => string;
}

export const SHARES: Record<string, ShareSpec> = {
  polls: {
    title: "chart-title",
    meta: "chart-meta",
    figures: ["chart"],
    legends: ["legend"],
    sourceText: () => t.share.pollsSource,
    name: "pesquisas",
  },
  apuracao: {
    title: "ap-title",
    figures: ["ap-map"],
    legends: ["ap-legend"],
    sources: "ap-sources",
    name: "apuracao",
  },
  congress: {
    title: "cg-title",
    meta: "cg-meta",
    figures: ["cg-chart"],
    legends: ["cg-legend"],
    sources: "cg-sources",
    name: "congresso",
  },
  map: {
    title: "map-title",
    meta: "map-meta",
    figures: ["map"],
    legends: ["map-legend"],
    sources: "map-sources",
    name: "mapa",
  },
  census: {
    title: "cv-title",
    meta: "cv-meta",
    figures: ["cv-scatter", "cv-map"],
    legends: ["cv-scatter-legend", "cv-map-legend"],
    sources: "cv-sources",
    name: "voto-e-censo",
  },
  where: {
    title: "wh-title",
    meta: "wh-meta",
    figures: ["wh-map"],
    legends: ["wh-legend"],
    sources: "wh-sources",
    name: "quem-mora-onde",
  },
  capital: {
    title: "cp-title",
    meta: "cp-meta",
    figures: ["cp-scatter", "cp-map"],
    legends: ["cp-scatter-legend", "cp-map-legend"],
    sources: "cp-sources",
    name: "capital",
  },
  gap: {
    title: "cv-gap-title",
    figures: ["cv-gap"],
    legends: ["cv-gap-legend"],
    sources: "cv-sources",
    name: "evolucao",
  },
  profile: {
    title: "pp-name",
    meta: "pp-sub",
    figures: [],
    legends: [],
    lines: () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#pp-profile .pp-facts > div, #pp-profile .pp-mandate > li",
        ),
      ].map((el) =>
        // A fact is "label: value"; a term line is its first sentence, without the notes under it.
        el.matches("div")
          ? [...el.children].map((c) => c.textContent!.trim()).join(": ")
          : [...el.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent)
              .join("")
              .trim(),
      ),
    sourceText: () => t.share.profileSource,
    name: "perfil",
    dynamic: true,
  },
  party: {
    title: "cg-modal-title",
    meta: "pm-sub",
    figures: ["pm-seats-chamber", "pm-ideology"],
    legends: [],
    sources: "pm-sources",
    name: "partido",
    dynamic: true,
  },
  // Drawn by the quiz once there is a result (share-programs.ts).
  programs: {
    title: "pg-quiz-title",
    figures: [],
    legends: [],
    text: () => t.share.programs.caption(window.location.href),
    name: "programas",
    dynamic: true,
  },
  americas: {
    title: "am-title",
    figures: ["am-map"],
    legends: ["am-legend"],
    sources: "am-sources",
    name: "americas",
  },
};

/** Presentation properties written onto every cloned SVG element. */
const PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linejoin",
  "stroke-linecap",
  "opacity",
  "visibility",
  "display",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "vector-effect",
] as const;

/** A copy of an SVG with every element's computed style written in, sized as shown. */
export function standalone(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [clone, ...clone.querySelectorAll("*")];
  from.forEach((el, k) => {
    const style = getComputedStyle(el);
    const target = to[k] as SVGElement;
    target.removeAttribute("class");
    target.setAttribute("style", PROPS.map((p) => `${p}:${style.getPropertyValue(p)}`).join(";"));
  });
  const box = svg.getBoundingClientRect();
  clone.setAttribute("width", String(Math.round(box.width) || 600));
  clone.setAttribute("height", String(Math.round(box.height) || 400));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

/** The SVG shown in a figure box (a capital's map box keeps the hidden ones of others). */
export function shownSvg(box: HTMLElement): SVGSVGElement | null {
  return (
    [...box.querySelectorAll<SVGSVGElement>(":scope > svg, :scope > div > svg")].find(
      (s) => !s.closest("[hidden]") && !s.closest(".tooltip"),
    ) ?? null
  );
}

function image(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const text = new XMLSerializer().serializeToString(standalone(svg));
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Text broken into lines that fit a width. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A legend's swatches and words, in reading order, with their computed colors. */
type LegendItem = { swatch: string; ring: string; alpha: number } | { line: string } | { text: string };

function legendItems(el: HTMLElement): LegendItem[] {
  const out: LegendItem[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent!.replace(/\s+/g, " ").trim();
      if (text) out.push({ text });
      return;
    }
    // Controls inside a legend ("Limpar") and hints on using it ("Clique para…") are not part
    // of the key: an image cannot be clicked.
    if (
      !(node instanceof HTMLElement) ||
      node.hidden ||
      node.dataset.focus === "clear" ||
      node.dataset.shareSkip !== undefined
    )
      return;
    if (node.tagName === "I") {
      const s = getComputedStyle(node);
      // A line key: no height, only a top border.
      if (parseFloat(s.height) === 0 && parseFloat(s.borderTopWidth) > 0) {
        out.push({ line: s.borderTopColor });
        return;
      }
      const ring = /inset 0px 0px 0px [\d.]+px (\S+(?:\([^)]*\))?)/.exec(s.boxShadow)?.[1] ?? "";
      out.push({
        swatch: s.backgroundColor,
        ring: ring || s.borderTopColor,
        alpha: parseFloat(s.opacity) || 1,
      });
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

const SCALE = 2;
const WIDTH = 1200;
const PAD = 40;

/** Draws the card for a panel; resolves to a PNG. */
export async function panelImage(spec: ShareSpec): Promise<Blob> {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  const surface = color("--surface", "#fff");
  const ink = color("--ink", "#14171c");
  const muted = color("--muted", "#7d838d");
  const display = root.getPropertyValue("--display").trim() || "sans-serif";
  const body = root.getPropertyValue("--body").trim() || "sans-serif";

  const svgs = spec.figures
    .map((id) => document.getElementById(id))
    .map((box) => (box ? shownSvg(box) : null))
    .filter((s): s is SVGSVGElement => s !== null);
  const images = await Promise.all(svgs.map(image));
  const text = (id?: string) =>
    id ? (document.getElementById(id)?.textContent ?? "").replace(/\s+/g, " ").trim() : "";

  // Measure first, on a scratch canvas, then draw at the final height.
  const scratch = document.createElement("canvas").getContext("2d")!;
  const inner = WIDTH - 2 * PAD;
  scratch.font = `700 34px ${display}`;
  const titleLines = wrap(scratch, text(spec.title), inner);
  scratch.font = `18px ${body}`;
  const metaLines = wrap(scratch, text(spec.meta), inner);
  const gap = 24;
  const each = (inner - gap * (images.length - 1)) / Math.max(1, images.length);
  const figH = Math.max(0, ...images.map((img) => (img.height / img.width) * each));
  const sourceText = text(spec.sources) || spec.sourceText?.() || "";
  scratch.font = `15px ${body}`;
  const sourceLines = wrap(scratch, sourceText, inner).slice(0, 3);
  const legends = spec.legends.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);

  const layoutLegend = (ctx: CanvasRenderingContext2D, draw: boolean, y0: number): number => {
    ctx.font = `15px ${body}`;
    let y = y0;
    for (const el of legends) {
      let x = PAD;
      for (const item of legendItems(el)) {
        const w = "text" in item ? ctx.measureText(item.text).width + 8 : "line" in item ? 26 : 18;
        if (x + w > WIDTH - PAD) {
          x = PAD;
          y += 24;
        }
        if (draw) {
          if ("text" in item) {
            ctx.fillStyle = ink;
            ctx.fillText(item.text, x, y + 14);
          } else if ("line" in item) {
            ctx.fillStyle = item.line;
            ctx.fillRect(x, y + 7, 20, 3);
          } else {
            const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(item.swatch);
            if (!transparent) {
              ctx.globalAlpha = item.alpha;
              ctx.fillStyle = item.swatch;
              ctx.fillRect(x, y + 2, 13, 13);
              ctx.globalAlpha = 1;
            }
            if (transparent && item.ring) {
              ctx.strokeStyle = item.ring;
              ctx.lineWidth = 2;
              ctx.strokeRect(x + 1, y + 3, 11, 11);
            }
          }
        }
        x += w;
      }
      y += 28;
    }
    return y;
  };

  scratch.font = `17px ${body}`;
  const textLines = (spec.lines?.() ?? []).filter(Boolean).map((l) => wrap(scratch, l, inner));
  const linesH = textLines.reduce((h, l) => h + l.length * 24 + 8, 0);
  let height = PAD + titleLines.length * 42 + (metaLines.length ? 8 + metaLines.length * 24 : 0) + 20;
  height += figH + 16 + linesH;
  height = layoutLegend(scratch, false, height) + 12;
  height += sourceLines.length * 20 + 28 + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.ceil(height) * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = "alphabetic";

  let y = PAD;
  ctx.fillStyle = ink;
  ctx.font = `700 34px ${display}`;
  for (const line of titleLines) {
    y += 36;
    ctx.fillText(line, PAD, y);
    y += 6;
  }
  if (metaLines.length) {
    y += 8;
    ctx.fillStyle = muted;
    ctx.font = `18px ${body}`;
    for (const line of metaLines) {
      y += 20;
      ctx.fillText(line, PAD, y);
      y += 4;
    }
  }
  y += 20;
  images.forEach((img, k) => {
    const h = (img.height / img.width) * each;
    ctx.drawImage(img, PAD + k * (each + gap), y, each, h);
  });
  y += figH + 16;
  ctx.fillStyle = ink;
  ctx.font = `17px ${body}`;
  for (const block of textLines) {
    for (const line of block) {
      y += 20;
      ctx.fillText(line, PAD, y);
      y += 4;
    }
    y += 8;
  }
  y = layoutLegend(ctx, true, y) + 12;
  ctx.strokeStyle = muted;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(WIDTH - PAD, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = muted;
  ctx.font = `15px ${body}`;
  for (const line of sourceLines) {
    y += 20;
    ctx.fillText(line, PAD, y);
  }
  y += 28;
  ctx.fillStyle = ink;
  ctx.font = `600 16px ${body}`;
  ctx.fillText(t.share.footer(shortUrl(window.location.href)), PAD, y);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"),
  );
}

/** The address without the scheme: what people would type. */
export const shortUrl = (href: string) => href.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Shares the card through the system sheet when it takes files, else downloads it. */
export async function sharePanel(key: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const spec = SHARES[key]!;
  const blob = await (spec.render?.() ?? panelImage(spec));
  const file = new File([blob], `urna-${spec.name}.png`, { type: "image/png" });
  const title = document.getElementById(spec.title)?.textContent ?? "";
  if (navigator.canShare?.({ files: [file] })) {
    try {
      const text = spec.text?.();
      await navigator.share({ files: [file], title, ...(text ? { text } : { url: window.location.href }) });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}

/** Wires every "Compartilhar" button ([data-share] in index.html). */
export function setupShare(): void {
  // Delegated: the party modal's button is drawn after the page loads.
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-share]");
    if (!b || b.disabled) return;
    void (async () => {
      const label = b.textContent;
      b.disabled = true;
      b.textContent = t.share.working;
      try {
        const how = await sharePanel(b.dataset.share!);
        b.textContent = how === "downloaded" ? t.share.downloaded : label;
      } catch {
        b.textContent = t.share.failed;
      } finally {
        b.disabled = false;
        setTimeout(() => (b.textContent = label), 2000);
      }
    })();
  });
}
