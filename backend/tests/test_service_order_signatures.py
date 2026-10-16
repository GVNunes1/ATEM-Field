import base64
import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src' / 'services'))
import service_order_pdf as generator

PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII='
JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=='


def raster(kind, image):
    return f'data:image/{kind};base64,{base64.b64encode(image).decode("ascii")}'


class SignatureTests(unittest.TestCase):
    def test_rejects_remote_file_svg_malformed_and_oversized_signatures_before_browser(self):
        dimensions = bytearray(base64.b64decode(PNG.split(',')[1]))
        dimensions[16:20] = (4097).to_bytes(4, 'big')
        pixels = bytearray(base64.b64decode(PNG.split(',')[1]))
        pixels[16:20] = pixels[20:24] = (4096).to_bytes(4, 'big')
        attacks = [
            'http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/private',
            'file:///etc/passwd', 'file:///C:/Windows/win.ini', '//localhost/private', '../secret.png',
            'javascript:alert(1)', raster('svg+xml', b'<svg><image href="http://127.0.0.1/private"/></svg>'),
            raster('png', b'<svg><image href="file:///etc/passwd"/></svg>'), raster('jpeg', b'<svg/>'),
            PNG.replace('image/png', 'image/jpeg'), PNG.replace('image/png', 'image/gif'),
            PNG.replace(';base64,', ';charset=utf-8;base64,'), PNG + '\n', PNG.rstrip('='),
            'data:image/png;base64,!!!!', 'data:image/png;base64,AB==',
            raster('png', base64.b64decode(PNG.split(',')[1])[:-12]),
            raster('jpeg', base64.b64decode(JPEG.split(',')[1])[:-2]),
            raster('png', dimensions), raster('png', pixels),
            raster('png', b'\0' * (1024 * 1024 + 1)), 0, False, {}, []
        ]
        with tempfile.TemporaryDirectory(prefix='service-order-signatures-') as directory:
            output = Path(directory) / 'original.pdf'
            output.write_bytes(b'untouched existing output')
            for field in generator.SIGNATURE_FIELDS:
                for index, attack in enumerate(attacks):
                    with self.subTest(field=field, attack=index), \
                            patch.object(generator, 'browser_executable') as browser, \
                            patch.object(generator, 'run_browser') as render:
                        with self.assertRaisesRegex(ValueError, field):
                            generator.render_pdf({field: attack}, output)
                        browser.assert_not_called()
                        render.assert_not_called()
                        self.assertEqual(output.read_bytes(), b'untouched existing output')

    def test_cli_input_is_rejected_before_browser(self):
        with tempfile.TemporaryDirectory(prefix='service-order-signatures-') as directory:
            output = Path(directory) / 'output.pdf'
            stdout = io.StringIO()
            with patch.object(sys, 'argv', ['service_order_pdf.py', '-', str(output)]), \
                    patch.object(sys, 'stdin', io.StringIO(json.dumps({'Assinatura_Cliente': 'file:///etc/passwd'}))), \
                    patch.object(generator, 'browser_executable') as browser, \
                    redirect_stdout(stdout):
                self.assertEqual(generator.main(), 1)
            browser.assert_not_called()
            self.assertFalse(output.exists())
            response = json.loads(stdout.getvalue())
            self.assertFalse(response['success'])
            self.assertIn('Assinatura_Cliente', response['error'])

    def test_legitimate_signatures_are_materialized_as_local_raster_images(self):
        def isolated_browser(_command, output, log):
            html = (log.parent / 'pat01-f2.html').read_text(encoding='utf-8')
            images = list(log.parent.glob('embedded-image-*'))
            self.assertEqual(len(images), 3, 'logo plus both signatures')
            self.assertEqual({image.suffix for image in images}, {'.png', '.jpg'})
            signatures = [base64.b64decode(value.split(',')[1]) for value in (PNG, JPEG)]
            for image in signatures:
                self.assertTrue(any(path.read_bytes() == image for path in images))
            for source in re.findall(r'<img[^>]+src="([^"]+)"', html):
                self.assertTrue(any(source == image.resolve().as_uri() for image in images))
            self.assertIn('Cliente &lt;Teste&gt;', html)
            output.write_bytes(b'%PDF-1.4\n%%EOF\n')
            return 0, ''

        with tempfile.TemporaryDirectory(prefix='service-order-signatures-') as directory, \
                patch.object(generator, 'browser_executable', return_value='isolated-chromium'), \
                patch.object(generator, 'run_browser', side_effect=isolated_browser) as renderer:
            output = Path(directory) / 'output.pdf'
            generator.render_pdf({'Cliente': 'Cliente <Teste>', 'Assinatura_Tecnico': PNG, 'Assinatura_Cliente': JPEG}, output)
            renderer.assert_called_once()
            self.assertIsNotNone(generator.complete_pdf_size(output))

    def test_unsigned_forms_still_have_blank_signatures(self):
        for data in ({}, {'Assinatura_Tecnico': '', 'Assinatura_Cliente': None}):
            with self.subTest(data=data):
                context = generator.template_context(data)
                for field in generator.SIGNATURE_FIELDS:
                    self.assertEqual(context[field], '')


if __name__ == '__main__':
    unittest.main()
