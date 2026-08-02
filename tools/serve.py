#!/usr/bin/env python3
"""
Dev server for this project.

`python3 -m http.server` is not good enough here: it does not implement HTTP
Range requests. Progressive loading depends on them — seeking a streamed video
means asking for a byte range, and without support the browser either refuses
to seek or refetches the whole file every time. Any real static host (GitHub
Pages, Netlify, S3, nginx) supports ranges, so this only papers over a gap in
the stdlib server, not a gap in production.

    ./tools/serve.py [port]
"""

import os
import re
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Tells the browser it may serve our background fetch() of the video
        # from the same cache entry the media element already populated,
        # instead of pulling the file down twice.
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def send_head(self):
        header = self.headers.get("Range")
        if not header:
            return super().send_head()

        match = RANGE_RE.fullmatch(header.strip())
        if not match:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        start_raw, end_raw = match.groups()

        if start_raw:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
        else:
            # "bytes=-500" means the final 500 bytes.
            if not end_raw:
                f.close()
                self.send_error(400, "Malformed Range header")
                return None
            start = max(0, size - int(end_raw))
            end = size - 1

        if start >= size:
            f.close()
            self.send_response(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        end = min(end, size - 1)
        f.seek(start)

        self.send_response(206, "Partial Content")
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Slice(f, end - start + 1)


class _Slice:
    """File wrapper that stops after `remaining` bytes, for copyfile()."""

    def __init__(self, fileobj, remaining):
        self.fileobj = fileobj
        self.remaining = remaining

    def read(self, amount=-1):
        if self.remaining <= 0:
            return b""
        if amount < 0 or amount > self.remaining:
            amount = self.remaining
        data = self.fileobj.read(amount)
        self.remaining -= len(data)
        return data

    def close(self):
        self.fileobj.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = partial(RangeRequestHandler, directory=root)
    print(f"Serving {root} on http://localhost:{port}  (ctrl-c to stop)")
    HTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
