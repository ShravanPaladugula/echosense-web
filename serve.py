# Same as python -m http.server, but tells the browser never to cache.
# Saves hard-refreshing every time a file changes.
import functools, http.server, socketserver, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def send_header(self, k, v):
        if k == 'Last-Modified':
            return
        super().send_header(k, v)

socketserver.TCPServer.allow_reuse_address = True
root = sys.argv[2] if len(sys.argv) > 2 else '.'
with socketserver.TCPServer(('', int(sys.argv[1])), functools.partial(H, directory=root)) as s:
    print('serving', root, 'on', sys.argv[1], flush=True)
    s.serve_forever()
