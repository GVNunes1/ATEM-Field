"""Google sync tests: fake API responses only; never use a real token/calendar."""

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "services"))

from google.oauth2.credentials import Credentials
from googleapiclient.errors import HttpError
from httplib2 import Response

import google_calendar_credentials as credentials_module
import import_agenda as importer
import write_calendar_event as writer


def http_error(status, reason="conditionNotMet"):
    return HttpError(Response({"status": str(status)}), json.dumps({
        "error": {"message": "fake API response", "errors": [{"reason": reason}]}
    }).encode("utf-8"))


class FakeRequest:
    def __init__(self, value=None, error=None):
        self.value = value
        self.error = error
        self.headers = {}

    def execute(self):
        if self.error:
            raise self.error
        return copy.deepcopy(self.value)


class FakeCalendarService:
    def __init__(self, current=None, role="writer"):
        self.current = copy.deepcopy(current or {
            "id": "event-one", "etag": '"v1"', "summary": "Original",
            "start": {"date": "2026-09-21"}, "end": {"date": "2026-09-22"},
            "extendedProperties": {"private": {"other_app": "keep"}, "shared": {"source": "keep"}},
            "attendees": [{"email": "fake@example.test"}],
            "conferenceData": {"conferenceId": "keep"},
        })
        self.calendar = {"id": "team@example.test", "accessRole": role}
        self.calls = []
        self.get_results = []
        self.list_results = []
        self.patch_error = None
        self.insert_error = None
        self.patch_request = None

    def calendarList(self):
        outer = self

        class CalendarList:
            def get(self, **arguments):
                outer.calls.append(("calendar.get", arguments))
                return FakeRequest(outer.calendar)

            def list(self, **arguments):
                return FakeRequest({"items": [outer.calendar]})

        return CalendarList()

    def events(self):
        return self

    def get(self, **arguments):
        self.calls.append(("events.get", arguments))
        return FakeRequest(self.get_results.pop(0) if self.get_results else self.current)

    def patch(self, **arguments):
        self.calls.append(("events.patch", arguments))
        result = copy.deepcopy(self.current)
        result.update(arguments["body"])
        result["etag"] = '"v2"'
        self.patch_request = FakeRequest(result, self.patch_error)
        return self.patch_request

    def insert(self, **arguments):
        self.calls.append(("events.insert", arguments))
        return FakeRequest(arguments["body"], self.insert_error)

    def list(self, **arguments):
        self.calls.append(("events.list", arguments))
        return FakeRequest(self.list_results.pop(0))


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"GOOGLE_CALENDAR_IDS": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.request = {"calendar_id": "team@example.test", "event_id": "event-one",
                        "expected_etag": '"v1"', "operation_id": "operation-1",
                        "event_patch": {"summary": "Updated"}}

    def test_patch_preserves_unrelated_data_and_uses_conditional_header(self):
        service = FakeCalendarService()
        original = copy.deepcopy(service.current)
        result = writer.write_event(service, self.request)
        self.assertTrue(result["success"])
        arguments = next(args for name, args in service.calls if name == "events.patch")
        self.assertEqual(service.patch_request.headers["If-Match"], '"v1"')
        self.assertEqual(arguments["sendUpdates"], "none")
        self.assertEqual(set(arguments["body"]), {"summary", "extendedProperties"})
        self.assertEqual(arguments["body"]["extendedProperties"]["private"]["other_app"], "keep")
        self.assertEqual(arguments["body"]["extendedProperties"]["shared"], {"source": "keep"})
        self.assertEqual(result["event"]["attendees"], original["attendees"])
        self.assertEqual(result["event"]["conferenceData"], original["conferenceData"])
        self.assertEqual(service.current, original)

    def test_stale_etag_returns_conflict_without_mutation(self):
        service = FakeCalendarService()
        self.request["expected_etag"] = '"old"'
        result = writer.write_event(service, self.request)
        self.assertTrue(result["conflict"])
        self.assertEqual(result["remote_event"]["etag"], '"v1"')
        self.assertFalse(any(name == "events.patch" for name, _ in service.calls))

    def test_concurrent_change_after_get_returns_latest_on_412(self):
        service = FakeCalendarService()
        latest = {**service.current, "etag": '"other-user"', "summary": "Google edit"}
        service.get_results = [service.current, latest]
        service.patch_error = http_error(412)
        result = writer.write_event(service, self.request)
        self.assertTrue(result["conflict"])
        self.assertEqual(result["remote_event"]["summary"], "Google edit")

    def test_retry_of_applied_operation_is_idempotent_even_with_old_etag(self):
        service = FakeCalendarService()
        service.current["extendedProperties"]["private"]["atem_operation_id"] = "operation-1"
        self.request["expected_etag"] = '"old"'
        result = writer.write_event(service, self.request)
        self.assertTrue(result["idempotent"])
        self.assertFalse(any(name == "events.patch" for name, _ in service.calls))

    def test_duplicate_worker_412_is_success_if_same_operation_won(self):
        service = FakeCalendarService()
        applied = copy.deepcopy(service.current)
        applied["extendedProperties"]["private"]["atem_operation_id"] = "operation-1"
        service.get_results = [service.current, applied]
        service.patch_error = http_error(412)
        self.assertTrue(writer.write_event(service, self.request)["idempotent"])

    def test_read_only_calendar_never_mutates(self):
        service = FakeCalendarService(role="reader")
        self.assertTrue(writer.write_event(service, self.request)["read_only"])
        self.assertFalse(any(name.startswith("events.") for name, _ in service.calls))

    def test_patch_does_not_resurrect_cancelled_event(self):
        service = FakeCalendarService()
        service.current["status"] = "cancelled"
        self.assertTrue(writer.write_event(service, self.request)["conflict"])
        self.assertFalse(any(name == "events.patch" for name, _ in service.calls))

    def test_rejects_full_event_overwrite_or_invitation_fields(self):
        self.request["event_patch"]["attendees"] = []
        with self.assertRaises(ValueError):
            writer.write_event(FakeCalendarService(), self.request)

    def test_missing_or_wildcard_etag_is_rejected(self):
        for etag in (None, "", "*", "bad\r\nheader"):
            self.request["expected_etag"] = etag
            with self.subTest(etag=etag), self.assertRaises(ValueError):
                writer.validate_request(self.request)

    def test_all_day_conversion_explicitly_clears_datetime(self):
        changes = {"start": {"date": "2026-09-23"}, "end": {"date": "2026-09-24"}}
        result = writer.prepare_patch({}, changes, "operation")
        self.assertIsNone(result["start"]["dateTime"])
        self.assertIsNone(result["end"]["timeZone"])
        self.assertEqual(result["end"]["date"], "2026-09-24")
        self.assertEqual(changes["start"], {"date": "2026-09-23"})

    def test_timed_conversion_explicitly_clears_all_day_date(self):
        result = writer.prepare_patch({}, {"start": {"dateTime": "2026-09-23T09:00:00-03:00"}}, "operation")
        self.assertIsNone(result["start"]["date"])

    def test_insert_has_deterministic_id_and_suppresses_notifications(self):
        payload = {"calendar_id": "team@example.test", "operation_id": "create-1", "operation": "insert",
                   "event_patch": {"summary": "New", "start": {"date": "2026-09-21"}, "end": {"date": "2026-09-22"}}}
        service = FakeCalendarService()
        first = writer.write_event(service, payload)
        second = writer.write_event(FakeCalendarService(), payload)
        self.assertEqual(first["event"]["id"], second["event"]["id"])
        self.assertRegex(first["event"]["id"], r"^[0-9a-v]{5,1024}$")
        self.assertEqual(next(args for name, args in service.calls if name == "events.insert")["sendUpdates"], "none")

    def test_duplicate_insert_recovers_saved_event(self):
        service = FakeCalendarService()
        service.insert_error = http_error(409)
        service.current["extendedProperties"]["private"]["atem_operation_id"] = "operation-1"
        self.request["operation"] = "insert"
        self.request["event_patch"].update({"start": {"date": "2026-09-21"}, "end": {"date": "2026-09-22"}})
        self.assertTrue(writer.write_event(service, self.request)["idempotent"])

    def test_unconfigured_calendar_is_rejected(self):
        with patch.dict(os.environ, {"GOOGLE_CALENDAR_IDS": "different@example.test"}), self.assertRaises(ValueError):
            writer.validate_request(self.request)

    def test_rate_limit_403_remains_retryable(self):
        result = writer.http_error_result(http_error(403, "rateLimitExceeded"))
        self.assertTrue(result["retryable"])
        self.assertFalse(result["read_only"])


