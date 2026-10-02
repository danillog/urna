from pathlib import Path

root = Path(__file__).parent
t = (root / "template.html").read_text()
t = t.replace("__DATA__", (root / "data_min.json").read_text())
t = t.replace("__STATES__", (root / "data_states.json").read_text())
d3 = (root / "node_modules/d3/dist/d3.min.js").read_text()
t = t.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>', "<script>" + d3 + "</script>")
head_end = t.index("</style>") + len("</style>")
page = ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + t[:head_end] + "\n</head>\n<body>\n" + t[head_end:] + "\n</body>\n</html>\n")
(root / "pesquisas-eleitorais.html").write_text(page)
print(len(page))
