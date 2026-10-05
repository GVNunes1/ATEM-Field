#!/usr/bin/env python3
"""Recover OS metadata from original Drive PDFs. Default is read-only preview.

Uses backend service-role credentials; never changes, uploads or deletes Drive files.
Each Drive file is inserted at most once. No signatures are reconstructed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from io import BytesIO
from email.message import Message
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from service_order_drive import drive_service, SIGNED_FOLDER_ID, UNSIGNED_FOLDER_ID, escape_query


LABELS = {
    "Atendimento": r"Atendimento em campo n[º°o]?",
    "Data": r"Data",
    "Hora_Chegada": r"Hora da chegada",
    "Hora_Saida": r"Hora da sa[ií]da",
    "Cliente": r"Cliente",
    "Fone": r"Fone",
    "Endereco": r"Endere[çc]o",
    "Contato": r"Contato",
    "Setor_Contato": r"setor",
    "Email": r"e-mail",
    "Equipamento": r"Equipamento",
    "Marca": r"marca",
    "Modelo": r"modelo",
    "Patrimonio": r"Patrim[oô]nio",
    "Serie": r"n[º°o]?\s*s[ée]rie",
    "Nome_Tecnico": r"Nome do t[ée]cnico",
    "Nome_Cliente": r"Nome do cliente",
}
# Stop at other printed labels, not at line wrapping within the value.
STOP = "|".join(LABELS.values()) + r"|Ass|data|Hora de in[ií]cio do servi[çc]o|Defeito|Servi[çc]o"


def extract_fields(text: str) -> dict[str, str]:
    result = {}
    for key, label in LABELS.items():
        match = re.search(
            rf"(?:^|\s){label}\s*:?\s*(.*?)\s*(?=(?:{STOP})\s*:|$)",
            text, flags=re.IGNORECASE | re.DOTALL,
        )
        if match:
            value = " ".join(match.group(1).split()).strip(" _")
            # Do not mistake entire sections/footers for short metadata fields.
            if value and len(value) <= 200:
                result[key] = value
    if result.get("Data") and not re.fullmatch(r"\d{2}/\d{2}/\d{4}", result["Data"]):
        result.pop("Data")
    return result


def record_for(file: dict, signed: bool, text: str) -> dict:
    fields = extract_fields(text)
    fields["_recovery"] = {
        "source": "google_drive_pdf", "file_id": file["id"],
        "partial_form": True, "status_source": "folder",
        "needs_review": not all(fields.get(k) for k in ("Cliente", "Nome_Tecnico", "Data")),
    }
    return {
        "id": "drive_" + file["id"], "drive_file_id": file["id"],
        "os_number": fields.get("Atendimento"), "status": "signed" if signed else "unsigned",
        "client_name": fields.get("Cliente"), "technician_name": fields.get("Nome_Tecnico"),
        "serial_number": fields.get("Serie"), "equipment_name": fields.get("Equipamento"),
        "service_date": fields.get("Data"), "form_data": fields,
        "pdf_filename": file["name"],
        "pdf_url": f"https://drive.google.com/file/d/{file['id']}/view",
        "created_at": file.get("createdTime") or datetime.now(timezone.utc).isoformat(),
    }


def database_request(method: str, params: dict, payload=None):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=representation"}
    data = None if payload is None else json.dumps(payload).encode()
    request = Request(base + "/rest/v1/service_orders?" + urlencode(params), data=data, headers=headers, method=method)
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def list_pdfs(service, root: str) -> list[dict]:
    folders, visited, files = [root], set(), []
    while folders:
        folder = folders.pop()
        if folder in visited:
            continue
        visited.add(folder)
        token = None
        while True:
            page = service.files().list(
                q=f"'{escape_query(folder)}' in parents and trashed = false",
                fields="nextPageToken,files(id,name,mimeType,size,createdTime)",
                pageSize=1000, pageToken=token, supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            for file in page.get("files", []):
                if file["mimeType"] == "application/vnd.google-apps.folder":
                    folders.append(file["id"])
                elif file["mimeType"] == "application/pdf":
                    files.append(file)
            token = page.get("nextPageToken")
            if not token:
                break
    return files


def recover(service, apply=False) -> dict:
    # Fail before any import if either original folder is inaccessible.
    for folder in (UNSIGNED_FOLDER_ID, SIGNED_FOLDER_ID):
        info = service.files().get(fileId=folder, fields="id,mimeType", supportsAllDrives=True).execute()
        if info["mimeType"] != "application/vnd.google-apps.folder":
            raise ValueError("A origem configurada não é uma pasta do Drive.")
    from pypdf import PdfReader
    report = {"mode": "apply" if apply else "preview", "found": 0, "imported": 0,
              "existing": 0, "readable": 0, "needs_review": 0, "errors": []}
    seen = set()
    for folder, signed in ((SIGNED_FOLDER_ID, True), (UNSIGNED_FOLDER_ID, False)):
        for file in list_pdfs(service, folder):
            if file["id"] in seen:
                continue
            seen.add(file["id"])
            report["found"] += 1
            try:
                # A matching regular OS id prevents reimporting newly created orders.
                regular_id = re.sub(r"\.pdf$", "", file["name"], flags=re.IGNORECASE)
                existing = database_request("GET", {"select": "id", "or":
                    f"(id.eq.\"{regular_id.replace(chr(34), '')}\",drive_file_id.eq.{file['id']})", "limit": "1"})
                if existing:
                    report["existing"] += 1
                    continue
                if int(file.get("size", 0)) > 25 * 1024 * 1024:
                    raise ValueError("PDF maior que o limite de leitura de 25 MB.")
                contents = service.files().get_media(fileId=file["id"], supportsAllDrives=True).execute()
                reader = PdfReader(BytesIO(contents))
                text = "\n".join(page.extract_text() or "" for page in reader.pages)
                record = record_for(file, signed, text)
                report["readable"] += bool(text.strip())
                report["needs_review"] += bool(record["form_data"]["_recovery"]["needs_review"])
                if apply:
                    inserted = database_request("POST", {"on_conflict": "drive_file_id"}, record)
                    report["imported"] += len(inserted)
                    report["existing"] += not bool(inserted)
            except Exception as error:
                # Do not log credentials, PDF contents or remote error response bodies.
                report["errors"].append({"file_id": file["id"], "error_type": type(error).__name__})
    return report


def recover_public_manifest(manifest: dict, apply=False) -> dict:
    """Read only publicly downloadable file IDs explicitly copied from Drive UI.

    Never accepts arbitrary URLs or credentials. Does not change sharing settings.
    """
    from pypdf import PdfReader
    existing = database_request('GET', {'select': 'id,drive_file_id,form_data,pdf_filename', 'limit': '10000'})
    existing_ids = {row.get('drive_file_id') for row in existing}
    existing_regular_ids = {row['id'] for row in existing if not row['id'].startswith('drive_')}
    hashes = {row.get('form_data', {}).get('_recovery', {}).get('sha256') for row in existing}
    report = {'mode': 'apply' if apply else 'preview', 'found': 0, 'imported': 0,
              'existing': 0, 'identical_pdf': 0, 'needs_review': 0, 'errors': [], 'records': []}
    seen = set()
    for status in ('signed', 'unsigned'):
        for file_id in manifest.get(status, []):
            if not re.fullmatch(r'[A-Za-z0-9_-]{10,100}', file_id):
                raise ValueError('Identificador de arquivo inválido.')
            if file_id in seen:
                continue
            seen.add(file_id)
            report['found'] += 1
            if file_id in existing_ids:
                report['existing'] += 1
                continue
            try:
                url = 'https://drive.google.com/uc?' + urlencode({'id': file_id, 'export': 'download'})
                with urlopen(url, timeout=60) as response:
                    contents = response.read(25 * 1024 * 1024 + 1)
                    header = Message()
                    header['content-disposition'] = response.headers.get('Content-Disposition', '')
                    filename = header.get_filename()
                if len(contents) > 25 * 1024 * 1024 or not contents.startswith(b'%PDF-'):
                    raise ValueError('Resposta não contém PDF válido dentro do limite de 25 MB.')
                if not filename or not filename.lower().endswith('.pdf'):
                    raise ValueError('Drive não informou nome original do PDF.')
                if re.sub(r'\.pdf$', '', filename, flags=re.IGNORECASE) in existing_regular_ids:
                    report['existing'] += 1
                    continue
                digest = hashlib.sha256(contents).hexdigest()
                if digest in hashes:
                    report['identical_pdf'] += 1
                    continue
                reader = PdfReader(BytesIO(contents))
                text = '\n'.join(page.extract_text() or '' for page in reader.pages)
                record = record_for({'id': file_id, 'name': filename}, status == 'signed', text)
                record['form_data']['_recovery']['sha256'] = digest
                record['form_data']['_recovery']['access_method'] = 'public_download_observed_in_browser'
                timestamp = re.search(r'_(\d{8})_(\d{6})\.pdf$', filename, re.IGNORECASE)
                if timestamp:
                    try:
                        from zoneinfo import ZoneInfo
                        created = datetime.strptime(''.join(timestamp.groups()), '%Y%m%d%H%M%S')
                        record['created_at'] = created.replace(tzinfo=ZoneInfo('America/Sao_Paulo')).isoformat()
                        record['form_data']['_recovery']['created_at_source'] = 'filename'
                    except (ValueError, KeyError):
                        pass
                report['needs_review'] += bool(record['form_data']['_recovery']['needs_review'])
                hashes.add(digest)
                report['records'].append({'file_id': file_id, 'filename': filename,
                    'client': record['client_name'], 'technician': record['technician_name'],
                    'date': record['service_date'], 'serial': record['serial_number']})
                if apply:
                    inserted = database_request('POST', {'on_conflict': 'drive_file_id'}, record)
                    report['imported'] += len(inserted)
            except Exception as error:
                report['errors'].append({'file_id': file_id, 'error_type': type(error).__name__})
            print(json.dumps({'processed': report['found'], 'imported': report['imported'],
                              'errors': len(report['errors'])}), flush=True)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Insert recovered metadata; otherwise preview only.")
    parser.add_argument('--public-manifest', type=Path, help='Local JSON of signed/unsigned file IDs copied from Drive UI.')
    parser.add_argument('--report', type=Path, help='Write a private recovery audit report locally.')
    args = parser.parse_args()
    try:
        report = (recover_public_manifest(json.loads(args.public_manifest.read_text(encoding='utf-8')), apply=args.apply)
                  if args.public_manifest else recover(drive_service(), apply=args.apply))
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: v for k, v in report.items() if k != 'records'}, ensure_ascii=False))
        return 1 if report["errors"] else 0
    except Exception as error:
        status = getattr(getattr(error, "resp", None), "status", None)
        print(json.dumps({"success": False, "http_status": status, "error_type": type(error).__name__,
            "message": "Reconstrução não iniciada. Verifique acesso às duas pastas e credenciais do backend."}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
