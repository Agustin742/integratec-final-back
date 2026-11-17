"""Checks for the Caddy reverse proxy configuration (infra/caddy/Caddyfile).

The static tests always run. The Docker tests validate and format-check the file with the
pinned Caddy image and exercise the real routing against two stub upstreams; they are skipped
when Docker is not available (CI runners have it).
"""

from pathlib import Path
import base64
import hashlib
import os
import re
import shutil
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[2]
CADDYFILE = ROOT / "infra" / "caddy" / "Caddyfile"
DOCKER = shutil.which("docker")


def pinned_image():
    match = re.search(
        r"^# Image: (caddy:2\.\d+\.\d+-alpine)$",
        CADDYFILE.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    return match.group(1) if match else None


def docker(*args, check=True):
    return subprocess.run(
        [DOCKER, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=check,
    )


class CaddyfileStaticTests(unittest.TestCase):
    def setUp(self):
        self.text = CADDYFILE.read_text(encoding="utf-8")

    def test_image_is_pinned_to_an_exact_alpine_release(self):
        self.assertIsNotNone(pinned_image())

    def test_site_address_comes_from_the_environment(self):
        self.assertRegex(self.text, r"(?m)^\{\$SITE_ADDRESS\} \{$")

    def test_routes_use_service_names_and_strip_prefixes(self):
        self.assertIn("handle_path /api/*", self.text)
        self.assertIn("reverse_proxy api:3000", self.text)
        self.assertIn("handle_path /realtime/*", self.text)
        self.assertIn("reverse_proxy realtime:2567", self.text)

    def test_internal_paths_are_blocked_before_the_proxy_routes(self):
        block = self.text.index("@internal")
        self.assertLess(block, self.text.index("handle_path /api/*"))
        for prefix in ("/api/internal", "/realtime/internal"):
            self.assertIn(prefix, self.text)

    def test_unmatched_requests_answer_404(self):
        self.assertRegex(self.text, r"(?s)handle \{\s*respond 404\s*\}")

    def test_logs_are_redacted_json_on_stdout_and_stderr(self):
        self.assertRegex(self.text, r"(?s)log \{\s*output stdout\s*format filter \{\s*wrap json")
        self.assertRegex(self.text, r"(?s)log \{\s*output stderr\s*format filter \{\s*wrap json")


@unittest.skipUnless(DOCKER and pinned_image(), "Docker or the pinned image is unavailable")
class CaddyfileDockerTests(unittest.TestCase):
    def run_caddy(self, *caddy_args, site_address="example.sslip.io"):
        return docker(
            "run", "--rm",
            "-v", f"{CADDYFILE}:/etc/caddy/Caddyfile:ro",
            "-e", f"SITE_ADDRESS={site_address}",
            pinned_image(), "caddy", *caddy_args,
            check=False,
        )

    def test_config_validates(self):
        result = self.run_caddy(
            "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_config_is_formatted(self):
        result = self.run_caddy("fmt", "--diff", "/etc/caddy/Caddyfile")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # `--diff` prints the whole file; changed lines start with `+` or `-`.
        changed = [line for line in result.stdout.splitlines() if line[:1] in "+-"]
        self.assertEqual(changed, [])


@unittest.skipUnless(DOCKER and pinned_image(), "Docker or the pinned image is unavailable")
class CaddyStack(unittest.TestCase):
    """Runs the real Caddyfile over plain HTTP in front of two echo stubs named like the services."""

    @classmethod
    def setUpClass(cls):
        suffix = uuid.uuid4().hex[:8]
        cls.network = f"caddy-routing-{suffix}"
        cls.containers = []
        image = pinned_image()
        docker("network", "create", cls.network)
        try:
            for alias, port in (("api", 3000), ("realtime", 2567)):
                cls.containers.append(cls.start_stub(image, alias, port, suffix))
            # An explicit `http://` address disables automatic HTTPS for this test only.
            cls.proxy = f"caddy-routing-proxy-{suffix}"
            docker(
                "run", "-d", "--name", cls.proxy, "--network", cls.network,
                "-p", "127.0.0.1::8080",
                "-v", f"{CADDYFILE}:/etc/caddy/Caddyfile:ro",
                "-e", "SITE_ADDRESS=http://:8080",
                image,
            )
            cls.containers.append(cls.proxy)
            cls.base = f"http://{cls.published_address(cls.proxy)}"
            cls.wait_until_ready()
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def start_stub(cls, image, alias, port, suffix):
        name = f"caddy-routing-{alias}-{suffix}"
        stub = f":{port} {{\n\trespond \"{alias} {{http.request.method}} {{http.request.uri}}\"\n}}\n"
        docker(
            "run", "-d", "--name", name, "--network", cls.network,
            "--network-alias", alias, image,
            "sh", "-c",
            f"printf '%s' '{stub}' > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile",
        )
        return name

    @classmethod
    def published_address(cls, name):
        mapping = docker("port", name, "8080/tcp").stdout.strip().splitlines()[0]
        return mapping

    @classmethod
    def wait_until_ready(cls):
        for _ in range(50):
            try:
                cls.get("/nowhere")
                return
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(0.2)
        raise RuntimeError(docker("logs", cls.proxy, check=False).stderr)

    @classmethod
    def tearDownClass(cls):
        for name in cls.containers:
            docker("rm", "-f", name, check=False)
        docker("network", "rm", cls.network, check=False)

    @classmethod
    def get(cls, path, method="GET", headers=None):
        request = urllib.request.Request(cls.base + path, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read().decode(), dict(response.headers)
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode(), dict(error.headers)



WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WEBSOCKET_ECHO_IMAGE = "python:3.13.1-alpine"
# Stdlib-only upstream: completes the RFC 6455 handshake, reports the path it received, then echoes text frames.
WEBSOCKET_ECHO_SERVER = r"""
import base64, hashlib, socketserver

def send(sock, text):
    sock.sendall(bytes([0x81, len(text.encode())]) + text.encode())

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        path = self.rfile.readline().split()[1].decode()
        headers = {}
        while (line := self.rfile.readline().strip()):
            name, _, value = line.decode().partition(":")
            headers[name.strip().lower()] = value.strip()
        accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + "{GUID}").encode()).digest()).decode()
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").encode())
        send(self.request, "path " + path)
        head = self.rfile.read(2)
        mask = self.rfile.read(4)
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(head[1] & 0x7F)))
        send(self.request, "echo " + payload.decode())

socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(("", 2567), Handler).serve_forever()
""".replace("{GUID}", WEBSOCKET_GUID)


def websocket_exchange(base, path, message):
    """Performs a WebSocket handshake through `base`; returns the handshake and the first two text frames."""
    key = base64.b64encode(os.urandom(16)).decode()
    host = urllib.parse.urlsplit(base).netloc
    request = (
        f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    with socket.create_connection((host.split(":")[0], int(host.split(":")[1])), timeout=5) as sock:
        reader = sock.makefile("rb")
        sock.sendall(request.encode())
        status_line = reader.readline().decode().strip()
        headers = {}
        while (line := reader.readline().strip()):
            name, _, value = line.decode().partition(":")
            headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + WEBSOCKET_GUID).encode()).digest()).decode()
        handshake = (status_line, headers, expected)
        if not status_line.startswith("HTTP/1.1 101"):
            return handshake, []

        def read_frame():
            opcode_byte, length = reader.read(2)
            if length & 0x7F >= 126:
                raise AssertionError("frames this large are not expected in the test")
            return opcode_byte & 0x0F, reader.read(length & 0x7F).decode()

        payload = message.encode()
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + masked)
        return handshake, [read_frame(), read_frame()]


class CaddyWebSocketTests(CaddyStack):
    """Colyseus clients connect over WebSocket, so the proxy must complete a real upgrade."""

    @classmethod
    def start_stub(cls, image, alias, port, suffix):
        if alias != "realtime":
            return super().start_stub(image, alias, port, suffix)
        name = f"caddy-routing-{alias}-{suffix}"
        docker(
            "run", "-d", "--name", name, "--network", cls.network, "--network-alias", alias,
            WEBSOCKET_ECHO_IMAGE, "python", "-u", "-c", WEBSOCKET_ECHO_SERVER,
        )
        return name

    def test_websocket_upgrade_and_messages_pass_through_the_realtime_route(self):
        (status_line, headers, expected_accept), frames = websocket_exchange(
            self.base, "/realtime/abc/def?room=1", "hello through caddy"
        )
        self.assertTrue(status_line.startswith("HTTP/1.1 101"), status_line)
        self.assertEqual(headers.get("upgrade", "").lower(), "websocket")
        self.assertEqual(headers.get("sec-websocket-accept"), expected_accept)
        # First frame: the upstream reports the path it received; second: the echoed message.
        self.assertEqual(frames, [(1, "path /abc/def?room=1"), (1, "echo hello through caddy")])


class CaddyRoutingTests(CaddyStack):
    def test_api_requests_reach_the_api_with_the_prefix_stripped(self):
        status, body, _ = self.get("/api/health?x=1")
        self.assertEqual((status, body), (200, "api GET /health?x=1"))

    def test_api_post_keeps_the_method(self):
        status, body, _ = self.get("/api/auth/login", method="POST")
        self.assertEqual((status, body), (200, "api POST /auth/login"))

    def test_realtime_requests_reach_colyseus_with_the_prefix_stripped(self):
        status, body, _ = self.get("/realtime/matchmake/joinOrCreate/classroom", method="POST")
        self.assertEqual((status, body), (200, "realtime POST /matchmake/joinOrCreate/classroom"))

    def test_internal_paths_are_not_reachable(self):
        paths = [
            "/api/internal/realtime/join-verification",
            "/api/internal/realtime/access-reverification",
            "/api/internal/realtime/connected-time",
            "/realtime/internal/evictions",
            "/api/internal",
            "/realtime/internal",
            "/api/Internal/realtime/join-verification",
            "/realtime/INTERNAL/evictions",
            "/api//internal/realtime/join-verification",
            "/realtime//internal/evictions",
            "/api/%69nternal/realtime/join-verification",
            "/realtime/%69nternal/evictions",
        ]
        for path in paths:
            for method in ("GET", "POST"):
                with self.subTest(path=path, method=method):
                    status, body, _ = self.get(path, method=method)
                    self.assertEqual(status, 404)
                    self.assertNotIn("GET /", body)
                    self.assertNotIn("POST /", body)

    def test_the_internal_prefix_is_only_blocked_at_the_start_of_the_path(self):
        status, body, _ = self.get("/api/classrooms/internal-notes")
        self.assertEqual((status, body), (200, "api GET /classrooms/internal-notes"))

    def test_root_and_unknown_paths_answer_404(self):
        for path in ("/", "/health", "/matchmake/joinOrCreate/x", "/apix", "/realtimex/a", "/internal/evictions"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)

    def test_server_header_is_removed(self):
        _, _, headers = self.get("/api/health")
        self.assertNotIn("Server", headers)


class CaddyLogStack(CaddyStack):
    """Shared helpers: Colyseus clients send credentials in the WebSocket query string; logs must never keep them."""

    SECRETS = {
        "sessionId": "SYNTHETIC-SESSION-VALUE",
        "reconnectionToken": "SYNTHETIC-RECONNECT-VALUE",
        "_authToken": "SYNTHETIC-AUTH-VALUE",
    }

    def request_path(self):
        # A unique marker lets each test read only the log entries of its own request.
        self.marker = uuid.uuid4().hex
        query = "&".join(f"{key}={value}" for key, value in self.SECRETS.items())
        return f"/realtime/process/room?{query}&marker={self.marker}"

    def wait_for_entries(self, logger_prefix, timeout=5.0):
        """Poll the proxy logs until an entry of this request from `logger_prefix` appears."""
        deadline = time.monotonic() + timeout
        while True:
            logs = docker("logs", self.proxy, check=False)
            entries = [
                line for line in (logs.stdout + logs.stderr).splitlines()
                if self.marker in line and f'"logger":"{logger_prefix}' in line
            ]
            if entries:
                return entries
            if time.monotonic() >= deadline:
                self.fail(f"no {logger_prefix} entry for the request within {timeout}s")
            time.sleep(0.1)

    def assert_redacted(self, entries):
        text = "\n".join(entries)
        for key, value in self.SECRETS.items():
            with self.subTest(key=key):
                self.assertNotIn(value, text)
                self.assertIn(f"{key}=REDACTED", text)


class CaddyAccessLogRedactionTests(CaddyLogStack):
    def test_credentials_are_redacted_in_the_access_log_but_still_forwarded(self):
        path = self.request_path()
        status, body, _ = self.get(path)
        self.assertEqual((status, body), (200, f"realtime GET {path.removeprefix('/realtime')}"))
        self.assert_redacted(self.wait_for_entries("http.log.access"))


class CaddyErrorLogRedactionTests(CaddyLogStack):
    """Has its own stack because it stops the realtime stub."""

    def test_credentials_are_redacted_in_the_error_log_when_the_upstream_is_down(self):
        docker("stop", self.containers[1])  # the realtime stub
        status, _, _ = self.get(self.request_path())
        self.assertEqual(status, 502)
        self.assert_redacted(self.wait_for_entries("http.log.error"))


if __name__ == "__main__":
    unittest.main()
