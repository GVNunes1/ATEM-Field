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
import signal
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
DEFAULT_RENDER_TIMEOUT_SECONDS = 45.0
PDF_STABILITY_INTERVAL_SECONDS = 0.15


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
        shutil.which("chromium-headless-shell"),
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


def render_timeout_seconds() -> float:
    raw_timeout = os.getenv("PDF_RENDER_TIMEOUT_SECONDS", str(DEFAULT_RENDER_TIMEOUT_SECONDS))
    try:
        timeout = float(raw_timeout)
    except ValueError as error:
        raise ValueError("PDF_RENDER_TIMEOUT_SECONDS deve ser um número de segundos.") from error
    if timeout < 5 or timeout > 75:
        raise ValueError("PDF_RENDER_TIMEOUT_SECONDS deve estar entre 5 e 75 segundos.")
    return timeout


def complete_pdf_size(output_path: Path) -> int | None:
    """Return the size only after Chromium has written a complete PDF."""
    try:
        size = output_path.stat().st_size
        if size < 8:
            return None
        with output_path.open("rb") as pdf_stream:
            if pdf_stream.read(5) != b"%PDF-":
                return None
            pdf_stream.seek(max(0, size - 2048))
            if b"%%EOF" not in pdf_stream.read():
                return None
        return size
    except (FileNotFoundError, OSError):
        return None


def stop_process_tree(process: subprocess.Popen[Any]) -> None:
    """Stop Chromium and every helper process spawned for this render."""
    if process.poll() is not None:
        return

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def run_browser(command: list[str], output_path: Path, log_path: Path) -> tuple[int | None, str]:
    """Run Chromium until the PDF is complete, even if its parent stays alive."""
    popen_options: dict[str, Any] = {}
    if os.name == "nt":
        popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_options["start_new_session"] = True

    deadline = time.monotonic() + render_timeout_seconds()
    stable_size: int | None = None
    stable_observations = 0
    exited_at: float | None = None

    with log_path.open("w+", encoding="utf-8", errors="replace") as browser_log:
        process = subprocess.Popen(
            command,
            stdout=browser_log,
            stderr=subprocess.STDOUT,
            text=True,
            **popen_options,
        )
        try:
            while time.monotonic() < deadline:
                current_size = complete_pdf_size(output_path)
                if current_size is not None:
                    if current_size == stable_size:
                        stable_observations += 1
                    else:
                        stable_size = current_size
                        stable_observations = 1
                    if stable_observations >= 2:
                        break

                return_code = process.poll()
                if return_code is not None:
                    exited_at = exited_at or time.monotonic()
                    # A few Chromium/Edge builds hand off the final flush to a
                    # child process. Preserve a short grace period for it.
                    if time.monotonic() - exited_at >= 3:
                        break
                time.sleep(PDF_STABILITY_INTERVAL_SECONDS)
        finally:
            stop_process_tree(process)

        return_code = process.poll()
        browser_log.flush()
        browser_log.seek(0)
        details = browser_log.read()[-4000:]

    if complete_pdf_size(output_path) is None:
        if time.monotonic() >= deadline:
            details = f"tempo limite de {render_timeout_seconds():g}s excedido. {details}"
        return return_code, details.strip()
    return return_code, details.strip()


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

        # Northflank's smallest runtime has 256 MB shared by Node and the PDF
        # renderer. Debian's dedicated headless shell plus an in-process
        # renderer avoids the zygote/renderer trees that otherwise exhaust the
        # cgroup before Chromium reaches print-to-pdf.
        is_headless_shell = "headless-shell" in Path(browser).name.lower()
        linux_low_memory_flags = (
            [
                "--no-zygote",
                "--single-process",
                "--num-raster-threads=1",
                "--disable-crash-reporter",
            ]
            if sys.platform.startswith("linux")
            else []
        )
        command = [
            browser,
            *([] if is_headless_shell else ["--headless"]),
            *linux_low_memory_flags,
            "--disable-background-networking",
            "--disable-breakpad",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-domain-reliability",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-sandbox",
            "--no-default-browser-check",
            "--no-first-run",
            "--allow-file-access-from-files",
            "--no-pdf-header-footer",
            "--timeout=15000",
            f"--user-data-dir={profile_path}",
            f"--print-to-pdf={output_path.resolve()}",
            html_path.resolve().as_uri(),
        ]
        result_code, browser_details = run_browser(command, output_path, temporary_path / "chromium.log")

    # Edge on Windows may exit with a non-zero status after successfully
    # writing the PDF (the original ATEM OS used the file itself as the source
    # of truth for this reason). Chromium in the container normally exits 0.
    if complete_pdf_size(output_path) is None:
        details = browser_details or f"Chromium encerrou com código {result_code}, sem detalhes."
        raise RuntimeError(f"Falha ao imprimir o PAT01-F2 pelo navegador: {details[:1200]}")


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
