#!/usr/bin/env python3
"""Local preview server: `python3 -m http.server` plus HTTP Range support.

Safari refuses to play <video> from a server that ignores Range requests,
so the background footage stays frozen on its poster under the stock server.
GitHub Pages supports ranges; this makes localhost behave the same way.

    python3 scripts/serve.py [port]      # default 4321
"""
import os
import re
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGE = re.compile(r'bytes=(\d*)-(\d*)$')


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self._range = None
        header = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not header or os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        m = RANGE.match(header.strip())
        size = os.path.getsize(path)
        if not m or (not m.group(1) and not m.group(2)):
            return super().send_head()
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:                                   # "bytes=-N": the last N bytes
            start = max(size - int(m.group(2)), 0)
            end = size - 1
        end = min(end, size - 1)
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.end_headers()
            return None

        f = open(path, 'rb')
        f.seek(start)
        self._range = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(self._range))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Last-Modified', self.date_time_string(int(os.path.getmtime(path))))
        self.end_headers()
        return f

    def end_headers(self):
        if not getattr(self, '_range', None):
            self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def copyfile(self, source, outputfile):
        left = getattr(self, '_range', None)
        if left is None:
            return super().copyfile(source, outputfile)
        try:
            while left > 0:
                chunk = source.read(min(64 * 1024, left))
                if not chunk:
                    break
                outputfile.write(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass    # browsers routinely abandon a range once they have enough


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 4321))
    server = ThreadingHTTPServer(('', port), partial(RangeHandler, directory=ROOT))
    print('Serving %s at http://localhost:%d' % (ROOT, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
