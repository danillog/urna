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
  firstRoundMark: "1º turno",
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

  programs: {
    steps: [
      "Leia a proposta. O cartão não diz de quem é.",
      "Concorde ou discorde. Se não souber, pule.",
      "No fim, veja de qual programa você ficou mais perto e de quem era cada proposta.",
    ],
    // No count on the button: a number there could be read as a ballot number.
    start: "Começar",
    introNote:
      "Metade de cada programa, tiradas dos programas registrados no TSE. Suas respostas não saem do seu aparelho.",
    browse: "Só quero ver as propostas",
    progress: (n: number, total: number) => `${n} de ${total}`,
    agree: "Concordo",
    disagree: "Discordo",
    skip: "Pular",
    keys: "No teclado: → concordo, ← discordo, ↓ pular. No celular, arraste o cartão.",
    finishNow: "Ver o resultado agora",
    back: "Voltar um cartão",
    cardAria: (n: number, total: number, theme: string) => `Proposta ${n} de ${total}, tema ${theme}`,
    resultTitle: "Seu resultado",
    reveal: "Ver de quem era cada proposta",
    resultCloser: (name: string) => `Você concordou mais com o programa de ${name}.`,
    resultTie: "Empate: você concordou com a mesma proporção de propostas dos dois programas.",
    resultNone: "Você não concordou nem discordou de nenhuma proposta, então não há resultado.",
    resultBar: (agreed: number, answered: number, name: string) =>
      `Concordou com ${agreed} de ${answered} propostas de ${name} que respondeu`,
    resultNoAnswer: (name: string) => `Nenhuma proposta de ${name} respondida`,
    byTheme: "Tema por tema",
    themeCloser: (name: string) => `mais perto de ${name}`,
    themeTie: "empate",
    themeNone: "sem resposta dos dois lados",
    themeOneSide: "você pulou as propostas de um dos lados",
    caveat:
      "Isto compara o que você pensa com o que está escrito nos programas, não com o que cada um vai conseguir fazer: muitas propostas dependem do Congresso. Também não mede tudo o que importa num voto, como o histórico de cada candidato.",
    again: "Fazer de novo",
    allNote:
      "Cada proposta com quem a fez e o trecho do programa, com o link para a página. Ao lado, a sua resposta.",
    yours: { agree: "você concordou", disagree: "você discordou", skip: "você pulou" } as Record<
      string,
      string
    >,
    readPage: (page: number) => `ler no programa, p. ${page}`,
    debatesNote:
      "Promessas feitas nos debates de TV que não estão nos programas registrados. Ficam fora do quiz. Cada uma traz a fala como foi dita, tirada da transcrição automática do YouTube e conferida no vídeo (correções da transcrição entre colchetes), e o link para o minuto exato no vídeo da emissora. Entram só temas em que os dois prometeram algo, com o mesmo número de promessas de cada lado. O site não checou se as promessas são viáveis nem se os números citados estão certos.",
    debateDate: (date: string) => {
      const [y, m, d] = date.split("-");
      return `${d}/${m}/${y}`;
    },
    watchAt: (time: string) => `▶ ver no vídeo, ${time}`,
    agreeNote:
      "Propostas que os dois programas fazem. Ficaram fora do quiz, porque não ajudam a diferenciar um do outro.",
    number: (n: number) => `Número ${n}`,
    vice: "Vice",
    coalition: "Partidos",
    program: (pages: number) => `Programa de governo registrado no TSE (PDF, ${pages} páginas)`,
    channels: "Perfis oficiais",
    channel: {
      site: "Site",
      instagram: "Instagram",
      x: "X",
      youtube: "YouTube",
      tiktok: "TikTok",
      facebook: "Facebook",
    } as Record<string, string>,
    method: (fetched: string, themes: number, each: number) => [
      `Fonte única: os programas de governo que cada candidatura registrou no TSE, baixados dos dados abertos do tribunal em ${fetched}. Promessas feitas depois, em debates, entrevistas e propaganda, não estão aqui.`,
      `Em cada um dos ${themes} temas, o mesmo número de propostas de cada programa: ${each} de cada no total. Nenhuma contagem é igual ao número de um candidato na urna. Entraram as propostas mais concretas de cada tema em que os programas diferem, ou que só um deles faz. O que os dois propõem ficou na lista à parte.`,
      "Cada cartão resume o trecho em palavras simples, sem adjetivos. Uma verificação automática confere que cada trecho citado está, palavra por palavra, na página indicada do PDF registrado.",
      "Os cartões aparecem em ordem sorteada, alternando os dois programas, para que a sequência não entregue o autor.",
      "O resultado é a proporção de propostas de cada programa com que você concordou, entre as que respondeu. Nada do que você responde sai do seu navegador: o site não guarda nem envia as respostas.",
      "Vice, partidos e perfis vêm dos arquivos de candidaturas e de redes sociais do TSE. Dos perfis declarados, aparecem só os do próprio candidato nas seis redes maiores, pelo mesmo critério para os dois.",
    ],
    sources: "Fontes",
  },

  errorsTitle: "E se as pesquisas errarem como antes?",
  errorsNote: (leader: string, margin: string) =>
    `Hoje a média dá ${leader} à frente por ${margin} dos votos válidos. Cada linha aplica a essa margem o erro que a média final das pesquisas teve numa eleição passada, para os dois lados: ninguém sabe de antemão para onde as pesquisas vão errar. Não é previsão nem chance de vitória; são erros que já aconteceram.`,
  errorsHead: (leader: string, runnerUp: string) => [
    "Se errarem como em",
    "Erro na margem",
    "A média subestimou",
    `A favor de ${leader}`,
    `A favor de ${runnerUp}`,
  ],
  errorsRound: (round: RoundId, year: number) => `${round === "r1" ? "1º" : "2º"} turno de ${year}`,
  errorsWins: (name: string, margin: string) => `${name} por ${margin}`,
  errorsTie: "empate",
  errorsSummary: (bigger: number, total: number, runnerUp: string) =>
    bigger === 0
      ? `Nenhum dos ${total} erros passados é maior que a margem de hoje.`
      : `${bigger} dos ${total} erros passados são maiores que a margem de hoje: um erro desse tamanho a favor de ${runnerUp} viraria o resultado. São poucas eleições, e os institutos mudam o método depois de cada erro: o próximo pode ser maior, menor ou ir para o outro lado.`,

  accuracyTitle: "Quem chegou mais perto",
  accuracyNote:
    "Última pesquisa de cada instituto até 10 dias antes da eleição, comparada com a urna. Clique num instituto para destacar os pontos dele no gráfico.",
  accuracyEmpty: "Nenhum instituto selecionado tem pesquisa nos 10 dias antes da eleição.",
  accuracyHead: ["#", "Instituto", "Método", "Última", "Erro médio", "Erro na margem"],
  historyTitle: "Histórico dos institutos",
  historyNote: (year: string, from: string, to: string) =>
    `Ainda não há resultado para ${year}. A tabela mostra o erro médio que cada instituto que pesquisa agora teve na última pesquisa antes das eleições presidenciais de ${from} a ${to}, considerando 1º e 2º turnos. Clique para destacar os pontos no gráfico.`,
  historyHead: ["#", "Instituto", "Método", "Turnos", "Erro médio", "Erro na margem"],
  historyWeightHead: "Peso na média",

  pollsHead: ["Instituto", "Data", "Amostra"],

  pageTitle: "Pesquisas eleitorais 2026 e o mapa do voto | Urna",
  loading: "Carregando…",
  loadFailed: "Não foi possível carregar os dados. Verifique a conexão e recarregue a página.",
  views: {
    home: {
      eyebrow: "Urna · eleições e política no Brasil",
      headline: "Eleições e política, explicadas com dados",
      lede: "Pesquisas, resultados, o Congresso, os gastos dos parlamentares e o perfil das cidades, com os dados oficiais do TSE, da Câmara, do Senado e do IBGE. Escolha uma pergunta para começar.",
    },
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
    programs: {
      eyebrow: "Eleições 2026 · 2º turno · programas de governo",
      headline: "O que cada programa propõe",
      lede: "As propostas do Lula e do Flávio Bolsonaro, tiradas dos programas que cada um registrou no TSE. Responda sem saber de quem é cada uma e veja no fim de qual programa você ficou mais perto.",
    },
    apuracao: {
      eyebrow: "Eleições 2026 · apuração ao vivo",
      headline: "Apuração ao vivo",
      lede: "Os votos contados pelo TSE para cada cargo. No mapa, cada cidade tem a cor de quem está na frente ali; quanto mais forte a cor, maior a vantagem. Clique num estado para ver os números dele.",
    },
    congress: {
      eyebrow: "Congresso Nacional · 1990 a 2026",
      headline: "Quem ocupa as cadeiras do Congresso",
      lede: "Cada bolinha é uma cadeira, da esquerda para a direita conforme o partido. Aperte ▶ para ver o Congresso mudar desde 1990, ou clique num partido para conhecê-lo.",
    },
    people: {
      eyebrow: "Eleições 2026 · quem foi eleito",
      headline: "De onde vêm os eleitos",
      lede: "Quem foi eleito em 2026 para governador, senador e deputado federal: quem é estreante, quem volta e de onde vem. Clique num nome para ver a trajetória e o contato do gabinete.",
    },
    watch: {
      eyebrow: "De olho · gastos e presença",
      headline: "Quem gasta mais e quem mais falta",
      lede: "Deputados federais, senadores, deputados estaduais de SP e vereadores de São Paulo: os 10 que mais gastaram da verba do gabinete, os 10 que menos gastaram, os 10 que menos compareceram e os 10 que mais compareceram. Tudo com os números oficiais de cada casa, contados só enquanto a pessoa estava no cargo.",
    },
    census: {
      eyebrow: "Voto e Censo · municípios, 1994 a 2026",
      headline: "Quem vota em quem, pelo perfil das cidades",
      lede: "Cada ponto é uma cidade. Escolha uma característica, como renda, religião ou escolaridade, e veja se as cidades onde ela é maior votam diferente, eleição a eleição desde 1994.",
    },
    where: {
      eyebrow: "Quem mora onde · Censo 2022, dentro das 27 capitais",
      headline: "Onde moram mais idosos, negros, ricos ou evangélicos",
      lede: "Escolha uma característica e uma capital: o mapa mostra, bairro a bairro, onde mora mais e menos gente com ela, sobre o mapa das ruas, e a lista põe tudo em ordem. Toque num lugar para ver todos os números dele ao lado dos da cidade.",
    },
    map: {
      eyebrow: "Eleições no Brasil · resultados oficiais do TSE",
      headline: "O voto em cada município",
      lede: "Quem venceu em cada um dos 5.570 municípios, para presidente desde 1994 e para prefeito desde 1996. Aperte ▶ para ver o mapa mudar, ou clique num partido para segui-lo no tempo.",
    },
  },
  americasTitle: (year: number) => `Quem governava as Américas em ${year}`,
  americasAria: (year: number) =>
    `Mapa das Américas em ${year}, por família ideológica do vencedor da última eleição`,
  americasWhole: "Américas inteiras",
  compareRemove: (name: string) => `Tirar ${name} da comparação`,
  compareFull: "Já são 6 países: tire um para incluir outro.",
  compareNoData: "sem dado",
  compareFrom: (year: number) => `dado de ${year}`,
  compareFallback: "pesquisa antiga ou de consumo",
  compareRow: (name: string, value: string, note: string) => `${name}: ${value}${note ? ` (${note})` : ""}`,
  compareLines: (layer: string, from: number, to: number) =>
    `${layer} de ${from} a ${to}. Passe o mouse, arraste o dedo de lado ou use as setas para ler cada ano.`,
  compareGoverned: (from: number, to: number) => `Família política de quem governava, de ${from} a ${to}`,
  compareStrip: (name: string, cells: string) => `${name}: ${cells}`,
  /** Under the timeline, when a layer starts after 2000. */
  spanNoteFood: "A FAO mede a insegurança alimentar desde 2014–2016: cada ano é a média de três.",
  spanNote: (name: string, year: number) => `${name}: a série começa em ${year}.`,
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
    poverty: {
      name: "Pobreza",
      title: (year: number) => `Pobreza em ${year}: pessoas com menos de US$ 8,30 por dia`,
      format: (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      step: (from: number, to?: number) =>
        from === 0 ? "< 5%" : to === undefined ? `≥ ${from}%` : `${from}–${to}%`,
      unit: "% da população, linha de US$ 8,30 por dia (PPC de 2021)",
    },
    food: {
      name: "Insegurança alimentar moderada ou grave",
      title: (year: number) => `Insegurança alimentar moderada ou grave em ${year}`,
      format: (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      step: (from: number, to?: number) =>
        from === 0 ? "< 5%" : to === undefined ? `≥ ${from}%` : `${from}–${to}%`,
      unit: "% da população, média de 3 anos (FAO)",
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
  indicatorFallbackKey: "pesquisa antiga ou de consumo",
  indicatorFallbackConsumption: (year: number) =>
    `Pesquisa de consumo de ${year}: este país não tem pesquisa de renda recente, e o Banco Mundial mede a pobreza pelo consumo onde falta a renda`,
  indicatorFallbackOld: (year: number) =>
    `Último dado: ${year}, mais antigo que o dos outros países; mostrado esmaecido`,
  indicatorOfficial: (v: string, year: number) => `Taxa oficial dos EUA neste estado (${year}): ${v}`,
  indicatorOfficialNote:
    "Pela linha de pobreza americana, várias vezes mais alta que a do Banco Mundial: serve para comparar os estados entre si, não com o resto do continente. A cor do mapa é a do país, pela linha do Banco Mundial.",
  foodPeriod: (year: number) => `Média de ${year - 1}–${year + 1}, mostrada no ano do meio`,
  foodNotYet: (year: number) => `A FAO só mede a insegurança alimentar a partir de ${year - 1}–${year + 1}`,
  foodBelowFloor: "Abaixo do piso que a FAO publica (2,5%)",
  foodUsState: (period: string, v: string) => `USDA, ${period}: ${v} dos domicílios em insegurança alimentar`,
  foodBrState: (period: string, v: string) =>
    `IBGE (EBIA), ${period}: ${v} dos domicílios em insegurança moderada ou grave`,
  foodStateEarlier: (rows: string) => `Antes: ${rows}`,
  foodUsNote:
    "Escala e base (domicílios) do USDA, diferentes das da FAO: compara os estados entre si, não com outros países. O USDA encerrou a série em 2025; o último relatório cobre até 2024. A cor do mapa é a do país, pela FAO.",
  foodBrNote:
    "Escala e base (domicílios) do IBGE, diferentes das da FAO: compara os estados entre si, não com outros países. A cor do mapa é a do país, pela FAO.",
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
  mapTable: {
    caption: (n: number, uf: string) =>
      `${n.toLocaleString("pt-BR")} municípios de ${uf}, em ordem alfabética`,
    byState: "Municípios vencidos por estado (escolha um estado para ver cada município)",
    place: "Município",
    winner: "Venceu",
    second: "Segundo",
    votes: "Votos válidos",
  },
  mapCredit:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>',
  mapKeys: "Teclado: + e − aproximam e afastam, as setas movem o mapa, 0 mostra tudo",
  mapZoomHintMac: "⌘ + rolagem para aproximar",
  mapNotePresident:
    "Cor de quem venceu em cada município; quanto mais forte, maior a vantagem. Votos válidos apurados pelo TSE; votos do exterior não entram no mapa.",
  mapNoteResultsSite:
    "Resultado oficial do TSE por município, lido do site de resultados: o arquivo de dados abertos da eleição ainda não trazia os votos para presidente.",
  mapNoteMayor:
    "Cor do partido do prefeito eleito (resultado do 2º turno onde houve). Partidos que mudaram de nome mantêm a cor: PFL → DEM → União, PMDB → MDB, PPR → PPB → PP, PR → PL, PRB → Republicanos. Brasília e Fernando de Noronha não elegem prefeito.",

  apuracao: {
    pollAverage: (v: string) => `média das pesquisas: ${v}`,
    pollAverageNote: (date: string) =>
      `Traço fino na barra: a média final das pesquisas, em votos válidos (pesquisas até ${date}). Pesquisa é retrato, não previsão.`,
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
    noChoiceTitle: "Quem não escolheu ninguém",
    noChoice: {
      valid: "Votaram em alguém",
      nulls: "Anularam",
      blank: "Votaram em branco",
      absent: "Não foram votar",
    },
    noChoiceOf: {
      nulls: (pct: string) => `${pct} dos votos`,
      blank: (pct: string) => `${pct} dos votos`,
      absent: (pct: string) => `${pct} do eleitorado`,
    },
    stepUpTo: (x: string) => `até ${x}`,
    stepAbove: (x: string) => `mais de ${x}`,
    noChoiceLegend: {
      nulls: "Votos nulos",
      blank: "Votos em branco",
      absent: "Abstenção",
    },
    noChoiceAria: (electorate: string) =>
      `O eleitorado das urnas apuradas (${electorate} pessoas): quem votou em alguém, em branco, anulou e não foi votar`,
    noChoiceNote:
      "Nulos e brancos são parte dos votos dados, mas não contam para ninguém: o resultado sai só dos votos válidos. Nulos incluem os votos em candidatos cuja candidatura foi anulada. Abstenção: eleitores das urnas já apuradas que não compareceram.",
    mapAriaNoChoice: (title: string, what: string) => `${title}: mapa por ${what.toLowerCase()}`,
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

  theme: {
    mode: { auto: "Automático", light: "Claro", dark: "Escuro" } as Record<"auto" | "light" | "dark", string>,
    aria: (now: string, next: string) => `Tema: ${now.toLowerCase()}. Clique para ${next.toLowerCase()}.`,
  },
  share: {
    button: "Compartilhar",
    aria: (what: string) => `Compartilhar como imagem: ${what}`,
    working: "Gerando…",
    downloaded: "Imagem baixada",
    failed: "Não deu certo",
    pollsSource:
      "Fontes: pesquisas dos institutos, compiladas da Wikipédia e das divulgações; resultados oficiais do TSE",
    profileSource:
      "Fontes: TSE (candidaturas e resultados), Câmara e Senado (dados abertos), Wikidata. Detalhes e links no site.",
    americasSource:
      "Fontes: resultados das eleições na Wikipédia (Brasil: TSE); família ideológica: Global Party Survey 2019 e Wikipédia; contornos: Natural Earth",
    programs: {
      kicker: "Teste às cegas · 2º turno 2026",
      question: "Com qual programa eu concordo mais?",
      count: (agreed: number, answered: number) => `Concordei com ${agreed} de ${answered}`,
      none: "Nenhuma respondida",
      // First person, like the rest of the card: it is the reader who posts it.
      closer: (name: string) => `Concordei mais com ${name}`,
      tie: "Deu empate entre os dois",
      closerIn: (name: string) => `Mais perto de ${name} em`,
      tieIn: "Empate em",
      invite: "Faça o teste você também",
      source: "Propostas dos programas registrados no TSE",
      caption: (url: string) => `Fiz o teste às cegas dos programas do Lula e do Flávio. Faça o seu: ${url}`,
    },
    footer: (url: string) => `Veja e explore em ${url}`,
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
    atlasData: {
      label:
        "Atlas do Desenvolvimento Humano no Brasil, via Ipeadata (renda, ensino superior e população, 1991–2010)",
      url: "http://www.ipeadata.gov.br/",
    },
    sidraReligion: {
      label: "IBGE/SIDRA: religião por município (tabelas 137 e 9537)",
      url: "https://sidra.ibge.gov.br/tabela/9537",
    },
    sidra2022: {
      label: "IBGE/SIDRA: Censo 2022, renda (10295), escolaridade (10061) e população (9514)",
      url: "https://sidra.ibge.gov.br/tabela/10295",
    },
    ibgeAreas: {
      label: "IBGE: Censo 2022, resultados da amostra por área de ponderação",
      url: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Microdados_e_Areas_de_Ponderacao/",
    },
    ibgeTracts: {
      label: "IBGE: setores censitários 2022 com atributos",
      url: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/",
    },
    tsePlaces: {
      label: "TSE, dados abertos: locais de votação 2026, com coordenadas (eleitorado_local_votacao)",
      url: "https://dadosabertos.tse.jus.br/",
    },
    tseBallots: {
      label: "TSE: boletins de urna por seção, 1º turno de 2026",
      url: "https://resultados.tse.jus.br/oficial/app/index.html",
    },
    wikidata: { label: "Wikidata: cargos, redes sociais e Wikipédia", url: "https://www.wikidata.org/" },
    googleNews: {
      label: "Google Notícias (busca automática)",
      url: "https://news.google.com/?hl=pt-BR&gl=BR&ceid=BR:pt-419",
    },
    tseCandidates: {
      label: "TSE, dados abertos: candidatos 2010–2026",
      url: "https://dadosabertos.tse.jus.br/",
    },
    camaraOrientations: {
      label: "Câmara dos Deputados: orientações de bancada nas votações, 2003–2026",
      url: "https://dadosabertos.camara.leg.br/swagger/api.html#staticfile",
    },
    camaraOpenData: {
      label: "Câmara dos Deputados: dados abertos (deputados)",
      url: "https://dadosabertos.camara.leg.br/",
    },
    senateOpenData: {
      label: "Senado Federal: dados abertos (senadores em exercício)",
      url: "https://legis.senado.leg.br/dadosabertos/docs/",
    },
    globalPartySurvey: {
      label: "Global Party Survey 2019 (Norris): famílias ideológicas",
      url: "https://www.globalpartysurvey.org/",
    },
    naturalEarth: {
      label: "Natural Earth: contornos (domínio público)",
      url: "https://www.naturalearthdata.com/",
    },
    undpHdr: {
      label: "PNUD: Relatório de Desenvolvimento Humano 2025 (IDH)",
      url: "https://hdr.undp.org/data-center/documentation-and-downloads",
    },
    worldBankPip: {
      label: "Banco Mundial: Poverty and Inequality Platform",
      url: "https://pip.worldbank.org/",
    },
    faoFies: {
      label: "FAO: insegurança alimentar (FIES, ODS 2.1.2), FAOSTAT",
      url: "https://www.fao.org/faostat/en/#data/FS",
    },
    usdaFoodSecurity: {
      label: "USDA: Household Food Security in the United States in 2024",
      url: "https://www.ers.usda.gov/publications/pub-details?pubid=113622",
    },
    ibgeEbia: {
      label: "IBGE: segurança alimentar nos domicílios (EBIA), SIDRA",
      url: "https://sidra.ibge.gov.br/tabela/9552",
    },
    vdem: {
      label: "V-Dem: democracia eleitoral, via Our World in Data",
      url: "https://ourworldindata.org/grapher/electoral-democracy-index",
    },
    wikipediaElection: (article: string) => `Wikipédia: ${article}`,
    ibgeUniverse: {
      label: "IBGE: Censo 2022, agregados por setor censitário (cor ou raça, parentesco)",
      url: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/",
    },
    osm: {
      label: "OpenStreetMap: bairros de São Paulo (© colaboradores do OpenStreetMap, licença ODbL)",
      url: "https://www.openstreetmap.org/copyright",
    },
    spSubprefeituras: {
      label: "Prefeitura de São Paulo: subprefeituras e seus distritos (Lei 13.399/2002 e alterações)",
      url: "https://prefeitura.sp.gov.br/web/licenciamento/w/servicos/312207",
    },
    camaraMandate: {
      label: "Câmara: votações nominais, orientações, proposições e cota parlamentar, 2023–2026",
      url: "https://dadosabertos.camara.leg.br/swagger/api.html#staticfile",
    },
    senateMandate: {
      label: "Senado: votações nominais, orientações e autorias, 2023–2026",
      url: "https://legis.senado.leg.br/dadosabertos/docs/",
    },
    ceaps: {
      label: "Senado: cota para o exercício da atividade parlamentar (CEAPS)",
      url: "https://www12.senado.leg.br/transparencia/dados-abertos-transparencia/dados-abertos-ceaps",
    },
  },

  watch: {
    houseName: {
      camara: "Câmara dos Deputados",
      senado: "Senado Federal",
      alesp: "Assembleia Legislativa de SP (Alesp)",
      cmsp: "Câmara Municipal de São Paulo",
    } as Record<string, string>,
    intro: {
      camara: (since: string, until: string, n: number) =>
        `Os ${n} deputados federais em exercício hoje, de ${since} a ${until}: quanto gastaram da cota parlamentar e quantas sessões do plenário frequentaram. Clique num nome para ver os detalhes.`,
      senado: (since: string, until: string, n: number) =>
        `Os ${n} senadores em exercício hoje, de ${since} a ${until}: quanto gastaram da cota (CEAPS) e em quantas votações do plenário votaram. Clique num nome para ver os detalhes.`,
      alesp: (since: string, until: string, n: number) =>
        `Os ${n} deputados estaduais de São Paulo em exercício hoje, de ${since} a ${until}: quanto gastaram da verba de gabinete e quantas reuniões das suas comissões frequentaram. Clique num nome para ver os detalhes.`,
      cmsp: (since: string, until: string, n: number) =>
        `Os ${n} vereadores de São Paulo em exercício hoje, de ${since} a ${until}: quanto gastaram da verba de gabinete e quantas sessões do plenário frequentaram. Clique num nome para ver os detalhes.`,
    } as Record<string, (since: string, until: string, n: number) => string>,
    boards: {
      spendMost: "Quem mais gastou",
      spendLeast: "Quem menos gastou",
      presentLeast: "Quem menos compareceu",
      presentMost: "Quem mais compareceu",
    } as Record<string, string>,
    boardNote: {
      spendMost: (median: string) => `Média por mês no cargo. O típico na casa: ${median}.`,
      spendLeast: (median: string) => `Média por mês no cargo. O típico na casa: ${median}.`,
      presentLeast: (median: string) => `O típico na casa: ${median} de presença.`,
      presentMost: (median: string) => `O típico na casa: ${median} de presença.`,
    } as Record<string, (median: string) => string>,
    ofCap: (pct: string) => `${pct} do limite do estado`,
    inMonths: (n: number) => `em ${n} meses`,
    inAll: (n: number) => `no total, em ${n} meses`,
    nothing: "Nenhum reembolso",
    ofHeld: (attended: string, held: string) => `${attended} de ${held}`,
    none: "Sem dados para este filtro.",
    spendLine: (total: string, months: number, capPct: string | null) =>
      `${total} no total, em ${months} meses no cargo${capPct ? `: ${capPct} do limite mensal do estado dele` : ""}.`,
    versus: (median: string) => `O típico na casa: ${median} por mês.`,
    presenceLine: (attended: string, held: string, of: string) =>
      `Presente em ${attended} de ${held} ${of}, contadas só enquanto estava no cargo.`,
    versusPresence: (median: string) => `O típico na casa: ${median} de presença.`,
    rollCalls: (voted: string, held: string) => `Votou em ${voted} de ${held} votações nominais do plenário.`,
    noSpend: (n: number) => `Gasto: menos de ${n} meses no cargo, pouco para comparar.`,
    noPresence: "Presença: poucas sessões ou reuniões no período para comparar.",
    official: "Página oficial",
    profile: "Perfil de eleito em 2026",
    fair: "Os números são dos dados oficiais da casa. Presença não mede trabalho: um parlamentar pode faltar a uma sessão para cumprir outra tarefa do mandato. Gastar a cota é permitido; o que se compara aqui é quanto.",
    search: "Procure pelo nome",
    method: {
      camara:
        "<b>Como medimos.</b> <b>Gasto:</b> o que a Câmara reembolsou da cota parlamentar (CEAP), dividido pelos meses em que a pessoa estava no cargo. O limite muda por estado, porque inclui as passagens até Brasília, então o ranking compara a porcentagem do limite do próprio estado (Ato da Mesa nº 270/2023). <b>Presença:</b> sessões deliberativas do plenário em que a Câmara registrou a pessoa presente, contadas só enquanto estava no cargo (quem se licenciou, por exemplo para ser ministro, não leva falta nesse período). Quem tem menos de 6 meses no cargo ou menos de 20 sessões não entra no ranking. <b>O que não medimos:</b> “trabalho” não tem registro oficial; presença e gasto são só dois sinais. Fontes: dados abertos da Câmara (cota, eventos e presenças, histórico de cada deputado).",
      senado:
        "<b>Como medimos.</b> <b>Gasto:</b> o que o Senado reembolsou da cota (CEAPS), dividido pelos meses em que a pessoa estava no cargo. Não mostramos a porcentagem do limite: na tabela publicada pelo Senado, vários senadores passam de 100% na média, sinal de que ela não conta tudo. <b>Presença:</b> votações nominais do plenário em que votou, sem contar as ausências que o Senado registra como justificadas (licença, missão, atividade parlamentar). <b>O que não medimos:</b> “trabalho” não tem registro oficial. Fontes: dados abertos do Senado (votações e CEAPS).",
      alesp:
        "<b>Como medimos.</b> <b>Gasto:</b> a verba de gabinete reembolsada pela Alesp, dividida pelos meses com algum gasto. O limite é o mesmo para todos, então compara-se o valor. <b>Presença:</b> a Alesp não publica presença no plenário em dados abertos. O que ela publica é a presença nas reuniões das comissões permanentes: contamos as reuniões das comissões de que a pessoa era membro titular, no período em que era, e a quantas ela foi. Quem não é titular de nenhuma comissão (como o presidente da Casa) fica sem esse número. Fontes: dados abertos da Alesp (despesas de gabinete, membros e presenças das comissões).",
      cmsp: "<b>Como medimos.</b> <b>Gasto:</b> a verba de gabinete (auxílio-encargos) reembolsada pela Câmara Municipal, dividida pelos meses com algum gasto. O limite é o mesmo para todos, então compara-se o valor. <b>Presença:</b> sessões do plenário (ordinárias e extraordinárias) em que a Câmara registrou a pessoa presente, desde 2025. <b>O que não medimos:</b> “trabalho” não tem registro oficial. Fontes: dados abertos da Câmara Municipal (SPLegis, presenças em plenário; SisGV, despesas).",
    } as Record<string, string>,
  },
  people: {
    renew: {
      title: "Renovação: quem não estava no cargo",
      note: "Reeleito é quem já tinha sido eleito para o mesmo cargo, no mesmo estado, na eleição anterior (2022 para deputados e governadores, 2018 para senadores). Quem assumiu como suplente não conta como eleito. Governadores no 2º turno e os senadores eleitos em 2022 ficam de fora.",
      office: "Cargo",
      byParty: "Por partido",
      byState: "Por estado",
      elected: "Eleitos",
      reelected: "Reeleitos",
      rate: "Renovação",
      partyFor: (office: string) => `Por partido (${office})`,
      stateFor: (office: string) => `Por estado (${office})`,
    },
    defeated: {
      title: (n: number) => `${n} parlamentares tentaram 2026 e não se elegeram`,
      note: "Deputados e senadores em exercício (ou licenciados) que se candidataram em 2026 e não foram eleitos nem foram ao 2º turno, com o cargo que disputaram e os votos. Senadores eleitos em 2022 só voltam às urnas em 2030.",
      who: "Parlamentar",
      now: "Hoje",
      ranFor: "Disputou",
      votes: "Votos",
      result: "Resultado",
      house: { camara: "Deputado", senado: "Senador" } as Record<string, string>,
      none: "Ninguém com esse filtro.",
    },
    mandate: {
      watch: "Gasto e presença ao lado dos colegas (De olho) →",
      title: (house: string) => `No mandato atual: ${house}, desde fevereiro de 2023`,
      house: { camara: "Câmara", senado: "Senado" } as Record<string, string>,
      votes: (cast: string, held: string, pct: string) =>
        `Votou em ${cast} de ${held} votações nominais do plenário (${pct})`,
      votesFrom: (date: string) => `contadas a partir do primeiro voto no mandato, em ${date}`,
      justified: (n: string) => `${n} ausências justificadas (licença, missão ou atividade parlamentar)`,
      government: (pct: string, n: string) =>
        `Votou como o líder do governo orientou em ${pct} das ${n} votações disputadas`,
      position: (score: string, pct: string, house: string) =>
        `Posição pelos votos: ${score}, de −1 (o mais à esquerda) a +1 (o mais à direita) ${house === "senado" ? "do Senado" : "da Câmara"}; mais à direita que ${pct} ${house === "senado" ? "dos senadores" : "dos deputados"}`,
      committees: (titular: number, substitute: number) =>
        `Comissões hoje: titular em ${titular}, suplente em ${substitute}`,
      rapporteur: (n: string, house: string) =>
        house === "senado"
          ? `Relator de ${n} matérias desde 2023`
          : `Relator atual de ${n} projetos apresentados neste mandato (relatorias de projetos mais antigos não entram)`,
      speeches: (n: string) => `${n} discursos no plenário e nas comissões desde 2023`,
      speechesUnknown: "Discursos: a fonte não respondeu desta vez",
      keyTitle: (n: number) => `Votos em PEC e lei complementar neste mandato (${n} votações)`,
      keyNote:
        "Todas as votações nominais do plenário sobre proposta de emenda à Constituição (PEC) e projeto de lei complementar (PLP) desde 2023: as duas que exigem mais que maioria simples. O critério é esse, sem escolha nossa de quais importam. Passe o mouse sobre a proposição para ver a ementa.",
      keyDate: "Data",
      keyBill: "Proposição e o que se votou",
      keyVote: "Votou",
      keyGov: "Governo orientou",
      letters: {
        S: "Sim",
        N: "Não",
        O: "Obstrução",
        A: "Abstenção",
        V: "Votou (secreto)",
        "-": "—",
      } as Record<string, string>,
      positionNote:
        "Calculada só pelos votos nominais disputados deste mandato (veja o gráfico na aba Congresso). Neste mandato a linha mistura esquerda e direita com governo e oposição.",
      governmentNote:
        "Votações disputadas: alguma bancada orientou o contrário do governo. Obstrução conta como voto contra.",
      bills: (first: string, passed: string, law: string, house: string) =>
        `${first} projetos (PL, PLP, PEC) como primeiro autor; ${passed} aprovados ${house === "senado" ? "pelo Senado" : "pela Câmara"}; ${law} viraram lei`,
      allowance: (perMonth: string, total: string, months: string) =>
        `Cota parlamentar: ${perMonth} por mês, em média (${total} em ${months} meses com gasto)`,
      median: (value: string, who: string) => `mediana ${who}: ${value} por mês`,
      medianWho: (house: string, uf: string) =>
        house === "senado" ? "dos senadores" : `dos deputados de ${uf}`,
      topCategories: "Onde mais gastou",
      note: "Não existe registro oficial de horas ou dias trabalhados: o que há é a presença nas votações nominais. Projetos apresentados contam pouco sozinhos; por isso aparecem ao lado de quantos avançaram.",
    },
    legal: {
      title: "Processos criminais",
      grade: {
        investigado: "Investigado",
        reu: "Réu",
        "condenado-recorrivel": "Condenado, cabe recurso",
        "condenado-definitivo": "Condenado em definitivo",
        arquivado: "Inquérito arquivado",
        absolvido: "Absolvido",
      } as Record<string, string>,
      gradeLong: {
        investigado: "Há inquérito aberto: é investigado, não acusado.",
        reu: "A denúncia foi recebida: responde a ação penal, ainda sem julgamento.",
        "condenado-recorrivel": "Condenado, mas ainda cabe recurso.",
        "condenado-definitivo": "Condenado, sem recurso possível (trânsito em julgado).",
        arquivado: "Histórico: o inquérito foi arquivado.",
        absolvido: "Histórico: foi absolvido.",
      } as Record<string, string>,
      innocence:
        "Ninguém é considerado culpado até a condenação sem recurso possível (Constituição, art. 5º, LVII). Investigação e ação penal não são condenação.",
      method: (date: string) =>
        `Cada processo foi conferido à mão na página do próprio tribunal, com o mesmo critério para todos os partidos; última conferência em ${date}. Só aparecem os processos já conferidos: não ter nada listado aqui não quer dizer que não haja processo.`,
      since: (date: string) => `desde ${date}`,
      checked: (date: string) => `conferido em ${date}`,
      stale: "conferência com mais de seis meses: pode estar desatualizado",
      link: "Ver no tribunal",
    },
    office: {
      governador: "Governador",
      senador: "Senador",
      "deputado-federal": "Deputado federal",
      "deputado-estadual": "Deputado estadual",
      "deputado-distrital": "Deputado distrital",
      vereador: "Vereador",
      prefeito: "Prefeito",
      "vice-prefeito": "Vice-prefeito",
      "vice-governador": "Vice-governador",
      presidente: "Presidente",
      "vice-presidente": "Vice-presidente",
      "suplente-senador": "Suplente de senador",
    } as Record<string, string>,
    officeFeminine: {
      governador: "Governadora",
      senador: "Senadora",
      "deputado-federal": "Deputada federal",
      "deputado-estadual": "Deputada estadual",
      "deputado-distrital": "Deputada distrital",
      vereador: "Vereadora",
      prefeito: "Prefeita",
      "vice-prefeito": "Vice-prefeita",
      "vice-governador": "Vice-governadora",
      presidente: "Presidenta",
      "vice-presidente": "Vice-presidenta",
      "suplente-senador": "Suplente de senadora",
    } as Record<string, string>,
    officePlural: {
      governador: "governadores",
      senador: "senadores",
      "deputado-federal": "deputados federais",
    } as Record<string, string>,
    kind: {
      new: "Estreante",
      tried: "Já disputou, nunca eleito",
      appointed: "Já teve cargo nomeado",
      "other-office": "Já eleito para outro cargo",
      returning: "Volta ao mesmo cargo",
    } as Record<string, string>,
    kindLong: {
      new: "nenhuma candidatura desde 2010 e nenhum cargo público conhecido",
      tried: "disputou antes e não venceu",
      appointed: "nunca eleito, mas já foi ministro, secretário ou teve outro cargo público por nomeação",
      "other-office": "já teve outro mandato (vereador, prefeito, deputado estadual…)",
      returning: "já ocupou este cargo (reeleição ou retorno)",
    } as Record<string, string>,
    result: {
      elected: "Eleito",
      runoff: "2º turno",
      substitute: "Suplente",
      lost: "Não eleito",
      unfit: "Registro inapto no arquivo do TSE",
    } as Record<string, string>,
    status: {
      runoff: "Vai ao 2º turno",
      projected: "Projeção",
      staying: "Eleito em 2022, até 2031",
    } as Record<string, string>,
    all: "Todos",
    allUfs: "Todos os estados",
    allParties: "Todos os partidos",
    title: (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "eleito" : "eleitos"}`,
    meta: (deputies: boolean) =>
      deputies ? "TSE, 1º turno de 2026" : "TSE, 1º turno de 2026 · deputados por projeção",
    renewalAria: "Divisão dos eleitos por trajetória",
    share: (n: number, total: number) => `${n} (${Math.round((n / Math.max(1, total)) * 100)}%)`,
    warning:
      "Trajetória reconstruída com as candidaturas registradas no TSE desde 2010: mandatos anteriores a isso não aparecem. Deputados federais: até o TSE divulgar os eleitos, a lista é nossa projeção pelo quociente eleitoral; os nomes podem mudar.",
    listTitle: (n: number, total: number) =>
      n === total
        ? `${n.toLocaleString("pt-BR")} pessoas`
        : `${n.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`,
    more: (n: number) => `Mostrar mais ${n}`,
    none: "Ninguém com esses filtros.",
    close: "Fechar",
    age: (n: number) => `${n} anos na posse`,
    votes: (n: string, share: string) => `${n} votos (${share} dos válidos)`,
    facts: {
      from: "Naturalidade",
      education: "Escolaridade",
      occupation: "Profissão declarada",
      votes: "Votos em 2026",
      age: "Idade",
    },
    career: "Trajetória nas urnas",
    positions: "Cargos públicos",
    positionsNote:
      "Inclui cargos por nomeação (ministérios, secretarias), que não passam pelas urnas. Fonte: Wikidata.",
    years: (from: number | null, to: number | null) =>
      from && to ? `${from}–${to}` : from ? `desde ${from}` : to ? `até ${to}` : "",
    wikipedia: "Wikipédia",
    newsTitle: "Notícias recentes",
    newsAuto: (date: string) =>
      `Busca automática pelo nome entre aspas e o cargo, feita em ${date}; pode trazer homônimos.`,
    noNews: "Nenhuma notícia encontrada na busca automática.",
    moreNews: "Mais notícias",
    careerEmpty: (since: number) => `Nenhuma candidatura registrada no TSE entre ${since} e 2024.`,
    partyPath: (path: string) => `Partidos pelos quais concorreu: ${path}`,
    contact: "Contato do gabinete atual",
    contactNote: "Mandato 2023–2026 no Congresso; muda em fevereiro de 2027.",
    noContact: "Ainda sem gabinete no Congresso: o contato oficial sai depois da posse.",
    governorContact: "Governadores não têm um cadastro público de contato como o do Congresso.",
    email: "E-mail",
    phone: "Telefone",
    room: "Gabinete",
    site: "Site",
    networks: "Redes sociais",
    news: "Ver notícias",
    newsNote: "Abre a busca do Google Notícias com o nome, o cargo e o estado.",
    page: (house: string) => (house === "camara" ? "Página na Câmara" : "Página no Senado"),
    note: "Perfis: candidaturas do TSE de 2010 a 2026, ligadas entre eleições pelo título de eleitor (que não é publicado aqui, assim como o CPF). Cargos públicos (inclusive por nomeação), redes e Wikipédia: Wikidata, casado pelo nome e pela data de nascimento. Notícias: busca automática no Google Notícias. Idade na data da posse, naturalidade, escolaridade e profissão são as declaradas ao TSE. Resultado de cada candidatura como está nos arquivos do TSE; decisões judiciais posteriores podem não aparecer. Contato, site e redes: Câmara dos Deputados e Senado Federal, para quem já é parlamentar. Governadores no 2º turno aparecem os dois candidatos, até 25 de outubro.",
  },

  party: {
    open: (name: string) => `Abrir a história do ${name}`,
    names: "Nomes ao longo do tempo",
    govTitle: "Com o governo ou na oposição",
    govHouse: { chamber: "Câmara", senate: "Senado" } as Record<string, string>,
    elected2026: (party: string) => `Quem o ${party} elegeu em 2026: trajetória, contato e mandato`,
    senateNote: (since: string) =>
      `No Senado, o mesmo cálculo com as orientações dos líderes, que os dados abertos do Senado trazem a partir de ${since}.`,
    govNote: (base: number, opp: number) =>
      `Quanto o partido orientou sua bancada igual ao governo nas votações disputadas do plenário da Câmara (em que alguma bancada orientou contra o governo). A partir de ${base}%: base do governo; até ${opp}%: oposição; entre os dois, independente. Os cortes são nossos.`,
    stance: { base: "Base", independent: "Independente", opposition: "Oposição" } as Record<string, string>,
    pattern: {
      "always-base": "Votou com todos os governos, de esquerda e de direita: o perfil do Centrão.",
      "always-opposition": "Foi oposição a todos os governos do período.",
      switches: "Mudou de lado conforme o governo: base de uns, oposição de outros.",
      mixed: "Alternou entre base, independência e oposição.",
    } as Record<string, string>,
    noGov:
      "Sem votações suficientes na Câmara para medir (o partido não tinha bancada ou orientava só dentro de blocos).",
    seatsTitle: "Cadeiras por eleição",
    seatsAria: (house: string) => `Cadeiras do partido em cada eleição: ${house}`,
    ideologyTitle: "Posição de esquerda a direita",
    ideologyAria: "Posição do partido em cada eleição, de −1 (esquerda) a +1 (direita)",
    axis: { "1": "direita", "0": "centro", "-1": "esquerda" } as Record<string, string>,
    noIdeology: "Partido fora das pesquisas usadas: sem classificação.",
    note: "Governo e oposição: orientações de bancada registradas pela Câmara dos Deputados, 2003 a 2026, por mandato presidencial (Dilma 2 até o afastamento, em 12/05/2016; Temer a partir daí). Orientações de blocos e federações valem para os partidos que os compõem. Obstrução conta como voto contra. Cadeiras e posição: as mesmas fontes do hemiciclo.",
  },

  census: {
    vars: {
      income: "Renda média",
      incomeMedian: "Renda mediana",
      catholic: "Católicos",
      evangelical: "Evangélicos",
      noReligion: "Sem religião",
      otherReligion: "Outras religiões",
      eduBasic: "Até fundamental incompleto",
      eduFund: "Fundamental completo",
      eduMid: "Médio completo",
      degree: "Superior completo",
      illiterate: "Analfabetismo",
      population: "População",
      urban: "Urbanização",
      white: "Brancos",
      black: "Pretos",
      brown: "Pardos",
      asian: "Amarelos",
      indigenous: "Indígenas",
      negro: "Negros (pretos e pardos)",
      elderly: "Idosos (60+)",
      sameSex: "Casais do mesmo sexo",
      gini: "Desigualdade (Gini)",
      incomeRatio: "Média ÷ mediana da renda",
      schoolYears: "Anos de estudo",
      spiritist: "Espíritas",
      afro: "Umbanda e candomblé",
      unemployed: "Desemprego",
      commuteLong: "Mais de 1 hora até o trabalho",
      commuteWalk: "A pé ou de bicicleta",
      commuteMoto: "De moto",
      commuteCar: "De carro",
      commuteTransit: "De transporte público",
      renting: "Moram de aluguel",
      poorWalls: "Paredes sem reboco ou improvisadas",
      noInternet: "Sem internet em casa",
      migrant: "Já moraram em outra cidade",
      flat: "Apartamentos",
      bathrooms: "2 banheiros ou mais",
      sewer: "Esgoto na rede",
    } as Record<string, string>,
    varGroups: {
      religion: "Religião (100% das pessoas)",
      schooling: "Escolaridade dos adultos (100%)",
      colour: "Cor ou raça (100% das pessoas)",
      income: "Renda por pessoa",
      age: "Idade",
      couples: "Casais",
      other: "Outras",
      work: "Trabalho",
      commute: "Como vai ao trabalho (quem se desloca)",
      home: "Moradia",
      study: "Estudo (outras medidas)",
      origin: "Origem",
    },
    /** How each variable reads in a sentence. */
    varLong: {
      income: "renda domiciliar por pessoa (média)",
      incomeMedian: "renda domiciliar por pessoa (mediana: metade das pessoas vive com menos)",
      evangelical: "% de evangélicos",
      catholic: "% de católicos",
      noReligion: "% sem religião",
      degree: "% dos adultos (25+) com superior completo",
      eduBasic: "% dos adultos (25+) sem instrução ou com fundamental incompleto",
      eduFund: "% dos adultos (25+) com fundamental completo (sem médio)",
      eduMid: "% dos adultos (25+) com médio completo (sem superior)",
      illiterate: "% das pessoas de 15 anos ou mais que não sabem ler e escrever",
      otherReligion: "% de outras religiões ou sem declaração",
      population: "população",
      urban: "% da população em área urbana",
      white: "% das pessoas que se declaram brancas",
      black: "% das pessoas que se declaram pretas",
      brown: "% das pessoas que se declaram pardas",
      asian: "% das pessoas que se declaram amarelas",
      indigenous: "% das pessoas que se declaram indígenas",
      negro: "% de negros (pretos e pardos)",
      elderly: "% das pessoas com 60 anos ou mais",
      sameSex: "% dos domicílios com casal em que o casal é do mesmo sexo",
      gini: "desigualdade da renda domiciliar por pessoa (índice de Gini: 0 todos iguais, 1 um só com tudo)",
      incomeRatio:
        "renda média dividida pela mediana (perto de 1: rendas parecidas; alto: poucos puxam a média)",
      schoolYears: "anos de estudo, em média, dos adultos de 25 anos ou mais",
      spiritist: "% de espíritas",
      afro: "% de umbanda e candomblé",
      unemployed: "% da força de trabalho (14+) sem emprego e procurando",
      commuteLong: "% de quem vai ao trabalho que leva mais de 1 hora",
      commuteWalk: "% de quem vai ao trabalho a pé ou de bicicleta",
      commuteMoto: "% de quem vai ao trabalho de moto ou mototáxi",
      commuteCar: "% de quem vai ao trabalho de carro, táxi ou aplicativo",
      commuteTransit: "% de quem vai ao trabalho de ônibus, van, trem ou metrô",
      renting: "% das pessoas que moram de aluguel",
      poorWalls: "% das pessoas em casas de tijolo sem reboco, taipa, madeira aproveitada ou sem parede",
      noInternet: "% das pessoas sem internet em casa",
      migrant: "% das pessoas que já moraram em outro município ou país",
      flat: "% dos domicílios que são apartamentos",
      bathrooms: "% dos domicílios com 2 banheiros ou mais",
      sewer: "% dos domicílios com esgoto na rede geral ou pluvial",
    } as Record<string, string>,
    format: (v: string, x: number) =>
      v === "gini"
        ? (x / 100).toFixed(2).replace(".", ",")
        : v === "incomeRatio"
          ? `${x.toFixed(2).replace(".", ",")}×`
          : v === "schoolYears"
            ? `${x.toFixed(1).replace(".", ",")} anos`
            : v === "income" || v === "incomeMedian"
              ? `R$ ${Math.round(x).toLocaleString("pt-BR")}`
              : v === "population"
                ? Math.round(x).toLocaleString("pt-BR")
                : `${x.toFixed(1).replace(".", ",")}%`,
    unit: (v: string, census: number) =>
      v === "income" || v === "incomeMedian"
        ? `Renda ${v === "income" ? "média" : "mediana"} por pessoa, em reais de julho de 2022 (Censo ${census})`
        : v === "population"
          ? `Habitantes (Censo ${census}), escala logarítmica`
          : `${["degree", "eduBasic", "eduFund", "eduMid"].includes(v) ? "Adultos de 25 anos ou mais" : v === "illiterate" ? "Pessoas de 15 anos ou mais" : v === "urban" ? "População" : census === 2022 ? "Pessoas de 10 anos ou mais" : "População"} (Censo ${census})`,
    noUrban2022: "O Censo 2022 ainda não tem a divisão urbano/rural por município",
    regions: {
      all: "Brasil",
      N: "Norte",
      NE: "Nordeste",
      CO: "Centro-Oeste",
      SE: "Sudeste",
      S: "Sul",
      CAP: "As 27 capitais",
      INT: "Fora das capitais",
    } as Record<string, string>,
    title: (pt: string, rival: string, year: number, region: string, round = "1º turno") =>
      `${pt} × ${rival}, ${year} · ${round} · ${region}`,
    noRunoff: "Não houve 2º turno nesta eleição",
    meta: (census: number, places: number) =>
      `Censo ${census} · ${places.toLocaleString("pt-BR")} municípios`,
    warning:
      "Cada ponto é um município, não uma pessoa. Se as cidades com mais evangélicos votam mais em alguém, isso não prova que os evangélicos dessas cidades votaram nele (falácia ecológica). Para falar de pessoas, quem responde são as pesquisas.",
    scatterCap: (v: string, who: string, other: string) =>
      `${v} × voto em ${who}. Cor: ${other}. Tamanho: população. A linha é o voto em cada décimo da população.`,
    scatterAria: (v: string, who: string) =>
      `Gráfico de dispersão: ${v} de cada município contra o voto em ${who}`,
    mapCap: (v: string) => `${v} por município, em dez faixas com a mesma população cada`,
    mapAria: (v: string) => `Mapa dos municípios por ${v}`,
    decileLow: "menos",
    decileHigh: "mais",
    otherLegend: (v: string) => `Cor: ${v}`,
    line: "Voto por décimo da população",
    tipVote: (who: string, x: string) => `${who}: ${x}`,
    noData: "Sem dado do Censo",
    quadTitle: (a: string, b: string) => `${a} × ${b}: como votaram os quatro grupos`,
    quadNote:
      "As cidades divididas em dois grupos por cada variável, no ponto em que metade da população fica de cada lado. Percentual de votos válidos somando todos os votos do grupo, como se fosse uma cidade só.",
    quadLabel: (a: string, ca: string, ha: boolean, b: string, cb: string, hb: boolean) =>
      `${a} ${ha ? "acima de" : "até"} ${ca} · ${b} ${hb ? "acima de" : "até"} ${cb}`,
    compTitle: (who: string) => `Quem mora nas cidades, pelo voto em ${who}`,
    joint: {
      title: (who: string, year: number) =>
        `Tudo junto: o que sobra de cada padrão no voto em ${who}, ${year}`,
      note: (places: string, r2: string) =>
        `Quantos pontos o voto muda, em média, a cada passo de uma variável: sozinha e com as outras mantidas iguais (renda, religião, ensino superior e região juntas). Regressão linear ponderada pelos votos válidos, em ${places} municípios; o modelo conjunto explica ${r2} da variação. Continua sendo sobre cidades, não pessoas, e mostra associação, não causa.`,
      variable: "A cada…",
      alone: "Sozinha",
      together: "Com as outras iguais",
      unit: {
        income: "renda por pessoa 2 vezes maior",
        evangelical: "10 pontos a mais de evangélicos",
        noReligion: "10 pontos a mais de sem religião",
        degree: "10 pontos a mais de adultos com ensino superior",
      } as Record<string, string>,
      region: (name: string) => `estar no ${name} (em vez do Sudeste)`,
      points: (x: number) =>
        `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pontos`,
    },
    compNote:
      "As cidades agrupadas pelo percentual de votos válidos que o candidato teve nelas; para cada grupo, como as pessoas se dividem por religião e por escolaridade (cada pessoa conta uma vez: cidades grandes pesam mais). Cada barra conta as pessoas de quem o dado é: religião, a população toda até 2010 e quem tem 10 anos ou mais em 2022; escolaridade, adultos de 25 anos ou mais (em 2000 e 2010, pesados pelos adultos de 18 ou mais, a contagem mais próxima que o Atlas publica). Religião e escolaridade são categorias: o que importa é a distribuição inteira, não uma média.",
    compGroup: (from: number | null, to: number | null) =>
      from === null ? `Até ${to}%` : to === null ? `Mais de ${from}%` : `${from}% a ${to}%`,
    compMeta: (places: number, pop: number) =>
      `${places.toLocaleString("pt-BR")} cidades · ${(pop / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi hab.`,
    compReligion: "Religião",
    compSchooling: "Escolaridade (25+)",
    compAria: (group: string, kind: string) => `${kind} nas cidades onde o candidato teve ${group}`,
    quadMeta: (places: number, pop: number) =>
      `${places.toLocaleString("pt-BR")} municípios · ${(pop / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões de habitantes`,
    gapTitle: "Quanto cada variável separa o voto no PT, eleição a eleição",
    gapNote:
      "Diferença, em pontos, entre o voto no candidato do PT no quinto da população que mora nos municípios com mais daquela característica e no quinto com menos. Abaixo de zero: quanto mais da característica, menos PT.",
    gapAria:
      "Gráfico de linhas: diferença no voto do PT entre os municípios do topo e da base de cada variável, de 1994 a 2026",
    gapPoint: (v: string, year: number, x: string) => `${v}, ${year}: ${x} pontos`,
    note: "Voto: 1º turno, percentual dos votos válidos, comparando o candidato do PT com o adversário mais votado do país em cada eleição. Cada eleição usa o Censo mais próximo: 1994 com o de 1991; 1998 e 2002 com o de 2000; 2006 a 2014 com o de 2010; 2018 a 2026 com o de 2022. Renda corrigida pela inflação (INPC) para reais de julho de 2022. Religião: em 2022 o IBGE só divulga por município as pessoas de 10 anos ou mais; nos outros censos, a população toda; em 1991 os evangélicos são a soma das igrejas tradicionais e pentecostais (8,5% no total, perto dos 9,0% oficiais). Municípios criados depois de um censo ficam sem dado nele. 2026: arquivos do TSE na noite da apuração.",
    play: "Reproduzir",
    pause: "Pausar",
    where: {
      title: (name: string, v: string, level = "areas") =>
        `Quem mora onde em ${name}: ${v.toLowerCase()} ${{ areas: "por área", bairros: "por bairro", regions: "por região", districts: "por distrito", subprefeituras: "por subprefeitura" }[level]}`,
      meta: (n: number, level = "areas") =>
        `${n} ${{ areas: "áreas do IBGE", bairros: "bairros", regions: "regiões", districts: "distritos", subprefeituras: "subprefeituras" }[level]} · Censo 2022`,
      groups: {
        people: "Quem são",
        money: "Renda e desigualdade",
        school: "Estudo",
        work: "Trabalho e transporte",
        home: "Moradia",
        faith: "Religião",
        colour: "Cor ou raça",
      },
      /** Shorter chip names where the variable's own is long. */
      chip: {
        negro: "Negros",
        eduBasic: "Pouco estudo",
        degree: "Superior completo",
        noReligion: "Sem religião",
        incomeRatio: "Média ÷ mediana",
        migrant: "Vieram de fora",
        commuteLong: "Mais de 1h até o trabalho",
        commuteTransit: "Transporte público",
        commuteCar: "Carro",
        commuteMoto: "Moto",
        commuteWalk: "A pé ou bicicleta",
        renting: "Aluguel",
        poorWalls: "Sem reboco",
        noInternet: "Sem internet",
        illiterate: "Analfabetismo",
      } as Record<string, string>,
      /** Keeping only the units in a part of the city along another variable. */
      filter: {
        label: "Só os lugares",
        none: "Todos",
        varLabel: "pela variável",
        bands: {
          low: "na metade com menos",
          high: "na metade com mais",
          bottom: "no quinto com menos",
          top: "no quinto com mais",
        } as Record<string, string>,
        meta: (shown: number, of: number, band: string, v: string) =>
          `Mostrando ${shown} de ${of}: só os que estão ${band} ${v.toLowerCase()} (faixas com a mesma população cada).`,
        out: "Fora do filtro",
      },
      giniLine: (gini: string, rank: number, of: number) =>
        `Desigualdade de renda entre as áreas do IBGE da cidade: Gini ${gini}, ${rank === 1 ? "o maior" : `o ${rank}º maior`} das ${of} capitais (só conta a diferença entre as áreas, não dentro delas).`,
      brazil: "Brasil",
      sampleMark: "*",
      sampleNote:
        "* Da amostra do Censo, publicada só por área de ponderação: um bairro ou distrito leva o número das suas áreas, pesado pela população, e bairros da mesma área repetem o mesmo valor. Sem asterisco: contado setor a setor, o número do próprio lugar.",
      most: (n: number) => `Os ${n} com mais`,
      least: (n: number) => `Os ${n} com menos`,
      all: (n: number) => `Todos os ${n}, do maior para o menor`,
      skipped: (n: number) => `… mais ${n} no meio`,
      city: (name: string) => `${name} inteira`,
      rank: (k: number, n: number) => `${k}º de ${n}`,
      rankCap: (v: string) =>
        `${v.charAt(0).toUpperCase()}${v.slice(1)}. Passe o mouse (ou toque) num nome para achá-lo no mapa e ver tudo sobre o lugar.`,
      clickHint: "Clique para ver tudo sobre o lugar",
      mapAria: (v: string, name: string) => `Mapa de ${name}: ${v}`,
      cardSub: (level: string, city: string, pop: string) =>
        `${{ areas: "Área do IBGE", bairros: "Bairro", regions: "Região", districts: "Distrito", subprefeituras: "Subprefeitura" }[level] ?? ""} de ${city} · ${pop} habitantes`,
      here: "Aqui",
      close: "Fechar",
      unnamed: (k: number) => `Área ${k}`,
      part: (name: string, k: number, n: number) => `${name}, área ${k} de ${n}`,
      unnamedNote:
        "O IBGE não dá nome de bairro nem de região a nenhuma parte desta cidade: as áreas aparecem numeradas.",
      ratioNote:
        "Média ÷ mediana: a renda média dividida pela mediana, calculada em cada área do IBGE (as duas são dela). Perto de 1, as rendas são parecidas; acima de 2, a média está no dobro da mediana: poucos ricos puxam a conta, como onde favela e condomínio dividem a mesma área. Num bairro ou distrito, a das suas áreas, pesada pela população; a da cidade inteira não é a média delas e não aparece.",
      commuteNote:
        "Transporte e tempo: pessoas de 10 anos ou mais que trabalham e saem de casa para isso (quem trabalha em casa fica de fora). Transporte público soma ônibus, BRT, van, trem e metrô; carro inclui táxi e aplicativo.",
      homeNote:
        "Apartamento, banheiros e esgoto: domicílios, contados setor a setor. Aluguel, paredes e internet: pessoas, da amostra. Paredes sem reboco ou improvisadas: tijolo ou taipa sem revestimento, madeira aproveitada ou sem parede (casas de madeira feitas para isso, comuns no Sul, não contam).",
      incomeNote:
        "Renda domiciliar por pessoa: a renda de cada casa dividida pelos seus moradores, em reais de julho de 2022. A média soma todos e divide, e por isso sobe onde há gente muito rica; a mediana é a renda de quem fica no meio: metade das pessoas vive com menos, metade com mais. O IBGE publica as duas por área de ponderação; num bairro ou distrito, são as das suas áreas, pesadas pela população. Mediana não se soma assim, então a da cidade inteira não aparece.",
      elderlyNote:
        "Idosos: pessoas com 60 anos ou mais (a idade do Estatuto da Pessoa Idosa), contando todas as pessoas do Censo 2022.",
      note: "Mapa em dez faixas com a mesma população cada. A cidade inteira: os lugares somados, cada um pesando pela sua população (para escolaridade e casais, uma aproximação: o Censo conta adultos e domicílios, não todas as pessoas). Renda, escolaridade, religião, trabalho, transporte, aluguel, paredes, internet e migração vêm da amostra do Censo, publicada por área de ponderação; cor ou raça, idade, casais, alfabetização, tipo de domicílio, banheiros e esgoto, de todas as pessoas e domicílios, setor a setor.",
    },
    capital: {
      title: (name: string, pt: string, rival: string, round: string, level = "areas") =>
        `${name} por dentro: ${pt} × ${rival}, ${round}, ${{ areas: "área por área", bairros: "bairro por bairro", regions: "região por região", districts: "distrito por distrito", subprefeituras: "subprefeitura por subprefeitura" }[level]}`,
      /** "por área", "por distrito"… */
      per: {
        areas: "por área",
        bairros: "por bairro",
        regions: "por região",
        districts: "por distrito",
        subprefeituras: "por subprefeitura",
      } as Record<string, string>,
      meta: (areas: number, placed: string, level = "areas") =>
        `${areas} ${{ areas: "áreas", bairros: "bairros", regions: "regiões", districts: "distritos", subprefeituras: "subprefeituras" }[level]} · ${placed} dos votos localizados`,
      level: {
        areas: "Áreas do IBGE",
        bairros: "Bairros",
        bairrosApprox: "Bairros (aprox.)",
        regions: "Regiões",
        districts: "Distritos",
        subprefeituras: "Subprefeituras",
      } as Record<string, string>,
      levelLabel: "Dividir a cidade em",
      varLabel: "Variável",
      varFollow: "A mesma do gráfico acima",
      levelNote: {
        areas: "",
        bairros:
          "Os bairros do IBGE (como a lei municipal os define). Cor ou raça e casais vêm direto dos setores censitários de cada bairro; renda, escolaridade e religião só são publicadas por área do IBGE e aqui vêm das áreas dos setores de cada bairro, ponderadas pela população dos setores. Bairro pequeno sem local de votação aparece sem voto.",
        regions:
          "As regiões são os subdistritos do IBGE, que seguem as divisões administrativas de cada prefeitura (em Brasília, as regiões administrativas do DF; em Goiânia, as unidades territoriais de planejamento). Cor ou raça, idade e casais vêm direto dos setores censitários de cada região; renda, escolaridade e religião só são publicadas por área do IBGE e aqui vêm das áreas dos setores de cada região, ponderadas pela população dos setores.",
        districts:
          "Os 96 distritos do IBGE, os mesmos da Prefeitura. Cor ou raça e casais vêm direto dos setores censitários de cada distrito; renda, escolaridade e religião só são publicadas por área do IBGE e aqui vêm das áreas dos setores de cada distrito, ponderadas pela população dos setores.",
        subprefeituras:
          "As 32 subprefeituras e os distritos de cada uma, pela Lei municipal 13.399/2002 e alterações (Sapopemba desde 2013). Números somados dos distritos.",
      } as Record<string, string>,
      osmNote:
        "São Paulo nunca oficializou seus bairros, e por isso o IBGE não tem nenhum lá (só os 96 distritos). Estes bairros vêm do OpenStreetMap, que marca cada um como um ponto: cada setor censitário foi para o ponto mais próximo dentro do seu próprio distrito, e um distrito sem nenhum ponto fica inteiro com o próprio nome. As fronteiras são aproximadas e alguns bairros faltam; os números de cada bairro são somados setor a setor e valem para o contorno desenhado.",
      colourNote:
        "Cor ou raça como cada pessoa declarou ao Censo 2022, contando todas as pessoas (o universo, não a amostra). Negros: pretos e pardos somados, como o IBGE agrega.",
      sameSexNote:
        "O Censo não pergunta orientação sexual nem identidade de gênero. Casais do mesmo sexo que moram juntos são o único dado do Censo sobre isso e não medem a população LGBT+: ficam de fora quem não vive em casal, quem não declarou o companheiro e as pessoas trans.",
      missing: (n: number, total: number) =>
        `O TSE ainda não publicou ${n.toLocaleString("pt-BR")} dos ${total.toLocaleString("pt-BR")} boletins de urna desta cidade; as áreas com menos de 70% dos boletins aparecem esmaecidas no mapa e o voto delas é parcial.`,
      coverage: (pct: number) => `Boletins publicados: ${pct}% das seções da área`,
      lowCoverage: "Menos de 70% dos boletins",
      paintCensus: (v: string) => v,
      warning: (level = "areas") =>
        `${{ areas: "Cada ponto é uma área do IBGE (um grupo de bairros)", bairros: "Cada ponto é um bairro", regions: "Cada ponto é uma região", districts: "Cada ponto é um distrito", subprefeituras: "Cada ponto é uma subprefeitura" }[level]}, não uma pessoa. E o eleitor vota onde tirou o título, que nem sempre é onde mora hoje: o voto de cada ponto é o voto dado nas seções que ficam nele.`,
      scatterCap: (v: string, who: string, other: string, per = "por área") =>
        `${v} × voto em ${who}, ${per}. Cor: ${other}. Tamanho: população.`,
      scatterAria: (v: string, who: string, name: string) =>
        `Gráfico de dispersão: ${v} de cada área de ${name} contra o voto em ${who}`,
      mapCapVote: (pt: string, rival: string, per = "por área") =>
        `Quem venceu, ${per}: ${pt} ou ${rival}; quanto mais forte, maior a vantagem`,
      mapCapCensus: (v: string, per = "por área") => `${v} ${per}, em dez faixas com a mesma população cada`,
      mapAria: (name: string) => `Mapa de ${name} por área de ponderação do IBGE`,
      area: (bairros: string[]) =>
        bairros.length > 3
          ? `${bairros.slice(0, 3).join(", ")} e mais ${bairros.length - 3}`
          : bairros.join(", "),
      noVotes: "Sem seção eleitoral nesta área",
      noUrban: "Urbanização não existe por área (as capitais são quase todas urbanas); mostrando renda",
      onlyFirstRound2026:
        "Por área, só há o 1º turno de 2026: os boletins de urna das seções. A linha do tempo acima não muda este painel.",
      bothRounds:
        "Por área, há os dois turnos de 2026, pelos boletins de urna das seções. A linha do tempo acima não muda este painel.",
      note: "Áreas de ponderação do IBGE: grupos de bairros para os quais o Censo 2022 publica os resultados da amostra (religião, escolaridade, renda), de 12 em Macapá a 332 em São Paulo. Contornos: setores censitários de 2022 unidos por área. Voto: boletim de urna de cada seção em 2026 (site de resultados do TSE), somado na área onde fica o local de votação, pelas coordenadas que o TSE publica. Renda: média domiciliar por pessoa, julho de 2022.",
    },
  },

  congress: {
    houseName: {
      chamber: "Câmara dos Deputados",
      senate: "Senado Federal",
      alesp: "Assembleia Legislativa de São Paulo",
      cmsp: "Câmara Municipal de São Paulo",
    } as Record<string, string>,
    // The Chamber, the Alesp and the council are elected whole; the Senate renews a third or two thirds.
    title: (house: House, year: number) =>
      house === "senate"
        ? `Senado Federal após a eleição de ${year}`
        : house === "chamber"
          ? `Câmara dos Deputados eleita em ${year}`
          : house === "alesp"
            ? `Assembleia Legislativa de São Paulo eleita em ${year}`
            : `Câmara Municipal de São Paulo eleita em ${year}`,
    spNote:
      "Alesp e Câmara Municipal: cadeiras por partido de quem o TSE marcou como eleito em cada eleição (arquivos de candidatos; a Alesp de 2026, da apuração). A posição de cada partido é a nota nacional dele (a mesma do Congresso), não uma medida feita nesta casa.",
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
    ideology: {
      title: (house: string) => `Cada parlamentar pelos votos: ${house}, desde 2023`,
      note: (minVotes: number, r: string, parties: number) =>
        `Cada ponto é um parlamentar; o traço, a média do partido. Posição calculada só pelos votos nas votações nominais disputadas do plenário (pelo menos 10% do lado perdedor), pela primeira dimensão (componentes principais), de −1 (o mais à esquerda da casa) a +1 (o mais à direita); quem tem menos de ${minVotes} votos fica de fora. É uma posição relativa à casa neste mandato, não a mesma escala das notas acadêmicas dos partidos. Neste mandato, o que mais separa os votos mistura esquerda e direita com governo e oposição. Conferência: a média de cada partido acompanha a nota de Zucco & Power com correlação de ${r} (${parties} partidos com 5 ou mais membros).`,
      left: "← esquerda",
      right: "direita →",
      aria: "Posição de cada parlamentar pelos votos, agrupada por partido",
    },
    titleNow: (house: House, date: string) =>
      `${house === "chamber" ? "Câmara dos Deputados" : "Senado Federal"} hoje (${date}), pelo partido atual de cada um`,
    switches: {
      summary: (moved: number, folded: number, date: string) =>
        `${moved} trocaram de partido desde a eleição${folded ? `, e ${folded} viram o partido deixar de existir` : ""} (até ${date})`,
      note: "Partido pelo qual cada um foi eleito (TSE) comparado com o partido de hoje (Câmara e Senado). Quem assumiu como suplente fica de fora. Um partido que não lançou nenhum candidato em 2026 deixou de existir (fusão ou incorporação): quem estava nele aparece à parte, não como troca.",
      foldedTitle: "Partido deixou de existir",
      who: "Parlamentar",
      from: "Eleito pelo",
      to: "Hoje no",
    },
    base: "Base do governo (medida)",
    centraoMeasured: "Centrão medido",
    centraoMeasuredTitle: (cut: number) =>
      `Partidos que votaram com o governo em ${cut}% ou mais das votações disputadas sob pelo menos um presidente do PT e um de outro partido: medido pelos votos de 2003 a 2026, não por lista`,
    newcomers: "Novatos",
    newcomersTitle:
      "Cadeiras de quem nunca tinha sido eleito para nada (estreantes, quem já tinha disputado sem se eleger, quem só teve cargo nomeado). Por partido: as cadeiras acesas são a contagem do partido, não pessoas específicas.",
    baseTitle: (term: string, pct: number) =>
      `Partidos que orientaram como o governo ${term} em ${pct}% ou mais das votações disputadas: medido pelos votos, não por lista`,
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
