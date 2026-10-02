/** Interface copy. Everything the page writes at runtime lives here. */

import type { MethodFilter } from "../state";
import type { Office, RoundId } from "../types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const t = {
  locale: "pt-BR",
  months: ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"],
  office: { president: "Presidente", governor: "Governador", senate: "Senador" } satisfies Record<
    Office,
    string
  >,
  officeLower: { president: "presidente", governor: "governador", senate: "senador" } satisfies Record<
    Office,
    string
  >,
  round: { r1: "1º turno", r2: "2º turno" } satisfies Record<RoundId, string>,
  method: {
    in_person: "Presencial",
    phone: "Telefone",
    online: "Online",
    unknown: "Não classificado",
  } satisfies Record<MethodFilter, string>,
  series: { others: "Outros", undecided: "BNI" } as Record<string, string>,
  seriesLong: { others: "Outros", undecided: "Brancos, nulos e indecisos" } as Record<string, string>,

  showAll: "Mostrar todos",
  noRunoffSenate: "Senado não tem 2º turno",
  noRunoffPolls: "Sem pesquisas de 2º turno neste estado",
  state: (name: string, uf: string) => `${name} (${uf})`,

  chartTitlePresident: (year: string, round: string, date: string) =>
    `${year} · ${round} · eleição em ${date}`,
  chartTitleState: (office: string, state: string, round: string | null, date: string) =>
    `${office} · ${state} · ${round ? `${round} · ` : ""}eleição em ${date}`,
  chartMeta: (polls: number, pollsters: number, from: string, to: string) =>
    `${plural(polls, "pesquisa", "pesquisas")} · ${plural(pollsters, "instituto", "institutos")} · ${from} a ${to}`,
  chartAria: (title: string) => `Gráfico de intenção de voto: ${title}`,
  noPolls: "Nenhuma pesquisa com esse filtro.",
  electionOn: (date: string) => `eleição em ${date}`,
  legendPoll: "Pesquisa",
  legendResult: "Resultado oficial (válidos)",
  tooltipInterviews: (n: string) => `${n} entrevistas`,
  tooltipAverage: "Média das pesquisas",

  highlighting: (pollster: string, polls: number, method: string) =>
    `Destacando <b>${pollster}</b> · ${plural(polls, "pesquisa", "pesquisas")} · ${method}`,
  clearHighlight: "Limpar destaque",

  compareTitleResult: "Média final × resultado das urnas",
  compareTitleCurrent: "Média atual",
  compareHead: ["Candidato", "Média final", "Em válidos", "Urna", "Urna − média"],
  compareHeadCurrent: ["Candidato", "Média atual", "Em válidos"],
  compareNoteResult: "Média no último dia antes da eleição, com os institutos e métodos selecionados.",
  compareNoteCurrent: (day: string, election: string) =>
    `Média em ${day}, com os institutos e métodos selecionados. A eleição é em ${election}; o resultado entra aqui depois da apuração.`,
  compareValidOnly: " Aqui a fonte já traz votos válidos.",
  compareNoUndecided: " Esta seleção não tem BNI na fonte, então não dá para converter para votos válidos.",
  compareUndecided: (v: string) => ` BNI na média: ${v}.`,

  accuracyTitle: "Quem chegou mais perto",
  accuracyNote:
    "Última pesquisa de cada instituto até 10 dias antes da eleição, comparada com a urna. Clique num instituto para destacar os pontos dele no gráfico.",
  accuracyEmpty: "Nenhum instituto selecionado tem pesquisa nos 10 dias antes da eleição.",
  accuracyHead: ["#", "Instituto", "Método", "Última", "Erro médio", "Erro na margem"],
  historyTitle: "Histórico dos institutos",
  historyNote: (year: string, from: string, to: string) =>
    `Ainda não há resultado para ${year}. A tabela mostra o erro médio que cada instituto que pesquisa agora teve na última pesquisa antes das eleições presidenciais de ${from} a ${to}, considerando 1º e 2º turnos. Clique para destacar os pontos no gráfico.`,
  historyHead: ["#", "Instituto", "Método", "Turnos", "Erro médio", "Erro na margem"],

  pollsHead: ["Instituto", "Data", "Amostra"],

  mapAria: (title: string) => `Mapa do resultado por município: ${title}`,
  mapWins: (candidate: string, n: string) => `${candidate} venceu em ${n}`,
  mapMargin: (steps: string) => `Vantagem sobre o 2º colocado, em p.p.: ${steps}`,
  mapVotes: (n: string) => `${n} votos válidos`,
  mapNoData: "Município criado depois desta eleição",

  stateSummary: (polls: number, office: string, state: string, pollsters: number) =>
    `${plural(polls, "pesquisa", "pesquisas")} de ${office} em ${state}, de ${plural(pollsters, "instituto", "institutos")}.`,
  fewPolls: " Com poucas pesquisas, a linha é pouco confiável: vale olhar os pontos um a um.",
  senateNote:
    "Em 2026 cada estado elege dois senadores e o eleitor vota duas vezes. Os números somam o 1º e o 2º voto e são reescalados para 100%, como Quaest, Datafolha, AtlasIntel e Real Time Big Data divulgam. Institutos que publicam a soma bruta dos dois votos (acima de 100%) ficaram de fora. Os dois mais votados são eleitos.",
  governorRunoffNote:
    "Simulação de 2º turno entre os dois nomes mais testados. Pode não acontecer se alguém vencer no 1º turno com mais da metade dos votos válidos.",
  foldedNote: (names: string) => `"Outros" inclui ${names} e os demais candidatos.`,
};
