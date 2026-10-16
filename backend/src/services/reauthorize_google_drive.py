#!/usr/bin/env python3
"""Authorize Drive access for service orders without changing the active token."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from service_order_drive import DRIVE_FILE_SCOPE, SIGNED_FOLDER_ID, UNSIGNED_FOLDER_ID


def load_client_config() -> dict:
    """Prefer a Drive OAuth client, falling back to the configured Calendar client."""
    service_dir = Path(__file__).resolve().parent
    backend_dir = service_dir.parent.parent
    candidates = [
        ("GOOGLE_DRIVE_CREDENTIALS_JSON", None),
        ("GOOGLE_DRIVE_CREDENTIALS_PATH", "path"),
        ("GOOGLE_CALENDAR_CREDENTIALS_JSON", None),
        ("GOOGLE_CALENDAR_CREDENTIALS_PATH", "path"),
    ]
    for name, kind in candidates:
        raw = os.environ.get(name, "").strip()
        if not raw:
            continue
        try:
            contents = Path(raw).expanduser().read_text(encoding="utf-8") if kind == "path" else raw
            config = json.loads(contents)
        except (OSError, ValueError) as error:
            raise RuntimeError(f"A configuração {name} é inválida.") from error
        if not isinstance(config, dict) or not isinstance(config.get("installed"), dict):
            raise RuntimeError(f"A configuração {name} deve conter um cliente OAuth do tipo desktop/installed.")
        client = config["installed"]
        if not all(client.get(field) for field in ("client_id", "client_secret", "auth_uri", "token_uri")):
            raise RuntimeError(f"A configuração {name} está incompleta.")
        return config

    for path in (backend_dir / "data" / "google-calendar-credentials.json", backend_dir / "credentials.json"):
        if not path.is_file():
            continue
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise RuntimeError("O arquivo local de credenciais OAuth é inválido.") from error
        if not isinstance(config, dict) or not isinstance(config.get("installed"), dict):
            raise RuntimeError("O arquivo local deve conter um cliente OAuth do tipo desktop/installed.")
        return config

    raise RuntimeError("Credenciais OAuth do Google não encontradas para renovar o Drive.")


def validate_drive_access(credentials) -> None:
    """Check both folders with the same API operations used by service_order_drive."""
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    for folder_id in dict.fromkeys((UNSIGNED_FOLDER_ID, SIGNED_FOLDER_ID)):
        folder = service.files().get(
            fileId=folder_id,
            fields="id,mimeType,capabilities(canAddChildren)",
            supportsAllDrives=True,
        ).execute()
        if folder.get("id") != folder_id or folder.get("mimeType") != "application/vnd.google-apps.folder":
            raise RuntimeError("Uma pasta das ordens de serviço não está acessível no Drive.")
        if not folder.get("capabilities", {}).get("canAddChildren"):
            raise RuntimeError("A conta Google não pode adicionar arquivos a uma pasta das ordens de serviço.")
        service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="files(id),nextPageToken",
            pageSize=1,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()


def write_new_token(path: Path, token: dict) -> None:
    """Create a private file; never overwrite a previously generated credential."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(token, ensure_ascii=False) + "\n"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Renova o OAuth do Google Drive usado pelas ordens de serviço.")
    parser.add_argument("--output", required=True, help="Novo arquivo JSON local, ignorado pelo Git.")
    args = parser.parse_args()

    flow = InstalledAppFlow.from_client_config(load_client_config(), [DRIVE_FILE_SCOPE])
    credentials = flow.run_local_server(
        host="127.0.0.1",
        port=0,
        open_browser=True,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Abrindo a autorização do Google Drive no navegador...",
        success_message="Google Drive autorizado. Você pode fechar esta aba.",
    )
    if not credentials or not credentials.refresh_token:
        raise RuntimeError("O Google não devolveu um refresh token para o Drive.")

    # Do not write any credential until both production folders are accessible.
    validate_drive_access(credentials)
    token = json.loads(credentials.to_json())
    granted_scopes = getattr(credentials, "granted_scopes", None)
    if granted_scopes:
        token["scopes"] = list(granted_scopes)
    if not all(token.get(field) for field in ("refresh_token", "client_id", "client_secret", "token_uri")):
        raise RuntimeError("O token recebido está incompleto.")

    output = Path(args.output).expanduser().resolve()
    write_new_token(output, token)
    print(json.dumps({"success": True, "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # OAuth / HTTP exception messages may contain codes or tokens. Never echo them.
        print(json.dumps({"success": False, "error": "Autorização ou validação do Drive falhou.", "type": type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
