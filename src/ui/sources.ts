import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";

/** A study, dataset or page a view's numbers come from. */
export interface SourceLink {
  label: string;
  url: string;
}

/** "Fontes: A · B · C", each a link that opens in a new tab. */
export function sourcesHtml(links: SourceLink[]): string {
  const items = links.map(
    (l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`,
  );
  return `<span class="sources-h">${t.sourcesHeading}</span> ${items.join(" · ")}`;
}
