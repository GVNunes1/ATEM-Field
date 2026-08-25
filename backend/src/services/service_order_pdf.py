#!/usr/bin/env python3
"""Generate the original Mult Med PAT01-F2 service-order PDF.

The ATEM OS output was an HTML/Jinja template printed by Chromium. Keeping the
same template and rendering engine is intentional: this preserves the original
one-page document instead of approximating it with a new ReportLab layout.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from jinja2 import Environment, select_autoescape


TEMPLATE_PATH = Path(__file__).with_name("service_order_template.html")
DATA_IMAGE_PATTERN = re.compile(
    r"data:image/(?P<kind>[a-zA-Z0-9.+-]+);base64,(?P<data>[a-zA-Z0-9+/=\r\n]+)"
)


def clean_parts(value: Any) -> list[dict[str, str]]:
    parts: list[dict[str, str]] = []
    if isinstance(value, list):
        for raw_part in value:
            if not isinstance(raw_part, dict):
                continue
            name = str(raw_part.get("nome") or "").strip()
            quantity = str(raw_part.get("quantidade") or "").strip()
            applied = str(raw_part.get("aplicado") or "").strip()
            if name or quantity or applied:
                parts.append(
                    {
                        "quantidade": quantity,
                        "codigo": str(raw_part.get("codigo") or "").strip(),
                        "nome": name,
                        "aplicado": applied if applied.lower() in {"sim", "não", "nao"} else "",
                    }
                )

    while len(parts) < 4:
        parts.append({"quantidade": "", "codigo": "", "nome": "", "aplicado": ""})
    return parts


def expand_boolean(context: dict[str, Any], source_key: str, target_prefix: str) -> None:
    normalized = str(context.get(source_key) or "").strip().lower()
    context[f"{target_prefix}_Sim"] = normalized == "sim"
    context[f"{target_prefix}_Nao"] = normalized in {"não", "nao"}


def template_context(data: dict[str, Any]) -> dict[str, Any]:
    context = {key: value if value is not None else "" for key, value in data.items()}
    context["Pecas"] = clean_parts(data.get("Pecas"))

    # Compatibility with records produced by every ATEM OS form revision.
    context["Descricao_Servicos"] = data.get("Descricao_Servicos") or data.get("Descricao_Servico") or ""
    context["Observacoes"] = data.get("Observacoes") or data.get("Observacoes_Tecnicas") or ""
    context["Hora_Fim_Servico"] = data.get("Hora_Fim_Servico") or data.get("Hora_Termino_Servico") or ""

    expand_boolean(context, "Servico_Concluido", "Servico_Concluido")
    expand_boolean(context, "Tensao_Adequada", "Tensao")
    expand_boolean(context, "Tomada_Adequada", "Tomada")
    expand_boolean(context, "Pressao_Adequada", "Pressao")
    expand_boolean(context, "Umidade_Rede", "Umidade")
    expand_boolean(context, "Valvula_Reguladora", "Valvula")
    return context


def browser_executable() -> str:
    configured = os.getenv("CHROMIUM_EXECUTABLE") or os.getenv("BROWSER_EXECUTABLE")
    candidates = [
        configured,
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("msedge"),
    ]

    if sys.platform == "win32":
        candidates.extend(
            [
                os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
                os.path.join(os.environ.get("PROGRAMFILES", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
                os.path.join(os.environ.get("PROGRAMFILES", ""), "Google", "Chrome", "Application", "chrome.exe"),
            ]
        )

    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError("Chromium/Chrome/Edge não encontrado para gerar o PDF PAT01-F2.")


def materialize_data_images(rendered_html: str, directory: Path) -> str:
    """Write embedded images beside the HTML so Chromium waits for decoding.

    Edge can begin a command-line print before large data-URI images have been
    decoded, intermittently omitting the Multmed logo or signatures. Local file
    resources participate in the normal page load lifecycle and make the
    original document deterministic on Windows and Linux.
    """
    image_number = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal image_number
        image_number += 1
        kind = match.group("kind").lower()
        extension = {"jpeg": "jpg", "svg+xml": "svg"}.get(kind, kind)
        image_path = directory / f"embedded-image-{image_number}.{extension}"
        try:
            encoded_image = re.sub(r"\s+", "", match.group("data"))
            image_path.write_bytes(base64.b64decode(encoded_image, validate=True))
        except (ValueError, binascii.Error):
            return match.group(0)
        return image_path.resolve().as_uri()

    return DATA_IMAGE_PATTERN.sub(replace, rendered_html)


def render_pdf(data: dict[str, Any], output_path: Path) -> None:
    if not TEMPLATE_PATH.is_file():
        raise FileNotFoundError(f"Template PAT01-F2 não encontrado: {TEMPLATE_PATH}")

    environment = Environment(autoescape=select_autoescape(["html", "xml"]))
    template = environment.from_string(TEMPLATE_PATH.read_text(encoding="utf-8"))
    rendered_html = template.render(template_context(data))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.unlink(missing_ok=True)
    browser = browser_executable()
    with tempfile.TemporaryDirectory(prefix="atem-os-pdf-", ignore_cleanup_errors=True) as temporary_directory:
        temporary_path = Path(temporary_directory)
        html_path = temporary_path / "pat01-f2.html"
        profile_path = temporary_path / "browser-profile"
        html_path.write_text(materialize_data_images(rendered_html, temporary_path), encoding="utf-8")

        command = [
            browser,
            "--headless",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--allow-file-access-from-files",
            "--no-pdf-header-footer",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=2000",
            f"--user-data-dir={profile_path}",
            f"--print-to-pdf={output_path.resolve()}",
            html_path.resolve().as_uri(),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)

        # Some Edge builds return control before the renderer has finished
        # flushing the output file. Wait briefly for a complete PDF instead of
        # treating that asynchronous hand-off as a generation failure.
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if output_path.is_file() and output_path.stat().st_size > 4:
                with output_path.open("rb") as pdf_stream:
                    if pdf_stream.read(5) == b"%PDF-":
                        break
            time.sleep(0.1)

    # Edge on Windows may exit with a non-zero status after successfully
    # writing the PDF (the original ATEM OS used the file itself as the source
    # of truth for this reason). Chromium in the container normally exits 0.
    if not output_path.is_file() or output_path.stat().st_size == 0:
        details = (result.stderr or result.stdout or "sem detalhes").strip()[:800]
        raise RuntimeError(f"Falha ao imprimir o PAT01-F2 pelo navegador: {details}")


def read_payload(source: str) -> dict[str, Any]:
    if source == "-":
        payload = json.load(sys.stdin)
    else:
        with open(source, encoding="utf-8") as stream:
            payload = json.load(stream)
    if not isinstance(payload, dict):
        raise ValueError("Os dados da ordem de serviço devem ser um objeto JSON.")
    return payload


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"success": False, "error": "Uso: service_order_pdf.py <dados.json|-> <saida.pdf>"}, ensure_ascii=False))
        return 2

    try:
        output_path = Path(sys.argv[2]).resolve()
        render_pdf(read_payload(sys.argv[1]), output_path)
        print(
            json.dumps(
                {"success": True, "output": str(output_path), "filename": output_path.name},
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
