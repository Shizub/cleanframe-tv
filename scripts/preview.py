"""Serve the actual TV UI and the retained design gallery on this Mac."""
import argparse
import io
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from font_assets import font_overlay

ROOT = Path(__file__).resolve().parents[1]


class PreviewServer(ThreadingHTTPServer):
    request_queue_size = 128


class Preview(SimpleHTTPRequestHandler):
    def send_head(self):
        route = unquote(urlsplit(self.path).path)
        if route in ['/home/assets/font-catalog.js', '/home/assets/private-fonts.css', '/home/assets/duo-catalog.js'] or route.startswith(('/home/assets/private-fonts/', '/home/assets/duo/')):
            source = self.server.overlay.get(route[len('/home/'):])
            if source is None:
                self.send_error(404, 'File not found')
                return None
            content = source.read_bytes() if isinstance(source, Path) else source
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(route))
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            return io.BytesIO(content)
        return super().send_head()

    def translate_path(self, path):
        route = urlsplit(path).path
        # Serve only the packaged UI and offline material-builder inputs.
        if route == '/' or route == '/home':
            return str(ROOT / 'app/index.html')
        if route.startswith('/home/'):
            self.directory = str(ROOT / 'app')
            return super().translate_path(route[5:])
        if route.startswith('/build/'):
            self.directory = str(ROOT / 'scripts/materials')
            return super().translate_path(route[6:])
        self.directory = str(ROOT / 'app')
        return super().translate_path(route)

    def do_GET(self):
        if urlsplit(self.path).path == '/':
            self.send_response(302)
            self.send_header('Location', '/home/')
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4795)
    parser.add_argument('--public-fonts', action='store_true', help='Use only the fonts distributed with the source')
    parser.add_argument('--no-duo', action='store_true', help='Serve no Duo images, so the app starts in the Dock layout')
    args = parser.parse_args()
    server = PreviewServer(('127.0.0.1', args.port), Preview)
    # Read once: with many wallpapers, scanning their folders on each request would slow the page down.
    server.overlay = font_overlay(include_private=not args.public_fonts, include_duo=not args.no_duo)
    print('CleanFrame preview: http://127.0.0.1:' + str(server.server_port) + '/home/', flush=True)
    server.serve_forever()
