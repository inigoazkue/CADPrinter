"""
superponer.py — Superpone N PDFs en una sola hoja y la abre para imprimir.

Uso:
    python superponer.py archivo1.pdf archivo2.pdf [archivo3.pdf ...]
    python superponer.py archivo1.pdf archivo2.pdf -o resultado.pdf
"""

import sys
import os
import subprocess
import argparse
import fitz  # PyMuPDF


def superponer_pdfs(rutas_entrada: list[str], ruta_salida: str) -> None:
    if not rutas_entrada:
        raise ValueError("Se necesita al menos un PDF de entrada.")

    docs = [fitz.open(r) for r in rutas_entrada]

    # Usamos el tamaño de página del primer documento como referencia
    pagina_ref = docs[0][0]
    ancho = pagina_ref.rect.width
    alto = pagina_ref.rect.height

    out = fitz.open()
    pagina_out = out.new_page(width=ancho, height=alto)

    for i, doc in enumerate(docs):
        pagina_out.show_pdf_page(pagina_out.rect, doc, 0)
        print(f"  [{i+1}/{len(docs)}] Capa añadida: {os.path.basename(rutas_entrada[i])}")

    for doc in docs:
        doc.close()

    out.save(ruta_salida)
    out.close()
    print(f"\nGuardado en: {ruta_salida}")


def abrir_para_imprimir(ruta: str) -> None:
    # Abre el PDF con el visor predeterminado de Windows (Adobe, Edge, etc.)
    os.startfile(os.path.abspath(ruta))
    print("PDF abierto. Imprime desde el visor (Ctrl+P).")


def main():
    parser = argparse.ArgumentParser(
        description="Superpone varios PDFs de AutoCAD en una sola hoja."
    )
    parser.add_argument("pdfs", nargs="+", help="PDFs a superponer (en orden de capas)")
    parser.add_argument(
        "-o", "--output",
        default="combinado.pdf",
        help="Nombre del PDF de salida (por defecto: combinado.pdf)"
    )
    parser.add_argument(
        "--no-abrir",
        action="store_true",
        help="No abrir el PDF al terminar"
    )
    args = parser.parse_args()

    # Validar que existen los ficheros
    for ruta in args.pdfs:
        if not os.path.isfile(ruta):
            print(f"Error: no se encuentra el fichero '{ruta}'")
            sys.exit(1)

    print(f"Superponiendo {len(args.pdfs)} PDF(s)...")
    superponer_pdfs(args.pdfs, args.output)

    if not args.no_abrir:
        abrir_para_imprimir(args.output)


if __name__ == "__main__":
    main()
