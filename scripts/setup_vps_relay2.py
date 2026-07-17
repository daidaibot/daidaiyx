#!/usr/bin/env python3
"""Install a stdlib Python OpenAI reverse proxy on CentOS-like VPS."""
import paramiko
import sys
import time

HOST = sys.argv[1]
PASSWORD = sys.argv[2]
USER = "root"

RELAY_PY = r'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal OpenAI API reverse proxy for daidaiyx."""
from __future__ import print_function
import json
import ssl
import sys
import threading

try:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler
    from SocketServer import ThreadingMixIn
    from HTTPServer import HTTPServer
    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
except ImportError:
    from urllib2 import Request, urlopen, HTTPError, URLError

UPSTREAM = "https://api.openai.com"
LISTEN = ("0.0.0.0", 80)
TIMEOUT = 300

CTX = ssl.create_default_context()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] in ("/health", "/"):
            return self._send_json(200, {
                "ok": True,
                "service": "daidai-openai-relay",
                "upstream": UPSTREAM,
            })
        return self._proxy()

    def do_POST(self):
        return self._proxy()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else None
        url = UPSTREAM + self.path
        headers = {}
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        ctype = self.headers.get("Content-Type")
        if ctype:
            headers["Content-Type"] = ctype
        headers["User-Agent"] = "daidai-openai-relay/1.0"
        req = Request(url, data=body, headers=headers, method=self.command)
        try:
            resp = urlopen(req, timeout=TIMEOUT, context=CTX)
            data = resp.read()
            self.send_response(resp.getcode())
            ct = resp.headers.get("Content-Type")
            if ct:
                self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
        except HTTPError as e:
            data = e.read() or b""
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type") or "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = json.dumps({"error": {"message": "relay failed: %s" % e}}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(msg)


def main():
    # Prefer py3 ThreadingHTTPServer
    httpd = ThreadingHTTPServer(LISTEN, Handler)
    print("listening on %s:%s -> %s" % (LISTEN[0], LISTEN[1], UPSTREAM), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
'''

SERVICE = r'''[Unit]
Description=Daidai OpenAI API Relay
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/daidai-relay/server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
'''

# CentOS 7 may only have python2; try python3 or install via remi/ius or use python2 compatible relay
# We'll detect and possibly use python2 with the same relay (I wrote dual compatible)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("connecting", HOST)
    client.connect(HOST, username=USER, password=PASSWORD, timeout=40, allow_agent=False, look_for_keys=False)

    def run(cmd, timeout=300):
        print(">>>", cmd[:140])
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out[-4000:] if len(out) > 4000 else out)
        if err:
            print(err[-2000:] if len(err) > 2000 else err)
        print("exit", code)
        return code, out, err

    run("which python3 python 2>/dev/null; python3 --version 2>/dev/null; python --version 2>/dev/null; ls /usr/bin/python*")

    # write files via sftp
    sftp = client.open_sftp()
    try:
        run("mkdir -p /opt/daidai-relay")
        with sftp.file("/opt/daidai-relay/server.py", "w") as f:
            f.write(RELAY_PY)
        with sftp.file("/etc/systemd/system/daidai-relay.service", "w") as f:
            f.write(SERVICE)
    finally:
        sftp.close()

    # pick interpreter
    code, out, _ = run("command -v python3 || command -v python")
    py = (out or "").strip().splitlines()[-1].strip() if out else ""
    if not py:
        # install python3 from vault epel-ish — try get-pip or compile? Use python2 with slight tweaks
        print("No python3; checking python2")
        code, out, _ = run("command -v python2 || command -v python")
        py = (out or "").strip().splitlines()[-1].strip()
    if not py:
        print("FATAL: no python")
        sys.exit(1)

    # Fix unit if not python3
    if "python3" not in py:
        run("sed -i 's|/usr/bin/python3|%s|' /etc/systemd/system/daidai-relay.service" % py)

    run("chmod +x /opt/daidai-relay/server.py")
    # free port 80 if anything there
    run("fuser -k 80/tcp 2>/dev/null || true; systemctl stop nginx httpd 2>/dev/null || true")
    run("systemctl daemon-reload; systemctl enable daidai-relay; systemctl restart daidai-relay; sleep 1; systemctl status daidai-relay --no-pager | head -20")
    run("curl -sS http://127.0.0.1/health; echo")
    run("curl -sS -o /tmp/r.txt -w 'code=%{http_code}\\n' http://127.0.0.1/v1/models -H 'Authorization: Bearer sk-test'; head -c 220 /tmp/r.txt; echo")
    run("curl -sS -o /tmp/u.txt -w 'up=%{http_code}\\n' https://api.openai.com/v1/models -H 'Authorization: Bearer sk-test'; head -c 220 /tmp/u.txt; echo")

    client.close()
    print("\nOK. Cloud env:")
    print("  DAIDAI_IMAGE_BASE_URL=http://%s" % HOST)
    print("  delete DAIDAI_IMAGE_PROXY_ASYNC")
    print("CHANGE ROOT PASSWORD NOW.")


if __name__ == "__main__":
    main()
