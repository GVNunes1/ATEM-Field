from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def node_text(node: ET.Element) -> str:
    chunks: list[str] = []
    for item in node.iter():
        if item.tag == W + "t" and item.text:
            chunks.append(item.text)
        elif item.tag == W + "tab":
            chunks.append("\t")
        elif item.tag in {W + "br", W + "cr"}:
            chunks.append("\n")
        elif item.tag == W + "sym":
            code = item.attrib.get(W + "char")
            if code:
                try:
                    chunks.append(chr(int(code, 16)))
                except ValueError:
                    pass
    return "".join(chunks).strip()


def paragraph_text(paragraph: ET.Element) -> str:
    return node_text(paragraph)


def table_text(table: ET.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table.findall("./w:tr", NS):
        cells: list[str] = []
        for cell in row.findall("./w:tc", NS):
            paragraphs = []
            for paragraph in cell.findall(".//w:p", NS):
                text = paragraph_text(paragraph)
                if text:
                    paragraphs.append(text)
            cells.append("\n".join(paragraphs))
        rows.append(cells)
    return rows


def extract_part(xml_bytes: bytes) -> dict[str, object]:
    root = ET.fromstring(xml_bytes)
    body = root.find("w:body", NS)
    if body is None:
        body = root
    blocks: list[dict[str, object]] = []
    for child in list(body):
        if child.tag == W + "p":
            text = paragraph_text(child)
            if text:
                blocks.append({"type": "paragraph", "text": text})
        elif child.tag == W + "tbl":
            blocks.append({"type": "table", "rows": table_text(child)})
    return {"blocks": blocks}


def extract_docx(path: Path) -> dict[str, object]:
    parts: dict[str, object] = {}
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        wanted = ["word/document.xml"]
        wanted.extend(sorted(name for name in names if name.startswith("word/header") and name.endswith(".xml")))
        wanted.extend(sorted(name for name in names if name.startswith("word/footer") and name.endswith(".xml")))
        for optional in ("word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"):
            if optional in names:
                wanted.append(optional)
        for name in wanted:
            parts[name] = extract_part(archive.read(name))
    return {"file": path.name, "parts": parts}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit("usage: extract_docx_readonly.py FILE.docx [FILE.docx ...]")
    payload = [extract_docx(Path(raw)) for raw in sys.argv[1:]]
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
