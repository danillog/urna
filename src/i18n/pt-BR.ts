/** Interface copy. Everything the page writes at runtime lives here. */

import type { ApOffice } from "../model/apuracao";
import type { House } from "../model/congress";
import type { MethodFilter } from "../state";
import type { Office, RoundId } from "../types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dec = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");

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

  pageTitle: "Pesquisas eleitorais 2026 e o mapa do voto | Urna",
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
    apuracao: {
      eyebrow: "Eleições 2026 · apuração ao vivo",
      headline: "Apuração ao vivo",
      lede: "Os votos contados pelo TSE para presidente, governador, senador e deputados, atualizados sozinhos a cada minuto. O mapa pinta cada cidade (ou cada estado, no seletor) com quem está na frente ali; quanto mais forte a cor, maior a vantagem. Clique num estado para ver os números dele.",
    },
    congress: {
      eyebrow: "Congresso Nacional · 1990 a 2026",
      headline: "Quem ocupa as cadeiras do Congresso",
      lede: "Cada bolinha é uma cadeira, da esquerda para a direita conforme a posição do partido naquela época, medida por pesquisas acadêmicas. Dê play para ver a Câmara e o Senado mudarem eleição a eleição; passe o mouse num partido para ver as cadeiras e de onde vem a classificação dele.",
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
  indicator: {
    hdi: {
      name: "IDH",
      title: (year: number) => `Índice de Desenvolvimento Humano em ${year}`,
      format: (v: number) => v.toFixed(3).replace(".", ","),
      step: (from: number, to?: number) =>
        from === 0 ? "< 0,55" : to === undefined ? `≥ ${dec(from, 2)}` : `${dec(from, 2)}–${dec(to, 2)}`,
      unit: "Índice de 0 a 1",
    },
    income: {
      name: "Renda mediana",
      title: (year: number) => `Poder de compra: renda mediana por pessoa em ${year}`,
      format: (v: number) => `US$ ${Math.round(v).toLocaleString("pt-BR")}/mês`,
      step: (from: number, to?: number) =>
        from === 0
          ? "< US$ 150"
          : to === undefined
            ? `≥ US$ ${from.toLocaleString("pt-BR")}`
            : `${from}–${to}`,
      unit: "Por pessoa, por mês, em dólares PPC de 2021",
    },
    democracy: {
      name: "Democracia eleitoral",
      title: (year: number) => `Índice de democracia eleitoral em ${year}`,
      format: (v: number) => v.toFixed(2).replace(".", ","),
      step: (from: number, to?: number) =>
        from === 0 ? "< 0,1" : to === undefined ? `≥ ${dec(from, 1)}` : `${dec(from, 1)}–${dec(to, 1)}`,
      unit: "Índice de 0 a 1",
    },
  },
  hdiTier: {
    low: "Desenvolvimento humano baixo (PNUD)",
    medium: "Desenvolvimento humano médio (PNUD)",
    high: "Desenvolvimento humano alto (PNUD)",
    veryHigh: "Desenvolvimento humano muito alto (PNUD)",
  },
  indicatorRegionName: { hdi: "IDHM" } as Record<string, string>,
  indicatorCountry: (v: string, year: number) => `País (IDH do PNUD, ${year}): ${v}`,
  indicatorNoData: "Sem dados na fonte",
  indicatorSource: (source: string) => `Fonte: ${source}`,
  indicatorLatest: (year: number) => `Último dado disponível: ${year}`,
  indicatorThen: (v: string, year: number) => `Em ${year}: ${v}`,
  indicatorUrbanOnly: "A pesquisa deste país cobre só as áreas urbanas",
  indicatorRank: (position: number, total: number) =>
    `${position}º de ${total} países das Américas com dados`,
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
  mapTitleIdhm: (year: number, estimate: boolean) =>
    estimate
      ? `IDH dos municípios em ${year}: estimativa com o Censo`
      : `IDH dos municípios no Censo de ${year}`,
  mapNoteIdhm:
    "IDHM do Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP), via Ipeadata, calculado com os Censos de 1991, 2000 e 2010, os anos que o Ipeadata publica por município. Faixas finas de 0,05; a categoria oficial aparece ao passar o mouse.",
  mapNoteIdhmEstimate: (error: string) =>
    "Atenção: não é o IDHM oficial. O Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP) ainda não publicou o IDHM municipal do Censo de 2022; " +
    "este mapa é uma compilação nossa com as tabelas do Censo 2022 publicadas pelo IBGE, seguindo a metodologia do Atlas com aproximações: " +
    "renda domiciliar per capita corrigida pelo INPC; escolaridade dos adultos e frequência escolar por idade; longevidade estimada pela mortalidade dos filhos (método indireto) e pela renda. " +
    `Calibrado no Censo de 2010, o mesmo cálculo erra em média ${error} para mais ou para menos em relação ao IDHM oficial; o nível de cada estado segue o IDHM estadual oficial de 2022. ` +
    "Os valores podem mudar quando o dado oficial sair.",
  mapIdhmEstimate: "Estimativa nossa com o Censo 2022, não é o dado oficial",
  mapIdhmNoData: "Município criado depois deste Censo",
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

  apuracao: {
    title: (office: string, round: string | null, place: string) =>
      `${office} · ${round ? `${round} · ` : ""}${place}`,
    office: {
      presidente: "Presidente",
      governador: "Governador",
      senador: "Senador",
      "deputado-federal": "Deputado federal",
      "deputado-estadual": "Deputado estadual",
    } satisfies Record<ApOffice, string>,
    noRunoff: "Este cargo não tem 2º turno",
    byState: "Quem lidera em cada estado",
    cut: (seats: number) => `Linha de corte: ${seats} vagas`,
    ofVotes: "dos votos",
    seatsWord: (n: number) => (n === 1 ? "cadeira" : "cadeiras"),
    seatsTotal: (n: number) => `${n} cadeiras em disputa`,
    seatsProjected: (n: number) => `${n} cadeiras · projeção com os votos apurados até agora`,
    seatsOfficial: (n: number) => `${n} cadeiras · distribuição do TSE`,
    inSeat: "Na vaga",
    electedHeading: (official: boolean) =>
      official ? "Eleitos, por partido ou federação" : "Quem fica com as cadeiras, por partido ou federação",
    leftOut: "Mais votados que ficaram de fora",
    listVotes: (votes: string, seats: number) =>
      `${votes} votos da legenda · ${seats} ${seats === 1 ? "cadeira" : "cadeiras"}`,
    puller: "Puxador",
    pulled: "Puxado",
    pulledSummary: (n: number, name: string, party: string, votes: string, quotient: string) =>
      `Quociente eleitoral: ${quotient} votos. "Puxador" teve votos suficientes para uma cadeira sozinho. ` +
      (n
        ? `${n} ${n === 1 ? "eleito teve" : "eleitos tiveram"} menos votos que ${name} (${party}, ${votes} votos), o mais votado entre os que ficaram de fora: ${n === 1 ? "entrou puxado" : "entraram puxados"} pelos votos do partido ou federação.`
        : `Nenhum eleito teve menos votos que ${name} (${party}, ${votes} votos), o mais votado entre os que ficaram de fora.`),
    clickToSee: "Clique para ver este estado",
    brazil: "Brasil",
    counted: (pct: string) => `${pct} das urnas apuradas`,
    votes: (n: string) => `${n} votos`,
    totals: (blank: string, nulls: string, turnout: string) =>
      `Brancos: ${blank} · Nulos: ${nulls} · Comparecimento: ${turnout}`,
    majority: "50% dos válidos: vence no 1º turno",
    status: {
      loading: "Carregando…",
      waiting: "Aguardando",
      live: "Ao vivo",
      done: "Apuração encerrada",
      error: "Sem conexão",
      sim: "Simulação",
      test: "Teste: capitais 2024",
    },
    waiting:
      "A apuração começa às 17h de Brasília, quando fecham as urnas. Deixe a página aberta: ela se atualiza sozinha.",
    noData: "O TSE ainda não publicou dados deste turno.",
    updated: (time: string) => `Dados do TSE de ${time}`,
    simUpdated: (time: string) => `Simulado às ${time}`,
    retrying: (time: string) => `Sem resposta do TSE agora; mostrando os dados de ${time}. Tentando de novo.`,
    notConfigured: "Apuração ao vivo indisponível nesta versão da página.",
    simNote:
      "Apuração inventada, para testar a página: nenhum número aqui é real nem previsão. Tire ?simular=1 do endereço para ver a apuração de verdade.",
    testNote:
      "Teste com dados reais de 2024: cada estado mostra a eleição para prefeito da capital (o DF não elege prefeito).",
    testNoteCouncil:
      "Teste com dados reais de 2024: a eleição para vereador da capital do estado, que segue as mesmas regras dos deputados (o DF não tem vereadores).",
    note: "Votos válidos, como o TSE divulga: brancos e nulos não entram na porcentagem.",
    noteProportional:
      "Deputados são eleitos pelo sistema proporcional: as cadeiras vão para os partidos e federações pelo quociente eleitoral, e cada um as preenche com seus mais votados. Até o TSE divulgar a distribuição oficial, as cadeiras são uma projeção nossa com as regras da lei e os votos apurados até agora; elas mudam conforme a apuração avança.",
    mapAria: (title: string) => `Mapa da apuração por estado: ${title}`,
    states: (n: number) => `${n} ${n === 1 ? "estado" : "estados"}`,
    cities: (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "cidade" : "cidades"}`,
    mapAriaCities: (title: string) => `Mapa da apuração por município: ${title}`,
    noCities: "Sem resultado por cidade para este cargo: os deputados são vistos por estado",
    citiesNote: (time: string) =>
      `O mapa por cidade é um retrato dos arquivos de cada município no TSE${time ? ` de ${time}` : ""}, e não se atualiza sozinho como o resto da página; os números ao lado são os de agora.`,
    validVotes: (n: string) => `${n} votos válidos`,
    statusTag: {
      Eleito: "Eleito",
      "2º turno": "2º turno",
      "Eleito por QP": "Eleito por QP",
      "Eleito por média": "Eleito por média",
      Suplente: "Suplente",
      "Não eleito": "",
    } as Record<string, string>,
  },

  sourcesHeading: "Fontes:",
  sources: {
    tseResults: { label: "TSE: resultados da apuração", url: "https://resultados.tse.jus.br/" },
    tseOpenData: {
      label: "TSE: dados abertos (votação por município)",
      url: "https://dadosabertos.tse.jus.br/",
    },
    ibgeMesh: {
      label: "IBGE: malha municipal",
      url: "https://servicodados.ibge.gov.br/api/docs/malhas?versao=3",
    },
    atlas: {
      label: "Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP)",
      url: "https://www.atlasbrasil.org.br/",
    },
    ipeadata: { label: "Ipeadata", url: "http://www.ipeadata.gov.br/" },
    census2022: {
      label: "IBGE: Censo 2022 (SIDRA)",
      url: "https://sidra.ibge.gov.br/pesquisa/censo-demografico/demografico-2022/inicial",
    },
    zuccoPower: {
      label:
        "Zucco e Power (2024), The Ideology of Brazilian Parties and Presidents, Latin American Politics and Society",
      url: "https://doi.org/10.1017/lap.2023.24",
    },
    zuccoPowerData: {
      label: "Estimativas por partido e por pesquisa, 1990–2021 (Harvard Dataverse)",
      url: "https://doi.org/10.7910/DVN/6KVTUV",
    },
    bolognesi: {
      label:
        "Bolognesi, Ribeiro e Codato (2023), Uma nova classificação ideológica dos partidos políticos brasileiros, Dados",
      url: "https://doi.org/10.1590/dados.2023.66.2.303",
    },
    seats: (year: number) => ({
      label: `Cadeiras em ${year}: Wikipédia (números do TSE)`,
      url:
        year === 1990
          ? "https://en.wikipedia.org/wiki/1990_Brazilian_legislative_election"
          : `https://en.wikipedia.org/wiki/${year}_Brazilian_general_election`,
    }),
    senateOpenData: {
      label: "Senado Federal: dados abertos (senadores em exercício)",
      url: "https://legis.senado.leg.br/dadosabertos/docs/",
    },
  },

  congress: {
    // The Chamber is elected whole; the Senate renews a third or two thirds.
    title: (house: House, year: number) =>
      house === "chamber"
        ? `Câmara dos Deputados eleita em ${year}`
        : `Senado Federal após a eleição de ${year}`,
    projection: "projeção",
    meta: (total: number, majority: number) => `${total} cadeiras · maioria absoluta: ${majority}`,
    aria: (title: string) => `Hemiciclo: ${title}, uma bolinha por cadeira, da esquerda para a direita`,
    group: {
      left: "Esquerda",
      "centre-left": "Centro-esquerda",
      centre: "Centro",
      "centre-right": "Centro-direita",
      right: "Direita",
      none: "Sem classificação",
    } as Record<string, string>,
    seats: (n: number) => `${n} ${n === 1 ? "cadeira" : "cadeiras"}`,
    position: "Posição",
    party: "Partido",
    seatsHead: "Cadeiras",
    score: (v: number) => {
      const text = Math.abs(v).toFixed(2).replace(".", ",");
      return text === "0,00" ? text : `${v > 0 ? "+" : "−"}${text}`;
    },
    trajectory: "Trajetória (↑ direita)",
    trajectoryAria: (party: string) =>
      `Posição do ${party} em cada eleição: quanto mais alto, mais à direita`,
    source: (source: string | null) =>
      !source
        ? "Partido fora das pesquisas usadas: sem classificação"
        : source === "bolognesi"
          ? "Bolognesi, Ribeiro e Codato (2023), pesquisa com cientistas políticos em 2018, convertida para a escala de Zucco e Power"
          : source.startsWith("mean:")
            ? `Fusão: média de ${source.slice(5).replace("+", " e ")} na última pesquisa`
            : `Zucco e Power, pesquisa com parlamentares de ${source.slice(4)}`,
    firstSeen: (year: number, score: string, group: string) => `Em ${year}: ${score} (${group})`,
    provisional:
      "2026: o TSE ainda não divulgou os deputados eleitos. As cadeiras da Câmara são nossa projeção pelo quociente eleitoral com os votos apurados; no Senado entram os dois mais votados de cada estado e os 27 eleitos em 2022, pelo partido atual de cada um.",
    note: "Posição de cada partido: estimativas de Zucco e Power (2024), feitas com as pesquisas em que deputados e senadores classificam todos os partidos de −1 (esquerda) a +1 (direita), de 1990 a 2021. Cada eleição usa a pesquisa feita durante o mandato que ela elegeu (2022 e 2026 usam a de 2021); se o partido não estava nela, usa-se a pesquisa vizinha, até 4 anos de distância. Partidos fora dessa pesquisa usam Bolognesi, Ribeiro e Codato (2023), convertido para a mesma escala; fusões (União Brasil, PRD) usam a média dos partidos que as formaram. Os cinco grupos são cortes nossos em −0,5, −0,15, +0,15 e +0,5; MDB e PSDB ficam perto do corte do centro, então mudam de grupo com pouca variação. A Câmara mostra a bancada eleita; o Senado, a casa inteira depois da eleição. Cadeiras: TSE, via Wikipédia, e o Senado Federal.",
    play: "Reproduzir",
    pause: "Pausar",
    centrao: "Centrão",
    legendHint: "Clique para destacar; dá para combinar vários",
    clear: "Limpar",
    selected: (seats: number, total: number, majority: boolean) =>
      `Selecionados: ${seats} de ${total} cadeiras (${Math.round((seats / total) * 100)}%) · ${majority ? "têm" : "não têm"} maioria absoluta`,
    centraoTip: (outlet: string, year: string) => `Núcleo do Centrão segundo ${outlet} (${year})`,
    centraoSource: (outlet: string, title: string) => `Centrão: ${outlet}, ${title}`,
    centraoNote: (since: number, outlet: string) =>
      `O Centrão não é uma posição de esquerda ou direita, e sim um jeito de agir: partidos que apoiam o governo da vez, seja ele qual for, em troca de cargos e verbas. Não tem registro oficial e muda de composição, por isso só aparece a partir de ${since}, com o núcleo listado pelo ${outlet}; marcar partidos de décadas atrás com a lista de hoje seria anacronismo.`,
  },

  stateSummary: (polls: number, office: string, state: string, pollsters: number) =>
    `${plural(polls, "pesquisa", "pesquisas")} de ${office} em ${state}, de ${plural(pollsters, "instituto", "institutos")}.`,
  fewPolls: " Com poucas pesquisas, a linha é pouco confiável: vale olhar os pontos um a um.",
  senateNote:
    "Em 2026 cada estado elege dois senadores e o eleitor vota duas vezes. Os números somam o 1º e o 2º voto e são reescalados para 100%, como Quaest, Datafolha, AtlasIntel e Real Time Big Data divulgam. Institutos que publicam a soma bruta dos dois votos (acima de 100%) ficaram de fora. Os dois mais votados são eleitos.",
  governorRunoffNote:
    "Simulação de 2º turno entre os dois nomes mais testados. Pode não acontecer se alguém vencer no 1º turno com mais da metade dos votos válidos.",
  foldedNote: (names: string) => `"Outros" inclui ${names} e os demais candidatos.`,
};
