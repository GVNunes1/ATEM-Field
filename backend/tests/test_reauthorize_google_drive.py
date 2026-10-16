import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


SERVICES_DIR = Path(__file__).resolve().parents[1] / "src" / "services"
sys.path.insert(0, str(SERVICES_DIR))

import reauthorize_google_drive as renewal  # noqa: E402


class DriveRenewalTests(unittest.TestCase):
    def test_validates_both_folders_and_lists_contents(self):
        service = MagicMock()
        service.files.return_value.get.return_value.execute.side_effect = [
            {
                "id": renewal.UNSIGNED_FOLDER_ID,
                "mimeType": "application/vnd.google-apps.folder",
                "capabilities": {"canAddChildren": True},
            },
            {
                "id": renewal.SIGNED_FOLDER_ID,
                "mimeType": "application/vnd.google-apps.folder",
                "capabilities": {"canAddChildren": True},
            },
        ]
        service.files.return_value.list.return_value.execute.return_value = {"files": []}
        with patch.object(renewal, "build", return_value=service):
            renewal.validate_drive_access(object())
        self.assertEqual(service.files.return_value.get.call_count, 2)
        self.assertEqual(service.files.return_value.list.call_count, 2)

    def test_denied_folder_prevents_token_creation(self):
        service = MagicMock()
        service.files.return_value.get.return_value.execute.return_value = {
            "id": renewal.UNSIGNED_FOLDER_ID,
            "mimeType": "application/vnd.google-apps.folder",
            "capabilities": {"canAddChildren": False},
        }
        with patch.object(renewal, "build", return_value=service):
            with self.assertRaises(RuntimeError):
                renewal.validate_drive_access(object())
        service.files.return_value.list.assert_not_called()

    def test_token_file_is_private_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "token.json"
            renewal.write_new_token(output, {"refresh_token": "new-secret"})
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"refresh_token": "new-secret"})
            with self.assertRaises(FileExistsError):
                renewal.write_new_token(output, {"refresh_token": "different"})
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"refresh_token": "new-secret"})


if __name__ == "__main__":
    unittest.main()