class ImportTests(unittest.TestCase):
    def test_event_retains_all_day_end_and_calendar_identity(self):
        event = {"id": "shared-id", "etag": '"one"', "updated": "2026-09-21T12:00:00Z",
                 "start": {"date": "2026-09-21"}, "end": {"date": "2026-09-23"},
                 "description": "Equipe", "status": "tentative"}
        calendar = {"id": "first@example.test", "summary": "First", "accessRole": "writer"}
        first = importer.event_payload(event, calendar, True)
        second = importer.event_payload(event, {**calendar, "id": "second@example.test"}, True)
        self.assertEqual(first["external_id"], "GGCAL-shared-id")
        self.assertNotEqual(first["google_calendar_id"], second["google_calendar_id"])
        self.assertEqual(first["google_event"], event)
        self.assertTrue(first["calendar_writable"])
        self.assertFalse(importer.event_payload(event, calendar, False)["calendar_writable"])

    def test_incremental_pages_preserve_identity_of_deletions(self):
        service = FakeCalendarService()
        service.list_results = [
            {"items": [{"id": "deleted", "status": "cancelled", "etag": '"deleted-version"'}], "nextPageToken": "page2"},
            {"items": [{"id": "live", "start": {"dateTime": "2026-09-21T09:00:00-03:00"}}], "nextSyncToken": "next-token"},
        ]
        data, deleted, token = importer.fetch_calendar_changes(service, service.calendar, "old-token", True)
        self.assertEqual(token, "next-token")
        self.assertEqual(deleted[0]["calendar_id"], "team@example.test")
        self.assertEqual(deleted[0]["event_id"], "deleted")
        self.assertEqual(data[0]["appointment_time"], "09:00")
        arguments = [args for name, args in service.calls if name == "events.list"]
        self.assertEqual([args["syncToken"] for args in arguments], ["old-token", "old-token"])
        self.assertEqual(arguments[1]["pageToken"], "page2")
        self.assertNotIn("timeMin", arguments[0])

    def test_deferred_checkpoint_is_not_written_during_fetch(self):
        service = FakeCalendarService()
        service.list_results = [{"items": [], "nextSyncToken": "after-db"}]
        fake_credentials = SimpleNamespace(valid=True, scopes=[], granted_scopes=None)
        with patch.object(importer, "load_credentials", return_value=fake_credentials), \
                patch.object(importer, "save_credentials"), patch.object(importer, "build", return_value=service), \
                patch.object(importer, "read_json_file", return_value={}), patch.object(importer, "write_json_file") as write, \
                patch.object(sys, "argv", ["import_agenda.py", "--defer-checkpoint"]), \
                patch.object(sys, "stdout", new_callable=io.StringIO) as output, \
                patch.dict(os.environ, {"GOOGLE_CALENDAR_IDS": ""}):
            with self.assertRaises(SystemExit):
                importer.main()
            result = json.loads(output.getvalue())
        write.assert_not_called()
        self.assertEqual(result["next_sync_state"], {"team@example.test": "after-db"})
        self.assertTrue(result["checkpoint_deferred"])

    def test_checkpoint_writes_only_explicit_valid_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(importer, "SYNC_STATE_PATH", Path(directory) / "sync.json"):
            result = importer.commit_checkpoint({"next_sync_state": {"calendar": "next"}})
            self.assertTrue(result["checkpoint_committed"])
            self.assertEqual(json.loads(importer.SYNC_STATE_PATH.read_text()), {"calendar": "next"})
            with self.assertRaises(ValueError):
                importer.commit_checkpoint({"calendar": 42})
            self.assertEqual(json.loads(importer.SYNC_STATE_PATH.read_text()), {"calendar": "next"})

    def test_full_import_ignores_saved_token_without_committing(self):
        service = FakeCalendarService()
        service.list_results = [{"items": [], "nextSyncToken": "full-next"}]
        fake_credentials = SimpleNamespace(valid=True, scopes=[], granted_scopes=None)
        with patch.object(importer, "load_credentials", return_value=fake_credentials), \
                patch.object(importer, "save_credentials"), patch.object(importer, "build", return_value=service), \
                patch.object(importer, "read_json_file", return_value={"team@example.test": "old"}) as read, \
                patch.object(importer, "write_json_file") as write, \
                patch.object(sys, "argv", ["import_agenda.py", "--full", "--defer-checkpoint"]), \
                patch.object(sys, "stdout", new_callable=io.StringIO) as output, \
                patch.dict(os.environ, {"GOOGLE_CALENDAR_IDS": ""}):
            with self.assertRaises(SystemExit):
                importer.main()
            result = json.loads(output.getvalue())
        read.assert_not_called()
        write.assert_not_called()
        arguments = next(args for name, args in service.calls if name == "events.list")
        self.assertNotIn("syncToken", arguments)
        self.assertIn("timeMin", arguments)
        self.assertFalse(result["incremental"])
        self.assertEqual(result["next_sync_state"], {"team@example.test": "full-next"})

    def test_expired_sync_token_reloads_calendar_before_returning_checkpoint(self):
        service = FakeCalendarService()
        fake_credentials = SimpleNamespace(valid=True, scopes=[], granted_scopes=None)
        with patch.object(importer, "load_credentials", return_value=fake_credentials), \
                patch.object(importer, "save_credentials"), patch.object(importer, "build", return_value=service), \
                patch.object(importer, "read_json_file", return_value={"team@example.test": "expired"}), \
                patch.object(importer, "write_json_file") as write, \
                patch.object(importer, "fetch_calendar_changes", side_effect=[http_error(410), ([], [], "replacement")]) as fetch, \
                patch.object(sys, "argv", ["import_agenda.py", "--defer-checkpoint"]), \
                patch.object(sys, "stdout", new_callable=io.StringIO) as output, \
                patch.dict(os.environ, {"GOOGLE_CALENDAR_IDS": ""}):
            with self.assertRaises(SystemExit):
                importer.main()
            result = json.loads(output.getvalue())
        self.assertEqual([call.args[2] for call in fetch.call_args_list], ["expired", None])
        self.assertEqual(result["next_sync_state"], {"team@example.test": "replacement"})
        write.assert_not_called()


