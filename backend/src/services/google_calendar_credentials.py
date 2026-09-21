import base64
import json
import os
import pickle
import shutil
from pathlib import Path

from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials


SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
]
WRITE_SCOPES = {
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
}
SERVICE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SERVICE_DIR.parent.parent
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_TOKEN_PATH = DATA_DIR / "google-calendar-token.json"
DEFAULT_CREDENTIALS_PATH = DATA_DIR / "google-calendar-credentials.json"


class CalendarAuthenticationRequired(RuntimeError):
    """Raised when Google requires a new interactive authorization."""


def _clean_env_json(raw, var_name=""):
    """Sanitizes raw environment values that may contain KEY=, quotes or Base64."""
    if not raw or not isinstance(raw, str):
        return None, None
    s = raw.strip()
    if var_name:
        if s.startswith(f"{var_name}="):
            s = s[len(var_name) + 1:].strip()
        elif s.startswith(f"export {var_name}="):
            s = s[len(f"export {var_name}=") :].strip()
    # Strip wrapping quotes
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        s = s[1:-1].strip()
    # Direct JSON attempt
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data, json.dumps(data, ensure_ascii=False)
    except Exception:
        pass
    # Base64 attempt
    try:
        decoded = base64.b64decode(s).decode("utf-8")
        data = json.loads(decoded)
        if isinstance(data, dict):
            return data, json.dumps(data, ensure_ascii=False)
    except Exception:
        pass
    return None, None


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
    configured_path = _configured_path("GOOGLE_CALENDAR_TOKEN_PATH", DEFAULT_TOKEN_PATH)
    raw_env_token = os.environ.get("GOOGLE_CALENDAR_TOKEN_JSON", "")
    parsed_env, clean_json = _clean_env_json(raw_env_token, "GOOGLE_CALENDAR_TOKEN_JSON")

    if parsed_env and clean_json:
        should_write = False
        if not configured_path.exists():
            should_write = True
        else:
            try:
                disk_data = json.loads(configured_path.read_text(encoding="utf-8"))
                # Se o token do ambiente tiver um refresh_token ou access_token diferente/novo, atualize o disco
                if not isinstance(disk_data, dict):
                    should_write = True
                elif parsed_env.get("refresh_token") and parsed_env.get("refresh_token") != disk_data.get("refresh_token"):
                    should_write = True
            except Exception:
                should_write = True

        if should_write:
            _atomic_write(configured_path, clean_json)

    return configured_path


def credentials_path():
    raw_env_credentials = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_JSON", "")
    parsed_env, clean_json = _clean_env_json(raw_env_credentials, "GOOGLE_CALENDAR_CREDENTIALS_JSON")

    if parsed_env and clean_json:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        should_write = False
        if not DEFAULT_CREDENTIALS_PATH.exists():
            should_write = True
        else:
            try:
                disk_data = json.loads(DEFAULT_CREDENTIALS_PATH.read_text(encoding="utf-8"))
                if disk_data != parsed_env:
                    should_write = True
            except Exception:
                should_write = True

        if should_write:
            DEFAULT_CREDENTIALS_PATH.write_text(clean_json, encoding="utf-8")
        return DEFAULT_CREDENTIALS_PATH

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
    serialized = json.loads(credentials.to_json())
    # OAuth may grant fewer scopes than requested. Persist the granted set so a
    # reload never mistakes the requested permissions for actual write access.
    serialized["scopes"] = credential_scopes(credentials)
    _atomic_write(token_path(), json.dumps(serialized))


def credential_scopes(credentials):
    if not credentials:
        return []
    granted = getattr(credentials, "granted_scopes", None)
    scopes = granted if granted is not None else getattr(credentials, "scopes", None)
    if isinstance(scopes, str):
        scopes = scopes.split()
    return sorted(set(scopes or []))


def credentials_can_write(credentials):
    return bool(WRITE_SCOPES.intersection(credential_scopes(credentials)))


def calendar_can_write(calendar):
    return calendar.get("accessRole") in {"owner", "writer"}


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
            # Do not substitute the newly requested scopes for scopes previously
            # authorized by the user. Read-only tokens stay read-only until OAuth.
            credentials = Credentials.from_authorized_user_file(str(stored_token))
        except Exception:
            credentials = None

    if credentials is None:
        credentials = _migrate_legacy_pickle()

    if credentials and refresh and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
            save_credentials(credentials)
        except RefreshError as error:
            message = str(error)
            if "invalid_grant" in message.lower():
                raise CalendarAuthenticationRequired(
                    "O refresh token do Google expirou ou foi revogado. "
                    "Autorize novamente uma vez e confirme que o aplicativo OAuth está em produção."
                ) from error
            raise

    return credentials


def auth_status(refresh=True):
    configured = credentials_path() is not None
    try:
        credentials = load_credentials(refresh=refresh)
        authenticated = bool(credentials and credentials.valid)
        write_authorized = authenticated and credentials_can_write(credentials)
        return {
            "configured": configured,
            "authenticated": authenticated,
            "refreshable": bool(credentials and credentials.refresh_token),
            "expires_at": credentials.expiry.isoformat() + "Z" if credentials and credentials.expiry else None,
            "requires_auth": not authenticated,
            "write_authorized": write_authorized,
            "requires_write_auth": not write_authorized,
            "granted_scopes": credential_scopes(credentials),
        }
    except Exception as error:
        return {
            "configured": configured,
            "authenticated": False,
            "refreshable": False,
            "expires_at": None,
            "requires_auth": True,
            "write_authorized": False,
            "requires_write_auth": True,
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
