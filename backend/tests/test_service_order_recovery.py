import sys
from pathlib import Path
import unittest
from io import BytesIO
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src' / 'services'))
import recover_service_order_history as recovery


class RecoveryTests(unittest.TestCase):
    def test_extracts_metadata_without_fabricating_signatures(self):
        text = ('Data: 02/10/2026 Hora da chegada: 09:00 Hora da saída: 10:40\n'
                'Cliente: Hospital Teste Fone: 1234\n'
                'Equipamento: Monitor marca: Philips modelo: MR400\n'
                'Patrimônio: 42 nº série: US91002990 setor: UTI\n'
                'Nome do técnico: Guilherme Ass: data: 02/10/2026')
        record = recovery.record_for({'id': 'original-id', 'name': 'OS.pdf'}, True, text)
        self.assertEqual(record['client_name'], 'Hospital Teste')
        self.assertEqual(record['technician_name'], 'Guilherme')
        self.assertEqual(record['serial_number'], 'US91002990')
        self.assertEqual(record['service_date'], '02/10/2026')
        self.assertEqual(record['drive_file_id'], 'original-id')
        self.assertEqual(record['status'], 'signed')
        self.assertNotIn('Assinatura_Tecnico', record['form_data'])
        self.assertFalse(record['form_data']['_recovery']['needs_review'])

    def test_missing_fields_are_marked_for_review(self):
        record = recovery.record_for({'id': 'id', 'name': 'scan.pdf'}, False, '')
        self.assertIsNone(record['client_name'])
        self.assertTrue(record['form_data']['_recovery']['needs_review'])

    def test_inaccessible_folder_prevents_all_imports(self):
        from unittest.mock import MagicMock
        service = MagicMock()
        service.files.return_value.get.return_value.execute.side_effect = RuntimeError('no access')
        with patch.object(recovery, 'database_request') as database:
            with self.assertRaises(RuntimeError):
                recovery.recover(service, apply=True)
            database.assert_not_called()

    def test_public_preview_is_read_only_and_skips_identical_content(self):
        from pypdf import PdfWriter
        from unittest.mock import MagicMock
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        stream = BytesIO()
        writer.write(stream)
        response = MagicMock()
        response.read.return_value = stream.getvalue()
        response.headers = {'Content-Disposition': 'attachment; filename="OS_test.pdf"'}
        response.__enter__.return_value = response
        with patch.object(recovery, 'urlopen', return_value=response), \
             patch.object(recovery, 'database_request', return_value=[]) as database:
            report = recovery.recover_public_manifest({'signed': ['original-file-1', 'original-file-2']})
        self.assertEqual(report['found'], 2)
        self.assertEqual(report['identical_pdf'], 1)
        self.assertEqual(report['imported'], 0)
        self.assertEqual(report['needs_review'], 1)
        self.assertTrue(all(call.args[0] == 'GET' for call in database.call_args_list))

    def test_public_import_is_idempotent_by_file_id(self):
        with patch.object(recovery, 'urlopen') as download, \
             patch.object(recovery, 'database_request', return_value=[
                 {'id': 'drive_existing-file', 'drive_file_id': 'existing-file', 'form_data': {}}
             ]):
            report = recovery.recover_public_manifest({'signed': ['existing-file']}, apply=True)
        self.assertEqual(report['existing'], 1)
        self.assertEqual(report['imported'], 0)
        download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