class CredentialTests(unittest.TestCase):
    def test_old_readonly_token_is_never_upgraded_on_load(self):
        token = {"token": "fake", "refresh_token": "fake-refresh", "client_id": "fake", "client_secret": "fake",
                 "scopes": ["https://www.googleapis.com/auth/calendar.readonly"]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token.json"
            path.write_text(json.dumps(token))
            with patch.object(credentials_module, "token_path", return_value=path):
                loaded = credentials_module.load_credentials(refresh=False)
            self.assertFalse(credentials_module.credentials_can_write(loaded))
            self.assertEqual(credentials_module.credential_scopes(loaded), token["scopes"])

    def test_actual_grants_override_requested_scopes_and_are_saved(self):
        credentials = Credentials(token="fake", scopes=credentials_module.SCOPES,
                                  granted_scopes=["https://www.googleapis.com/auth/calendar.readonly"])
        self.assertFalse(credentials_module.credentials_can_write(credentials))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token.json"
            with patch.object(credentials_module, "token_path", return_value=path):
                credentials_module.save_credentials(credentials)
            self.assertEqual(json.loads(path.read_text())["scopes"], ["https://www.googleapis.com/auth/calendar.readonly"])

    def test_auth_status_exposes_missing_write_consent(self):
        credentials = Credentials(token="fake", scopes=["https://www.googleapis.com/auth/calendar.readonly"])
        with patch.object(credentials_module, "credentials_path", return_value=Path("fake")), \
                patch.object(credentials_module, "load_credentials", return_value=credentials):
            result = credentials_module.auth_status(refresh=False)
        self.assertTrue(result["authenticated"])
        self.assertFalse(result["write_authorized"])
        self.assertTrue(result["requires_write_auth"])

    def test_clean_env_json_strips_prefixes_and_quotes(self):
        sample = {"token": "ya29.test", "refresh_token": "1//test"}
        # Raw json
        parsed, cleaned = credentials_module._clean_env_json(json.dumps(sample), "GOOGLE_CALENDAR_TOKEN_JSON")
        self.assertEqual(parsed, sample)

        # With variable prefix
        with_prefix = f"GOOGLE_CALENDAR_TOKEN_JSON={json.dumps(sample)}"
        parsed, cleaned = credentials_module._clean_env_json(with_prefix, "GOOGLE_CALENDAR_TOKEN_JSON")
        self.assertEqual(parsed, sample)

        # With export and quotes
        with_export = f"export GOOGLE_CALENDAR_TOKEN_JSON='{json.dumps(sample)}'"
        parsed, cleaned = credentials_module._clean_env_json(with_export, "GOOGLE_CALENDAR_TOKEN_JSON")
        self.assertEqual(parsed, sample)

    def test_token_path_updates_when_env_token_has_new_refresh_token(self):
        old_token = {"token": "old", "refresh_token": "old-ref"}
        new_token = {"token": "new", "refresh_token": "new-ref"}
        with tempfile.TemporaryDirectory() as directory:
            disk_path = Path(directory) / "google-calendar-token.json"
            disk_path.write_text(json.dumps(old_token))
            with patch.object(credentials_module, "_configured_path", return_value=disk_path), \
                    patch.dict(os.environ, {"GOOGLE_CALENDAR_TOKEN_JSON": f"GOOGLE_CALENDAR_TOKEN_JSON={json.dumps(new_token)}"}):
                res_path = credentials_module.token_path()
                self.assertEqual(res_path, disk_path)
                updated_disk = json.loads(disk_path.read_text())
                self.assertEqual(updated_disk["refresh_token"], "new-ref")

    def test_token_path_updates_when_env_token_has_write_scopes_even_with_same_refresh_token(self):
        old_token = {
            "token": "old",
            "refresh_token": "same-ref",
            "scopes": ["https://www.googleapis.com/auth/calendar.readonly"],
        }
        new_token = {
            "token": "new",
            "refresh_token": "same-ref",
            "scopes": ["https://www.googleapis.com/auth/calendar.events"],
        }
        with tempfile.TemporaryDirectory() as directory:
            disk_path = Path(directory) / "google-calendar-token.json"
            disk_path.write_text(json.dumps(old_token))
            with patch.object(credentials_module, "_configured_path", return_value=disk_path), \
                    patch.dict(os.environ, {"GOOGLE_CALENDAR_TOKEN_JSON": json.dumps(new_token)}):
                res_path = credentials_module.token_path()
                self.assertEqual(res_path, disk_path)
                updated_disk = json.loads(disk_path.read_text())
                self.assertEqual(updated_disk["scopes"], ["https://www.googleapis.com/auth/calendar.events"])
                self.assertEqual(updated_disk["token"], "new")

    def test_load_credentials_uses_env_when_disk_is_readonly_and_env_has_write(self):
        disk_token = {
            "token": "old",
            "refresh_token": "same-ref",
            "client_id": "client",
            "client_secret": "secret",
            "scopes": ["https://www.googleapis.com/auth/calendar.readonly"],
        }
        env_token = {
            "token": "new",
            "refresh_token": "same-ref",
            "client_id": "client",
            "client_secret": "secret",
            "scopes": ["https://www.googleapis.com/auth/calendar.events"],
        }
        with tempfile.TemporaryDirectory() as directory:
            disk_path = Path(directory) / "google-calendar-token.json"
            disk_path.write_text(json.dumps(disk_token))
            with patch.object(credentials_module, "_configured_path", return_value=disk_path), \
                    patch.dict(os.environ, {"GOOGLE_CALENDAR_TOKEN_JSON": json.dumps(env_token)}):
                creds = credentials_module.load_credentials(refresh=False)
                self.assertTrue(credentials_module.credentials_can_write(creds))
                self.assertIn("https://www.googleapis.com/auth/calendar.events", credentials_module.credential_scopes(creds))

    def test_clean_env_json_escaped_quotes_and_scope_normalization(self):
        escaped = r'{\"token\": \"abc\", \"refresh_token\": \"ref\", \"scope\": \"https://www.googleapis.com/auth/calendar.events\"}'
        parsed, cleaned = credentials_module._clean_env_json(escaped, "GOOGLE_CALENDAR_TOKEN_JSON")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["token"], "abc")
        self.assertEqual(parsed["scopes"], ["https://www.googleapis.com/auth/calendar.events"])

    def test_credential_scopes_reads_granted_scopes_underscore(self):
        class FakeCreds:
            _granted_scopes = ["https://www.googleapis.com/auth/calendar.events"]
            scopes = None
        scopes = credentials_module.credential_scopes(FakeCreds())
        self.assertEqual(scopes, ["https://www.googleapis.com/auth/calendar.events"])


if __name__ == "__main__":
    unittest.main()

