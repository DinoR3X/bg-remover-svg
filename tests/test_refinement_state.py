"""Local UI regressions. Install playwright and run: python3 -m unittest discover -s tests -v.

The engine is replaced by a delayed local stub so these tests exercise timer/state
handling, not AI accuracy. The PNG fixture is generated in memory; no photo upload
or model download is performed.
"""
import os
import shutil
import struct
import threading
import unittest
import zlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def png_fixture():
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    width = height = 32
    rows = b''.join(b'\x00' + b''.join(bytes((220, 80, 60, 255 if 8 <= x < 24 and 8 <= y < 24 else 0)) for x in range(width)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class RefinementStateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.runtime = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        options = {'headless': True, 'args': ['--no-sandbox', '--disable-gpu']}
        if executable:
            options['executable_path'] = executable
        cls.browser = cls.runtime.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.runtime.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def run_reprocess_case(self, fail_second_call=False):
        context = self.browser.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True)
        try:
            def local_only(route):
                if not route.request.url.startswith(self.url):
                    route.abort('blockedbyclient')
                else:
                    route.continue_()
            context.route('**/*', local_only)
            engine = """
                let calls = 0;
                export async function removeBackground(image) {
                    calls++;
                    await new Promise(resolve => setTimeout(resolve, 350));
                    if (FAIL_SECOND && calls > 1) throw new Error('Simulated inference failure');
                    return image;
                }
            """.replace('FAIL_SECOND', str(fail_second_call).lower())
            context.route('**/engine.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=engine))
            page = context.new_page()
            page.goto(self.url, wait_until='domcontentloaded')
            page.locator('#fileInput').set_input_files({'name': 'local-test.png', 'mimeType': 'image/png', 'buffer': png_fixture()})
            page.locator('#processBtn').click()
            page.wait_for_function("document.querySelector('#status').textContent.startsWith('Selesai!')")
            self.assertFalse(page.locator('#downloadBtn').is_disabled())
            # Same-task input + reprocess deliberately occurs before the 140ms
            # refinement debounce. This reproduces the real UI race reliably.
            page.evaluate("""() => {
                const slider = document.querySelector('#smoothness');
                slider.value = '70';
                slider.dispatchEvent(new Event('input', {bubbles: true}));
                document.querySelector('#processBtn').click();
            }""")
            expected = 'Proses gagal:' if fail_second_call else 'Selesai!'
            page.wait_for_function('(prefix) => document.querySelector("#status").textContent.startsWith(prefix)', arg=expected)
            self.assertFalse(page.locator('#downloadBtn').is_disabled(), 'A superseded refinement timer must not keep downloads locked after reprocessing.')
            self.assertFalse(page.locator('#processBtn').is_disabled())
        finally:
            context.close()

    def test_successful_reprocess_cancels_pending_refinement(self):
        self.run_reprocess_case()

    def test_failed_reprocess_preserves_downloadable_previous_result(self):
        self.run_reprocess_case(fail_second_call=True)


if __name__ == '__main__':
    unittest.main()
