import { escapeHtml } from "../format";
import { t } from "../i18n/pt-BR";
import type { AppState } from "../state";
import type { Dataset, Race } from "../types";
import { byId } from "./dom";

/** Below this many polls the context card warns that the line is shaky. */
const FEW_POLLS = 5;

const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;

function stateParagraphs(data: Dataset, race: Race, s: AppState): string[] {
  const st = data.states[s.uf]!;
  const pollsters = new Set(race.polls.map((p) => p.p)).size;
  const parts = [
    t.stateSummary(race.polls.length, t.officeLower[s.office], st.name, pollsters) +
      (race.polls.length < FEW_POLLS ? t.fewPolls : ""),
  ];
  if (s.office === "senate") parts.push(t.senateNote);
  if (s.office === "governor" && s.round === "r2") parts.push(t.governorRunoffNote);
  if (race.folded?.length && s.round === "r1") parts.push(t.foldedNote(race.folded.join(", ")));
  if (st.note) parts.push(st.note);
  return parts;
}

export function renderContext(data: Dataset, race: Race, s: AppState): void {
  const parts =
    s.office === "president"
      ? [data.presidential[s.year]!.context, ...race.notes]
      : stateParagraphs(data, race, s);
  byId("ctx").innerHTML = parts.map(paragraph).join("");
}
