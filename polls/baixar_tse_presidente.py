import csv
import io
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_{ano}.zip"
ANOS_PADRAO = ["2010", "2014", "2018", "2022"]
SAIDA = Path("resultados_presidente_municipio.csv")
CHUNK = 1 << 20


def baixar(ano: str, destino: Path) -> None:
    url = URL.format(ano=ano)
    with urllib.request.urlopen(url, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        lido = 0
        with destino.open("wb") as f:
            while bloco := resp.read(CHUNK):
                f.write(bloco)
                lido += len(bloco)
                if total:
                    print(f"\r  {ano}: {lido / total:6.1%} de {total / 1e6:,.0f} MB", end="", flush=True)
    print()


def arquivos_csv(zf: zipfile.ZipFile) -> list[str]:
    nomes = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    nacional = [n for n in nomes if n.upper().endswith("_BR.CSV")]
    return nacional or nomes


def agregar(ano: str, caminho_zip: Path, votos: dict) -> int:
    linhas = 0
    with zipfile.ZipFile(caminho_zip) as zf:
        for nome in arquivos_csv(zf):
            with zf.open(nome) as bruto:
                leitor = csv.DictReader(io.TextIOWrapper(bruto, encoding="latin-1"), delimiter=";")
                for row in leitor:
                    if row.get("DS_CARGO", "").strip().upper() != "PRESIDENTE":
                        continue
                    chave = (
                        ano,
                        row["NR_TURNO"],
                        row["SG_UF"],
                        row["CD_MUNICIPIO"],
                        row["NM_MUNICIPIO"],
                        row["NR_CANDIDATO"],
                        row["NM_URNA_CANDIDATO"],
                        row["SG_PARTIDO"],
                    )
                    votos[chave] += int(row["QT_VOTOS_NOMINAIS"] or 0)
                    linhas += 1
    return linhas


def main() -> None:
    anos = sys.argv[1:] or ANOS_PADRAO
    votos: dict = defaultdict(int)
    with tempfile.TemporaryDirectory() as tmp:
        for ano in anos:
            destino = Path(tmp) / f"{ano}.zip"
            print(f"Baixando {ano}...")
            baixar(ano, destino)
            print(f"  {ano}: {agregar(ano, destino, votos):,} linhas de presidente lidas")
            destino.unlink()
    with SAIDA.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ano", "turno", "uf", "cd_municipio_tse", "municipio", "nr_candidato", "candidato", "partido", "votos"])
        for chave in sorted(votos):
            w.writerow([*chave, votos[chave]])
    print(f"Pronto: {SAIDA.resolve()} ({SAIDA.stat().st_size / 1e6:.1f} MB, {len(votos):,} linhas)")


if __name__ == "__main__":
    main()
