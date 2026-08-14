import json
import os
import sys
from datetime import datetime, timezone

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from google_calendar_credentials import (
    DATA_DIR,
    auth_status,
    load_credentials,
    read_json_file,
    save_credentials,
    write_json_file,
)


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

SYNC_STATE_PATH = DATA_DIR / "google-calendar-sync-tokens.json"


def emit(payload, exit_code=0):
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    raise SystemExit(exit_code)


def list_calendars(service):
    calendars = []
    page_token = None
    while True:
        response = service.calendarList().list(
            maxResults=250,
            pageToken=page_token,
            showHidden=False,
        ).execute()
        calendars.extend(response.get("items", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            return calendars


def initial_time_min():
    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month - 1
    if month == 0:
        year -= 1
        month = 12
    return datetime(year, month, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def event_payload(event, calendar_name):
    start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
    if not start:
        return None

    date_part = start.split("T")[0]
    time_part = start.split("T")[1][:5] if "T" in start else "08:00"
    summary = event.get("summary") or "Atendimento Agendado"
    description = event.get("description") or "Equipe de Campo"
    location = event.get("location") or summary
    return {
        "external_id": "GGCAL-{}".format(event.get("id")),
        "title": summary,
        "client_name": summary,
        "client_address": location,
        "appointment_date": date_part,
        "appointment_time": time_part,
        "technicians_raw": description,
        "calendar_name": calendar_name,
        "is_sobreaviso": "sobreaviso" in summary.lower(),
    }


def fetch_calendar_changes(service, calendar, sync_token):
    calendar_id = calendar.get("id")
    calendar_name = calendar.get("summary") or "Google Calendar"
    extracted = []
    deleted = []
    page_token = None
    latest_sync_token = sync_token

    while True:
        arguments = {
            "calendarId": calendar_id,
            "singleEvents": True,
            "showDeleted": True,
            "maxResults": 250,
            "pageToken": page_token,
        }
        if sync_token:
            arguments["syncToken"] = sync_token
        else:
            arguments["timeMin"] = initial_time_min()

        response = service.events().list(**arguments).execute()
        for event in response.get("items", []):
            external_id = "GGCAL-{}".format(event.get("id"))
            if event.get("status") == "cancelled":
                deleted.append(external_id)
                continue
            parsed = event_payload(event, calendar_name)
            if parsed:
                extracted.append(parsed)

        page_token = response.get("nextPageToken")
        latest_sync_token = response.get("nextSyncToken") or latest_sync_token
        if not page_token:
            break

    return extracted, deleted, latest_sync_token


def main():
    if "--status" in sys.argv:
        emit({"success": True, **auth_status(refresh=True)})

    credentials = load_credentials(refresh=True)
    if not credentials or not credentials.valid:
        emit({
            "success": False,
            "auth_required": True,
            "error": "A conta Google precisa ser conectada uma vez para ativar a sincronização automática.",
        }, 2)

    save_credentials(credentials)
    service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
    all_calendars = list_calendars(service)
    configured_calendar_ids = {
        item.strip() for item in os.environ.get("GOOGLE_CALENDAR_IDS", "").split(",") if item.strip()
    }
    calendars = []
    for calendar in all_calendars:
        calendar_id = (calendar.get("id") or "").lower()
        calendar_name = (calendar.get("summary") or "").lower()
        if configured_calendar_ids and calendar.get("id") not in configured_calendar_ids:
            continue
        if "holiday" in calendar_id or "feriados" in calendar_name:
            continue
        calendars.append(calendar)

    sync_state = read_json_file(SYNC_STATE_PATH, {})
    next_state = dict(sync_state)
    extracted = []
    deleted = []
    warnings = []
    synchronized_calendars = 0

    for calendar in calendars:
        calendar_id = calendar.get("id")
        calendar_name = calendar.get("summary") or "Google Calendar"
        sync_token = sync_state.get(calendar_id)
        try:
            try:
                items, removed, next_token = fetch_calendar_changes(service, calendar, sync_token)
            except HttpError as error:
                if sync_token and getattr(error.resp, "status", None) == 410:
                    items, removed, next_token = fetch_calendar_changes(service, calendar, None)
                else:
                    raise
            extracted.extend(items)
            deleted.extend(removed)
            if next_token:
                next_state[calendar_id] = next_token
            synchronized_calendars += 1
            sys.stderr.write("Agenda '{}': {} alteração(ões).\n".format(calendar_name, len(items) + len(removed)))
        except Exception as error:
            warnings.append("{}: {}".format(calendar_name, error))

    if calendars and synchronized_calendars == 0:
        emit({
            "success": False,
            "auth_required": False,
            "error": "Não foi possível ler nenhuma agenda do Google.",
            "warnings": warnings,
        }, 1)

    write_json_file(SYNC_STATE_PATH, next_state)
    emit({
        "success": True,
        "incremental": bool(sync_state),
        "count": len(extracted),
        "deleted_count": len(deleted),
        "calendar_count": synchronized_calendars,
        "data": extracted,
        "deleted_external_ids": sorted(set(deleted)),
        "warnings": warnings,
    })


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        emit({"success": False, "auth_required": False, "error": str(error)}, 1)
