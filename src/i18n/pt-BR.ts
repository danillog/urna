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

  views: {
    polls: {
      eyebrow: "Eleições no Brasil · pesquisas agregadas",
      headline: "Evolução das intenções de voto",
      lede: "Cada ponto é uma pesquisa publicada. A linha é a média suavizada de todas elas e a faixa mostra a dispersão típica entre institutos. O losango na data da eleição marca o resultado oficial.",
    },
    americas: {
      eyebrow: "Américas · eleições nacionais desde 2000",
      headline: "A política das Américas, ano a ano",
      lede: "Cada país pintado pela família ideológica de quem venceu sua última eleição nacional: presidente, ou primeiro-ministro nos países parlamentaristas. Dê play para ver as ondas de esquerda e de direita atravessando o continente.",
    },
    map: {
      eyebrow: "Eleições no Brasil · resultados oficiais do TSE",
      headline: "O voto em cada município",
      lede: "Quem venceu em cada um dos 5.570 municípios, de 1994 até hoje, para presidente e para prefeito. Dê play para ver o mapa mudar de cor eleição a eleição, ou clique num partido para acompanhá-lo no tempo.",
    },
  },
  americasTitle: (year: number) => `Quem governava as Américas em ${year}`,
  americasAria: (year: number) =>
    `Mapa das Américas em ${year}, por família ideológica do vencedor da última eleição`,
  americasWhole: "Américas inteiras",
  americasNoResult: "Sem resultado: território, eleição anulada ou sem eleições competitivas",
  americasTerritory: "Território dependente, sem eleição nacional própria",
  americasNonCompetitive: "Sem eleições presidenciais competitivas",
  americasNoElectionYet: (year: number) => `Nenhuma eleição desde ${year} até este ano`,
  americasAnnulled: "A última eleição foi anulada",
  americasHere: "resultado neste estado/província",
  americasNational: (winner: string, family: string) => `No país: ${winner} (${family})`,
  americasNationalOnly: "Sem dados por estado/província: o país inteiro mostra o resultado nacional",
  americasRegionSource: (source: string) =>
    source === "TSE"
      ? "Fonte: TSE"
      : `Fonte: Wikipédia (${source.startsWith("es:") ? "espanhol" : "inglês"}), ${source.slice(3)}`,
  americasDisputed: "Resultado oficial contestado pela oposição e por observadores internacionais",
  americasElection: (system: string, date: string) =>
    `${system === "parliamentary" ? "Eleição geral (primeiro-ministro)" : system === "general" ? "Eleição geral (presidente)" : "Eleição presidencial"} de ${date}`,
  family: {
    left: "Esquerda",
    "centre-left": "Centro-esquerda",
    "centre-right": "Centro-direita",
    right: "Direita",
  } as Record<string, string>,
  mapTitlePresident: (year: number, round: string) => `Presidente · ${year} · ${round}`,
  mapTitleMayor: (year: number) => `Prefeitos eleitos em ${year}`,
  mapAria: (title: string) => `Mapa do resultado por município: ${title}`,
  mapMunicipalities: (n: string) => `${n} municípios com resultado`,
  mapMargin: (steps: string) => `Vantagem sobre o 2º colocado, em p.p.: ${steps}`,
  mapVotes: (n: string) => `${n} votos válidos`,
  mapMayorElected: (year: number) => `Prefeito eleito em ${year}`,
  mapUnopposed: "Candidato único",
  mapNoData: "Sem resultado nesta eleição: o município ainda não existia ou não elege prefeito",
  mapNoRunoff: "Eleição decidida no 1º turno",
  mapOthers: "Outros partidos",
  mapFocus: "Clique para destacar no mapa; clique de novo para voltar",
  mapPlay: "Reproduzir as eleições em sequência",
  mapPause: "Pausar",
  mapWholeCountry: "Brasil inteiro",
  mapZoomHint: "Ctrl + rolagem para aproximar",
  mapZoomHintMac: "⌘ + rolagem para aproximar",
  mapNotePresident:
    "Cor de quem venceu em cada município; quanto mais forte, maior a vantagem. Votos válidos apurados pelo TSE; votos do exterior não entram no mapa.",
  mapNoteMayor:
    "Cor do partido do prefeito eleito (resultado do 2º turno onde houve). Partidos que mudaram de nome mantêm a cor: PFL → DEM → União, PMDB → MDB, PPR → PPB → PP, PR → PL, PRB → Republicanos. Brasília e Fernando de Noronha não elegem prefeito.",

  stateSummary: (polls: number, office: string, state: string, pollsters: number) =>
    `${plural(polls, "pesquisa", "pesquisas")} de ${office} em ${state}, de ${plural(pollsters, "instituto", "institutos")}.`,
  fewPolls: " Com poucas pesquisas, a linha é pouco confiável: vale olhar os pontos um a um.",
  senateNote:
    "Em 2026 cada estado elege dois senadores e o eleitor vota duas vezes. Os números somam o 1º e o 2º voto e são reescalados para 100%, como Quaest, Datafolha, AtlasIntel e Real Time Big Data divulgam. Institutos que publicam a soma bruta dos dois votos (acima de 100%) ficaram de fora. Os dois mais votados são eleitos.",
  governorRunoffNote:
    "Simulação de 2º turno entre os dois nomes mais testados. Pode não acontecer se alguém vencer no 1º turno com mais da metade dos votos válidos.",
  foldedNote: (names: string) => `"Outros" inclui ${names} e os demais candidatos.`,
};
