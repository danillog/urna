# Pesquisas Eleitorais 2010–2026

Agregador de pesquisas eleitorais brasileiras num único arquivo HTML que funciona offline. Junta as pesquisas publicadas, desenha cada uma como um ponto e traça uma média suavizada por candidato, no estilo do gráfico de intenção de voto do Nexo.

Compilado em 02/10/2026.

## O que tem

| Cargo | Anos | Turnos | Abrangência |
|---|---|---|---|
| Presidente | 2010, 2014, 2018, 2022, 2026 | 1º e 2º | Nacional |
| Governador | 2026 | 1º e 2º (simulação dos dois mais testados) | 27 UFs |
| Senador | 2026 | turno único | 27 UFs |

Volume de 2026 (presidente): 104 pesquisas de 1º turno e 111 de 2º turno, de 14 institutos, de janeiro a 01/10.

## Como usar a página

Abra `pesquisas-eleitorais.html` em qualquer navegador. Não precisa de internet nem de servidor. Com internet, as fontes do Google carregam; sem internet, a página usa as fontes do sistema.

- **Cargo, estado, eleição e turno:** escolhem o que aparece no gráfico. Governador e senador mostram o seletor de estado; presidente mostra o seletor de ano.
- **Como a pesquisa foi feita:** liga e desliga pesquisas presenciais, por telefone, online ou não classificadas. A média é recalculada na hora.
- **Institutos:** clique num instituto para tirá-lo da conta.
- **Passar o mouse:** perto de um ponto mostra aquela pesquisa (instituto, data, amostra, todos os números); longe dos pontos mostra a média do dia.
- **Média final × urna:** para eleições passadas, compara a média do último dia com o resultado oficial, convertendo para votos válidos quando há BNI.
- **Quem chegou mais perto:** para eleições passadas, classifica cada instituto pelo erro da última pesquisa antes da eleição. Em 2026, vira histórico: o erro médio que cada instituto que pesquisa agora teve de 2010 a 2022. Clicar numa linha destaca os pontos daquele instituto no gráfico.
- **Contexto:** resumo da eleição e observações sobre os dados daquela seleção.
- **Ver todas as pesquisas:** tabela com todos os números da seleção atual.

## Estrutura do projeto

```
polls/
├── pesquisas-eleitorais.html     página final (gerada)
├── template.html                 HTML, CSS e JS da página, com marcadores __DATA__ e __STATES__
├── build.py                      monta os dados de presidente → data_min.json
├── build_states.py               monta os dados de governador e senador → data_states.json
├── make_html.py                  injeta os dados e o D3 no template → pesquisas-eleitorais.html
├── baixar_tse_presidente.py      baixa resultados por município do TSE (para o mapa, próxima etapa)
└── raw/
    ├── 2010_1t.csv … 2022_2t.csv pesquisas de presidente por eleição e turno
    ├── 2018_1t_lula.csv          cenários de 2018 com Lula (até agosto)
    ├── 2018_1t_haddad.csv        cenários de 2018 com Haddad
    ├── 2014_2t_validos.csv       2º turno de 2014, só disponível em votos válidos
    ├── 2026_1t_named.txt         1º turno de 2026, uma pesquisa por linha com valores nomeados
    ├── 2026_2t.csv               2º turno de 2026 (Lula × Flávio)
    └── states/
        ├── SPEC.md               formato dos arquivos estaduais
        └── AC.json … TO.json     governador e senador de cada UF
```

## Como gerar a página

Requisitos: Python 3.10+ com `pandas` e `numpy`, e Node.js para obter o D3.

```bash
npm install d3@7.9.0
pip install pandas numpy
python3 build.py
python3 build_states.py
python3 make_html.py
```

`make_html.py` embute o D3 dentro do HTML, por isso o arquivo final roda offline.

## Como adicionar uma pesquisa

**Presidente 2026, 1º turno:** acrescente uma linha em `raw/2026_1t_named.txt`:

```
Datafolha|2026-10-01|2506|Lula=42;Flavio=38;Cury=4;BNI=7
```

`Outros` é calculado sozinho (100 − Lula − Flávio − Cury − BNI).

**Presidente 2026, 2º turno:** acrescente uma linha em `raw/2026_2t.csv`:

```
Datafolha,2026-10-01,2506,48,45,7
```

**Governador ou senador:** edite `raw/states/<UF>.json` seguindo `raw/states/SPEC.md`.

Depois rode os três scripts de novo.

Regras usadas em todos os dados:

- A data é o último dia de campo, não a data de divulgação.
- Os números são votos totais do cenário estimulado.
- Pesquisas de 1º turno divulgadas só em votos válidos ficam de fora, porque não dá para pôr na mesma escala.
- BNI = brancos + nulos + indecisos.

## Metodologia

**Linha (média suavizada).** Para cada dia, uma regressão linear local pondera as pesquisas próximas com um núcleo gaussiano. O desvio do núcleo é de 14 dias no ano eleitoral, 4 dias nos 2º turnos curtos de presidente e 10 dias nos 2º turnos estaduais. O cálculo roda no navegador, para refazer a média quando você filtra institutos ou métodos.

