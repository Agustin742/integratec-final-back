"""Checks for the Caddy reverse proxy configuration (infra/caddy/Caddyfile).

The static tests always run. The Docker tests validate and format-check the file with the
pinned Caddy image and exercise the real routing against two stub upstreams; they are skipped
when Docker is not available (CI runners have it).
"""

from pathlib import Path
import re
import shutil
import subprocess
import time
import unittest
import urllib.error
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

    def test_logs_go_to_stdout_as_redacted_json(self):
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

    def test_websocket_upgrade_headers_are_forwarded(self):
        status, body, _ = self.get(
            "/realtime/abc/def",
            headers={"Connection": "Upgrade", "Upgrade": "websocket"},
        )
        self.assertEqual((status, body), (200, "realtime GET /abc/def"))

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


class CaddyLogRedactionTests(CaddyStack):
    """Colyseus clients send credentials in the WebSocket query string; logs must never keep them."""

    SECRETS = {
        "sessionId": "SYNTHETIC-SESSION-VALUE",
        "reconnectionToken": "SYNTHETIC-RECONNECT-VALUE",
        "_authToken": "SYNTHETIC-AUTH-VALUE",
    }

    @classmethod
    def query(cls):
        return "&".join(f"{key}={value}" for key, value in cls.SECRETS.items())

    def assert_redacted(self, logs):
        for key, value in self.SECRETS.items():
            with self.subTest(key=key):
                self.assertNotIn(value, logs)
                self.assertIn(f"{key}=REDACTED", logs)

    def test_credentials_are_redacted_in_the_access_log_but_still_forwarded(self):
        path = f"/realtime/process/room?{self.query()}"
        status, body, _ = self.get(path)
        self.assertEqual((status, body), (200, f"realtime GET /process/room?{self.query()}"))
        logs = docker("logs", self.proxy, check=False)
        output = logs.stdout + logs.stderr
        self.assertIn('"logger":"http.log.access', output)
        self.assert_redacted(output)

    def test_credentials_are_redacted_in_the_error_log_when_the_upstream_is_down(self):
        docker("stop", self.containers[1])  # the realtime stub
        status, _, _ = self.get(f"/realtime/process/room?{self.query()}")
        self.assertEqual(status, 502)
        logs = docker("logs", self.proxy, check=False)
        output = logs.stdout + logs.stderr
        self.assertIn('"logger":"http.log.error', output)
        self.assert_redacted(output)


if __name__ == "__main__":
    unittest.main()
