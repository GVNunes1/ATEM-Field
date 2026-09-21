"""Conditional Calendar mutations. One JSON request on stdin, one result on stdout."""

import copy
import hashlib
import json
import os
import sys

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from google_calendar_credentials import (
    CalendarAuthenticationRequired,
    calendar_can_write,
    credentials_can_write,
    load_credentials,
    save_credentials,
)


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

EDITABLE_FIELDS = {"summary", "description", "location", "start", "end", "status", "extendedProperties"}
OPERATION_PROPERTY = "atem_operation_id"


def emit(payload, exit_code=0):
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    raise SystemExit(exit_code)


def validate_request(payload):
    if not isinstance(payload, dict):
        raise ValueError("A alteração deve ser um objeto JSON.")
    for key in ("calendar_id", "operation_id"):
        if not isinstance(payload.get(key), str) or not payload[key].strip():
            raise ValueError("{} é obrigatório.".format(key))
    if len(payload["operation_id"]) > 1024:
        raise ValueError("Identificador da operação muito longo.")
    configured_ids = {item.strip() for item in os.environ.get("GOOGLE_CALENDAR_IDS", "").split(",") if item.strip()}
    if configured_ids and payload["calendar_id"] not in configured_ids:
        raise ValueError("Esta agenda não está habilitada para sincronização.")
    operation = payload.get("operation", "patch")
    if operation not in {"patch", "insert", "delete"}:
        raise ValueError("Operação de agenda inválida.")
    if operation == "delete":
        if not isinstance(payload.get("event_id"), str) or not payload["event_id"].strip():
            raise ValueError("event_id é obrigatório para excluir um evento.")
        return operation
    if operation == "patch":
        for key in ("event_id", "expected_etag"):
            if not isinstance(payload.get(key), str) or not payload[key].strip():
                raise ValueError("{} é obrigatório para editar um evento.".format(key))
        if payload["expected_etag"].strip() == "*":
            raise ValueError("A versão específica do evento é obrigatória.")
        if "\r" in payload["expected_etag"] or "\n" in payload["expected_etag"]:
            raise ValueError("Versão de evento inválida.")
    patch = payload.get("event_patch")
    if not isinstance(patch, dict) or not patch:
        raise ValueError("Informe os campos alterados do evento.")
    unknown = set(patch) - EDITABLE_FIELDS
    if unknown:
        raise ValueError("Campos de evento não suportados: {}.".format(", ".join(sorted(unknown))))
    for key in ("start", "end"):
        if key in patch:
            value = patch[key]
            if not isinstance(value, dict) or bool(value.get("date")) == bool(value.get("dateTime")):
                raise ValueError("{} deve conter uma data ou uma data/hora.".format(key))
    if "status" in patch and patch["status"] not in {"confirmed", "tentative", "cancelled"}:
        raise ValueError("Status de evento inválido.")
    if "extendedProperties" in patch:
        properties = patch["extendedProperties"]
        if not isinstance(properties, dict) or set(properties) - {"private"}:
            raise ValueError("Somente propriedades privadas do ATEM podem ser alteradas.")
        private = properties.get("private", {})
        if not isinstance(private, dict) or any(
            not key.startswith("atem_") or len(key) > 44 or (value is not None and (not isinstance(value, str) or len(value) > 1024))
            for key, value in private.items()
        ):
            raise ValueError("Propriedades privadas do evento inválidas.")
    if operation == "insert" and not all(key in patch for key in ("summary", "start", "end")):
        raise ValueError("Um novo evento precisa de título, início e fim.")
    return operation


def operation_was_applied(event, operation_id):
    return ((event.get("extendedProperties") or {}).get("private") or {}).get(OPERATION_PROPERTY) == operation_id


def prepare_patch(event, changes, operation_id):
    patch = copy.deepcopy(changes)
    for key in ("start", "end"):
        if key in patch:
            if patch[key].get("date"):
                patch[key]["dateTime"] = None
                patch[key]["timeZone"] = None
            else:
                patch[key]["date"] = None
    properties = copy.deepcopy(event.get("extendedProperties") or {})
    private = dict(properties.get("private") or {})
    private.update(patch.get("extendedProperties", {}).get("private", {}))
    private[OPERATION_PROPERTY] = operation_id
    properties["private"] = private
    patch["extendedProperties"] = properties
    return patch


def conflict_result(remote_event, message=None):
    return {
        "success": False,
        "conflict": True,
        "retryable": False,
        "remote_event": remote_event,
        "error": message or "O evento foi alterado no Google. Revise as duas versões antes de reenviar.",
    }


