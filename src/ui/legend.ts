import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import type { View } from "../model/view";
import { UNDECIDED } from "../types";
import { byId, colorOf } from "./dom";

export function renderLegend(view: View): void {
  const { race } = view;
  const items = view.order.map((series) => {
    const color = colorOf(race, series);
    const swatch =
      series === UNDECIDED
        ? `<i class="sw dash"></i>`
        : race.dashed.includes(series)
          ? `<i class="sw" style="background:repeating-linear-gradient(90deg,${color} 0 5px,transparent 5px 8px)"></i>`
          : `<i class="sw" style="background:${color}"></i>`;
    const party = race.parties[series]
      ? ` <span class="party">${escapeHtml(race.parties[series])}</span>`
      : "";
    return `<span>${swatch}${escapeHtml(t.seriesLong[series] ?? series)}${party}</span>`;
  });
  items.push(`<span><i class="sw dot"></i>${t.legendPoll}</span>`);
  if (view.hasResult) items.push(`<span><i class="sw diamond"></i>${t.legendResult}</span>`);
  byId("legend").innerHTML = items.join("");
}
