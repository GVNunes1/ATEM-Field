import json
import os
import pickle
import shutil
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials


SCOPES = ["https://www.googleapis.com/auth/calendar"]
SERVICE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SERVICE_DIR.parent.parent
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_TOKEN_PATH = DATA_DIR / "google-calendar-token.json"
DEFAULT_CREDENTIALS_PATH = DATA_DIR / "google-calendar-credentials.json"


def _legacy_directories():
    configured = os.environ.get("GOOGLE_CALENDAR_LEGACY_DIR", "").strip()
    directories = []
    if configured:
        directories.append(Path(configured).expanduser())
    directories.append(
        Path.home()
        / "Documents"
        / "Agenda Online"
        / "Aplicativo_Monitor_Agendas"
        / "Aplicativo_Monitor_Agendas"
        / "src"
    )
    return directories


def _configured_path(environment_key, default_path):
    configured = os.environ.get(environment_key, "").strip()
    return Path(configured).expanduser() if configured else default_path


def token_path():
    return _configured_path("GOOGLE_CALENDAR_TOKEN_PATH", DEFAULT_TOKEN_PATH)


def credentials_path():
    configured = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_PATH", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend([DEFAULT_CREDENTIALS_PATH, BACKEND_DIR / "credentials.json"])
    candidates.extend(directory / "credentials.json" for directory in _legacy_directories())

    source = next((candidate for candidate in candidates if candidate.is_file()), None)
    if source is None:
        return None

    if source != DEFAULT_CREDENTIALS_PATH and not configured:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if not DEFAULT_CREDENTIALS_PATH.exists():
            shutil.copy2(str(source), str(DEFAULT_CREDENTIALS_PATH))
        return DEFAULT_CREDENTIALS_PATH
    return source


def _atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(str(temporary), str(path))


def save_credentials(credentials):
    _atomic_write(token_path(), credentials.to_json())


def _migrate_legacy_pickle():
    candidates = []
    source_credentials = credentials_path()
    if source_credentials:
        candidates.append(source_credentials.parent / "token.pickle")
    candidates.extend(directory / "token.pickle" for directory in _legacy_directories())

    for candidate in candidates:
        if not candidate.is_file():
            continue
        try:
            with candidate.open("rb") as handle:
                legacy_credentials = pickle.load(handle)
            if not isinstance(legacy_credentials, Credentials):
                continue
            save_credentials(legacy_credentials)
            return legacy_credentials
        except Exception:
            continue
    return None


def load_credentials(refresh=True):
    stored_token = token_path()
    credentials = None
    if stored_token.is_file():
        try:
            credentials = Credentials.from_authorized_user_file(str(stored_token), SCOPES)
        except Exception:
            credentials = None

    if credentials is None:
        credentials = _migrate_legacy_pickle()

    if credentials and refresh and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        save_credentials(credentials)

    return credentials


def auth_status(refresh=True):
    configured = credentials_path() is not None
    try:
        credentials = load_credentials(refresh=refresh)
        authenticated = bool(credentials and credentials.valid)
        return {
            "configured": configured,
            "authenticated": authenticated,
            "refreshable": bool(credentials and credentials.refresh_token),
            "expires_at": credentials.expiry.isoformat() + "Z" if credentials and credentials.expiry else None,
            "requires_auth": not authenticated,
        }
    except Exception as error:
        return {
            "configured": configured,
            "authenticated": False,
            "refreshable": False,
            "expires_at": None,
            "requires_auth": True,
            "error": str(error),
        }


def clear_incremental_sync_state():
    state_path = DATA_DIR / "google-calendar-sync-tokens.json"
    if state_path.exists():
        state_path.unlink()


def read_json_file(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else fallback
    except Exception:
        return fallback


def write_json_file(path, value):
    _atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2))