**Pesos.**
- Amostras maiores pesam mais: raiz do tamanho da amostra, limitada entre 500 e 5.000 entrevistas.
- Institutos que publicam várias rodadas em 7 dias, como os trackings, têm o peso dividido pela raiz do número de rodadas para não dominarem a média.

**Faixa sombreada.** ±1 desvio-padrão ponderado das pesquisas em torno da linha.

**Poucas pesquisas.** Com menos de 3 pesquisas de um candidato, a linha só liga os pontos.

**Quem chegou mais perto.** Para cada instituto, vale a última pesquisa com campo encerrado até 10 dias antes da eleição. Pesquisa e resultado são recalculados como fatia só entre os candidatos do resultado, o que põe votos totais e válidos na mesma base. Duas medidas:
- Erro médio: diferença média em pontos percentuais.
- Erro na margem: compara a distância entre os dois primeiros.

**Método de entrevista.** Classificação pelo método habitual de cada instituto:

| Método | Institutos |
|---|---|
| Presencial | Datafolha, Ibope, Ipec, Quaest, Vox Populi, MDA, Sensus, Paraná Pesquisas, Vox Brasil |
| Telefone | Ipespe, PoderData, FSB, Futura, Real Time Big Data, Ideia, Nexus |
| Online | AtlasIntel |
| Não classificado | Gerp, Palver, Indexa e outros sem método confirmado |

Um instituto pode ter mudado de método numa rodada específica.

**Senado.** Em 2026 cada eleitor vota em dois senadores. Os números somam o 1º e o 2º voto, reescalados para 100%, como Quaest, Datafolha, AtlasIntel e Real Time Big Data divulgam. Institutos que publicam a soma bruta, acima de 100%, ficaram de fora.

**Cores.** Validadas para daltonismo, em modo claro e escuro. Nas eleições estaduais, PT fica vermelho e PL azul; os demais recebem cores fixas por ordem.

## Fontes

- **Pesquisas de presidente 2010–2022 e de 2026 até agosto:** tabelas da Wikipédia em inglês (*Opinion polling for the 20XX Brazilian presidential election*; para 2014, *2014 Brazilian general election*), que reúnem pesquisas registradas no TSE.
- **Pesquisas de setembro e outubro de 2026:** páginas de cada divulgação na Gazeta do Povo, mais Poder360, Jornal Opção e outros veículos.
- **Pesquisas estaduais:** Gazeta do Povo, CNN Brasil, Exame, Poder360, Wikipédia e veículos regionais.
- **Resultados oficiais:** TSE.
- **Marcos no gráfico:** fatos da campanha, como a morte de Campos (2014), a facada (2018) e a MP do fim das bets (25/09/2026).

## Limitações conhecidas

- Os dados foram lidos de páginas web por uma ferramenta automática e passaram por checagem de soma, datas, duplicatas e nomes. Pode haver erro de transcrição pontual.
- 2010 e 2014 têm só 4 institutos listados, sem tamanho de amostra.
- No 1º turno de 2022 não há BNI, porque a fonte não trazia.
- Em 2018, Lula aparece tracejado: cenários com ele até 31/08, com Haddad depois.
- No 2º turno de 2026, os pontos antes de outubro são simulações hipotéticas.
- Algumas pesquisas de 1º turno de 2026 ficaram de fora por terem saído só em votos válidos:
  - AtlasIntel de 22/09
  - Nexus de 27/09
  - Gerp de 28/09
  - Real Time Big Data de 30/09, só no 2º turno; o 1º turno entrou em votos totais.
- Estados com poucas pesquisas: RR (2), AC, TO e MS (4). Vários estados só têm pesquisas a partir de julho ou agosto, porque antes os institutos testavam nomes que saíram da disputa.
- Governador e senador: dados até 29/09/2026.
- Deputados não entram: quase não há pesquisa para esse cargo.
- Gerp e Palver ficam cerca de 3 pontos mais favoráveis a Flávio que a média ao longo do ano. Sem os dois, o 2º turno de 2026 é empate.

## Próxima etapa: mapa por município

O objetivo é um mapa dos 5.570 municípios com o resultado de presidente em cada eleição, nos dois turnos.

- **Contornos:** malha de municípios do GitHub (`tbrugz/geodata-br`).
- **Resultados:** arquivos do TSE, que só podem ser baixados fora deste ambiente. `baixar_tse_presidente.py` faz isso e gera `resultados_presidente_municipio.csv`:

```bash
python3 baixar_tse_presidente.py              # 2010, 2014, 2018 e 2022
python3 baixar_tse_presidente.py 2022         # um ano só
```

O script usa só a biblioteca padrão do Python, baixa o arquivo `votacao_candidato_munzona` de cada ano, fica com presidente e soma as zonas de cada município. O código de município do TSE será convertido para o código do IBGE na hora de montar o mapa.

Falta decidir como pintar cada cidade:
- só quem venceu;
- cor pela margem de vitória;
- mudança entre eleições.

## Referências

- Dados abertos do TSE: https://dadosabertos.tse.jus.br/dataset/?groups=resultados
- Regressão local (LOESS): https://en.wikipedia.org/wiki/Local_regression
- Gráfico de referência do Nexo: https://www.nexojornal.com.br/especial/2026/08/28/pesquisa-presidente-eleicoes-2026-lula-bolsonaro
- D3.js: https://d3js.org/