def write_event(service, payload):
    operation = validate_request(payload)
    calendar_id = payload["calendar_id"]
    calendar = service.calendarList().get(calendarId=calendar_id).execute()
    if not calendar_can_write(calendar):
        return {"success": False, "read_only": True, "retryable": False,
                "error": "A conta conectada não pode editar esta agenda do Google."}
    operation_id = payload["operation_id"]
    events = service.events()
    if operation == "delete":
        event_id = payload["event_id"]
        try:
            events.delete(calendarId=calendar_id, eventId=event_id, sendUpdates="none").execute()
            return {"success": True, "deleted": True, "calendar_id": calendar_id}
        except HttpError as error:
            if getattr(error.resp, "status", None) in (404, 410):
                return {"success": True, "deleted": True, "calendar_id": calendar_id, "already_deleted": True}
            raise

    if operation == "insert":
        # Calendar accepts lower-case base32hex IDs; a hex digest satisfies that
        # alphabet and makes a retry after a lost response safe.
        event_id = "atem" + hashlib.sha256((calendar_id + "\0" + operation_id).encode("utf-8")).hexdigest()
        body = prepare_patch({}, payload["event_patch"], operation_id)
        body["id"] = event_id
        try:
            result = events.insert(calendarId=calendar_id, body=body, sendUpdates="none").execute()
        except HttpError as error:
            if getattr(error.resp, "status", None) != 409:
                raise
            existing = events.get(calendarId=calendar_id, eventId=event_id).execute()
            if operation_was_applied(existing, operation_id):
                return {"success": True, "event": existing, "idempotent": True, "calendar_id": calendar_id}
            return conflict_result(existing)
        return {"success": True, "event": result, "calendar_id": calendar_id}

    event_id = payload["event_id"]
    current = events.get(calendarId=calendar_id, eventId=event_id).execute()
    if operation_was_applied(current, operation_id):
        return {"success": True, "event": current, "idempotent": True, "calendar_id": calendar_id}
    if current.get("etag") != payload["expected_etag"]:
        return conflict_result(current)
    if current.get("status") == "cancelled" and payload["event_patch"].get("status") != "cancelled":
        return conflict_result(current, "O evento foi cancelado no Google. Revise a agenda antes de reenviar.")
    body = prepare_patch(current, payload["event_patch"], operation_id)
    request = events.patch(calendarId=calendar_id, eventId=event_id, body=body, sendUpdates="none")
    request.headers["If-Match"] = payload["expected_etag"]
    try:
        result = request.execute()
    except HttpError as error:
        if getattr(error.resp, "status", None) != 412:
            raise
        latest = events.get(calendarId=calendar_id, eventId=event_id).execute()
        if operation_was_applied(latest, operation_id):
            return {"success": True, "event": latest, "idempotent": True, "calendar_id": calendar_id}
        return conflict_result(latest)
    return {"success": True, "event": result, "calendar_id": calendar_id}


def http_error_result(error):
    status = getattr(error.resp, "status", None)
    try:
        details = json.loads(error.content.decode("utf-8"))
        reasons = {item.get("reason") for item in details.get("error", {}).get("errors", [])}
    except (ValueError, TypeError, AttributeError):
        reasons = set()
    quota_error = bool(reasons.intersection({"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}))
    return {"success": False, "http_status": status,
            "auth_required": status == 401, "read_only": status == 403 and not quota_error,
            "not_found": status in {404, 410},
            "retryable": quota_error or status == 429 or bool(status and status >= 500),
            "error": "O Google Agenda recusou a alteração (HTTP {}).".format(status)}


def main():
    payload = json.load(sys.stdin)
    validate_request(payload)
    credentials = load_credentials(refresh=True)
    if not credentials or not credentials.valid:
        emit({"success": False, "auth_required": True, "retryable": False,
              "error": "Conecte sua conta Google para sincronizar a agenda."}, 2)
    if not credentials_can_write(credentials):
        emit({"success": False, "write_auth_required": True, "retryable": False,
              "error": "Autorize novamente o Google Agenda com permissão para editar eventos."}, 2)
    save_credentials(credentials)
    service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
    result = write_event(service, payload)
    emit(result, 0 if result.get("success") else 3)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except CalendarAuthenticationRequired as error:
        emit({"success": False, "auth_required": True, "retryable": False, "error": str(error)}, 2)
    except HttpError as error:
        emit(http_error_result(error), 1)
    except ValueError as error:
        emit({"success": False, "validation_error": True, "retryable": False, "error": str(error)}, 1)
    except Exception:
        emit({"success": False, "retryable": True,
              "error": "Falha na comunicação com o Google Agenda. A operação pode ser reenviada."}, 1)
