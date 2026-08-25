#!/usr/bin/env python3
"""Google Drive persistence for ATEM Field service-order PDFs."""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


UNSIGNED_FOLDER_ID = os.getenv("GOOGLE_DRIVE_OS_UNSIGNED_FOLDER_ID", "1IWdsd9B2ZGRotVdzt6OVzu6NjM7SnRdS")
SIGNED_FOLDER_ID = os.getenv("GOOGLE_DRIVE_OS_SIGNED_FOLDER_ID", "13OOs4zsvGJh9RGKJ1sK_hMugTmL-kmKi")
DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"


def json_from_environment(base_name: str) -> dict[str, Any] | None:
    encoded = os.getenv(f"{base_name}_BASE64", "").strip()
    raw = os.getenv(base_name, "").strip()
    file_path = os.getenv(f"{base_name}_FILE", "").strip()

    if encoded:
        raw = base64.b64decode(encoded).decode("utf-8")
    elif file_path:
        raw = Path(file_path).read_text(encoding="utf-8")
    if not raw:
        return None

    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        raw = raw[1:-1]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"A credencial {base_name} contém JSON inválido.") from error
    if not isinstance(data, dict):
        raise RuntimeError(f"A credencial {base_name} deve ser um objeto JSON.")
    return data


def drive_service():
    oauth_info = json_from_environment("GOOGLE_DRIVE_OAUTH_TOKEN_JSON")
    if not oauth_info:
        raise RuntimeError(
            "Token OAuth do Google Drive ausente. Configure GOOGLE_DRIVE_OAUTH_TOKEN_JSON_BASE64."
        )
    credentials = Credentials.from_authorized_user_info(oauth_info, scopes=[DRIVE_FILE_SCOPE])
    if not credentials.valid and credentials.refresh_token:
        credentials.refresh(Request())
    if not credentials.valid:
        raise RuntimeError("O token OAuth do Google Drive está inválido e não pôde ser renovado.")
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def folder_for(signed: bool) -> str:
    return SIGNED_FOLDER_ID if signed else UNSIGNED_FOLDER_ID


def escape_query(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def find_file(service, filename: str, signed: bool | None = None) -> dict[str, Any] | None:
    folders = [folder_for(signed)] if signed is not None else [SIGNED_FOLDER_ID, UNSIGNED_FOLDER_ID]
    for folder_id in folders:
        response = service.files().list(
            q=f"name = '{escape_query(filename)}' and '{folder_id}' in parents and trashed = false",
            fields="files(id,name,webViewLink,webContentLink,createdTime)",
            orderBy="createdTime desc",
            pageSize=10,
        ).execute()
        files = response.get("files", [])
        if files:
            return files[0]
    return None


def upload(service, pdf_path: str, filename: str, signed: bool) -> dict[str, Any]:
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF não encontrado para upload: {path}")
    metadata = {"name": filename, "parents": [folder_for(signed)]}
    media = MediaFileUpload(str(path), mimetype="application/pdf", resumable=False)
    return service.files().create(
        body=metadata,
        media_body=media,
        fields="id,name,webViewLink,webContentLink",
    ).execute()


def result_for(file: dict[str, Any] | None) -> dict[str, Any]:
    if not file:
        return {"success": True, "found": False}
    file_id = file.get("id")
    return {
        "success": True,
        "found": True,
        "file_id": file_id,
        "filename": file.get("name"),
        "web_view_url": file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view",
        "download_url": file.get("webContentLink") or f"https://drive.google.com/uc?id={file_id}&export=download",
    }


def main() -> int:
    try:
        if len(sys.argv) < 2:
            raise ValueError("Informe a ação: upload, find ou delete.")
        action = sys.argv[1]
        service = drive_service()

        if action == "upload" and len(sys.argv) == 5:
            pdf_path, filename = sys.argv[2], sys.argv[3]
            signed = sys.argv[4].lower() == "true"
            print(json.dumps(result_for(upload(service, pdf_path, filename, signed)), ensure_ascii=False))
            return 0

        if action == "find" and len(sys.argv) in {3, 4}:
            signed = None if len(sys.argv) == 3 else sys.argv[3].lower() == "true"
            print(json.dumps(result_for(find_file(service, sys.argv[2], signed)), ensure_ascii=False))
            return 0

        if action == "delete" and len(sys.argv) == 3:
            service.files().delete(fileId=sys.argv[2]).execute()
            print(json.dumps({"success": True, "deleted": True, "file_id": sys.argv[2]}))
            return 0

        raise ValueError("Parâmetros inválidos para service_order_drive.py.")
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
