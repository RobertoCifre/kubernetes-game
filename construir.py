#!/usr/bin/env python3
"""construir.py — empaqueta el juego del navegador en UN solo fichero: cluster-en-llamas.html

Junta src/plantilla.html + src/estilo.css + los .js de src/ (en orden) y mete dentro
las chuletas (CHULETA*.md de esta carpeta o de chuletas/) para que el HTML funcione sin nada más,
también copiado a otro PC o abierto sin Internet.

Uso:  python construir.py
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

ORDEN_JS = ["yaml.js", "sim.js", "vistas.js", "comandos.js", "niveles.js", "ui.js"]
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("construir")


def main() -> int:
    raiz = Path(__file__).resolve().parent
    src = raiz / "src"
    try:
        plantilla = (src / "plantilla.html").read_text(encoding="utf-8")
        css = (src / "estilo.css").read_text(encoding="utf-8")
        js = "\n".join((src / f).read_text(encoding="utf-8") for f in ORDEN_JS)
    except OSError as e:
        log.error("no se pudo leer src/: %s", e)
        return 1

    # las chuletas pueden estar junto a este script o en la subcarpeta chuletas/
    chuletas: dict[str, str] = {}
    for carpeta in (raiz, raiz / "chuletas"):
        indice = carpeta / "CHULETAS.md"
        if indice.exists():
            chuletas["CHULETAS.md"] = indice.read_text(encoding="utf-8")
        for f in sorted(carpeta.glob("CHULETA-*.md")):
            chuletas[f.name] = f.read_text(encoding="utf-8")
    if not chuletas:
        log.warning("no hay CHULETA*.md: el visor de chuletas saldrá vacío")

    # </script> dentro de un string rompería el HTML
    datos = json.dumps(chuletas, ensure_ascii=False).replace("</", "<\\/")
    html = (plantilla.replace("/*CSS*/", css)
                     .replace("/*CHULETAS*/", f"const CHULETAS = {datos};")
                     .replace("/*JS*/", js.replace("</script", "<\\/script")))
    if re.search(r"/\*(CSS|JS|CHULETAS)\*/", html):
        log.error("quedan marcadores sin sustituir en la plantilla")
        return 1
    destino = raiz / "cluster-en-llamas.html"
    destino.write_text(html, encoding="utf-8", newline="\n")
    log.info("escrito %s (%d KB, %d chuletas: %s)", destino.name, len(html.encode()) // 1024,
             len(chuletas), ", ".join(chuletas) or "-")
    return 0


if __name__ == "__main__":
    sys.exit(main())
