"""Static checks of the production Compose file (infra/deploy/compose.prod.yaml).

The file is parsed with PyYAML (preinstalled on GitHub-hosted Ubuntu runners). The tests that
need it are skipped when it is missing. One more test renders the file with `docker compose
config`, which needs the Compose CLI but no Docker daemon, and is skipped without it.
"""
import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - depends on the interpreter
    yaml = None

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "infra/deploy/compose.prod.yaml"
CADDYFILE = ROOT / "infra/caddy/Caddyfile"

SECRET_NAMES = {
    "JWT_SECRET",
    "INVITATION_TOKEN_KEY",
    "INTERNAL_SERVICE_SECRET",
    "AI_PROVIDER_API_KEY",
    "DATABASE_URL",
}

# Everything each service may receive. Literals are the non-secret values fixed by the image
# contract; every other entry is a bare name whose value comes from the process environment of
# `docker compose` (the host start script), so no value is ever written into the file.
API_ENV = {
    "NODE_ENV=production",
    "PORT=3000",
    "ALLOWED_ORIGINS",
    "PASSWORD_RESET_URL_BASE",
    "S3_REGION",
    "S3_BUCKET",
    "REALTIME_INTERNAL_URL",
    "JWT_SECRET",
    "INVITATION_TOKEN_KEY",
    "INTERNAL_SERVICE_SECRET",
    "AI_PROVIDER_API_KEY",
    "DATABASE_URL",
}
REALTIME_ENV = {
    "NODE_ENV=production",
    "PORT=2567",
    "API_INTERNAL_URL",
    "INTERNAL_SERVICE_SECRET",
}
CADDY_ENV = {"SITE_ADDRESS=${SITE_ADDRESS:?SITE_ADDRESS is required}"}


def compose_cli_available():
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0


def compose_text():
    return COMPOSE.read_text()


def load():
    return yaml.safe_load(compose_text())


@unittest.skipIf(yaml is None, "PyYAML is not available")
class ComposeStructureTests(unittest.TestCase):
    def setUp(self):
        self.doc = load()
        self.services = self.doc["services"]

    def test_exactly_the_four_services(self):
        self.assertEqual(set(self.services), {"caddy", "api", "realtime", "migrate"})

    def test_one_private_bridge_network_shared_by_all(self):
        self.assertEqual(len(self.doc["networks"]), 1)
        (name, network), = self.doc["networks"].items()
        self.assertEqual((network or {}).get("driver", "bridge"), "bridge")
        self.assertFalse((network or {}).get("external", False))
        for service in self.services.values():
            self.assertEqual(service["networks"], [name])
            self.assertNotIn("network_mode", service)

    def test_only_caddy_publishes_ports(self):
        self.assertEqual(self.services["caddy"]["ports"], ["80:80", "443:443"])
        for name in ("api", "realtime"):
            self.assertNotIn("ports", self.services[name])

    def test_caddy_image_is_the_one_the_caddyfile_pins(self):
        pinned = re.search(r"(?m)^# Image: (caddy:2\.\d+\.\d+-alpine)$", CADDYFILE.read_text()).group(1)
        self.assertEqual(self.services["caddy"]["image"], pinned)

    def test_app_images_come_from_required_interpolation(self):
        self.assertRegex(self.services["api"]["image"], r"^\$\{API_IMAGE:\?[^}]+\}$")
        self.assertRegex(self.services["realtime"]["image"], r"^\$\{REALTIME_IMAGE:\?[^}]+\}$")
        self.assertRegex(self.services["migrate"]["image"], r"^\$\{MIGRATE_IMAGE:\?[^}]+\}$")

    def test_caddy_mounts_the_caddyfile_read_only_and_persists_certificates(self):
        volumes = self.services["caddy"]["volumes"]
        self.assertIn("../caddy/Caddyfile:/etc/caddy/Caddyfile:ro", volumes)
        self.assertIn("caddy_data:/data", volumes)
        self.assertIn("caddy_config:/config", volumes)
        self.assertEqual(set(self.doc["volumes"]), {"caddy_data", "caddy_config"})

    def test_restart_policy(self):
        for name, service in self.services.items():
            expected = "no" if name == "migrate" else "unless-stopped"
            self.assertEqual(service["restart"], expected, name)

    def test_awslogs_driver_with_the_terraform_log_groups(self):
        for name, service in self.services.items():
            logging = service["logging"]
            self.assertEqual(logging["driver"], "awslogs", name)
            options = logging["options"]
            self.assertRegex(options["awslogs-region"], r"^\$\{AWS_REGION:\?[^}]+\}$", name)
            group = "api" if name == "migrate" else name  # migrate logs into the api group
            self.assertRegex(options["awslogs-group"], r"^\$\{LOG_GROUP_PREFIX:\?[^}]+\}/" + group + "$")
            self.assertNotIn("awslogs-create-group", options, "Terraform owns the groups and their retention")
            self.assertEqual(options["mode"], "non-blocking", name)
            self.assertIn("tag", options)

    def test_migrate_is_a_one_shot_without_ports_or_healthcheck_and_has_its_own_log_stream(self):
        migrate = self.services["migrate"]
        self.assertEqual(migrate["restart"], "no")
        self.assertNotIn("ports", migrate)
        self.assertNotIn("healthcheck", migrate)
        self.assertEqual(migrate["environment"], ["DATABASE_URL"])
        self.assertNotEqual(migrate["logging"]["options"]["tag"], self.services["api"]["logging"]["options"]["tag"])

    def test_api_waits_for_the_migrations_to_complete(self):
        self.assertEqual(
            self.services["api"]["depends_on"], {"migrate": {"condition": "service_completed_successfully"}}
        )

    def test_health_checks_use_the_real_endpoints_with_a_binary_in_the_image(self):
        for name, port in (("api", 3000), ("realtime", 2567)):
            test = self.services[name]["healthcheck"]["test"]
            self.assertEqual(test[0], "CMD")
            self.assertEqual(test[1], "wget", "busybox wget ships in node:alpine, curl does not")
            self.assertIn(f"http://127.0.0.1:{port}/health", test)
            for key in ("interval", "timeout", "retries", "start_period"):
                self.assertIn(key, self.services[name]["healthcheck"])

    def test_caddy_waits_for_healthy_upstreams(self):
        self.assertEqual(
            self.services["caddy"]["depends_on"],
            {"api": {"condition": "service_healthy"}, "realtime": {"condition": "service_healthy"}},
        )

    def test_environment_lists_are_exact(self):
        self.assertEqual(set(self.services["api"]["environment"]), API_ENV)
        self.assertEqual(set(self.services["realtime"]["environment"]), REALTIME_ENV)
        self.assertEqual(set(self.services["caddy"]["environment"]), CADDY_ENV)

    def test_only_the_api_receives_database_credentials_and_signing_keys(self):
        realtime = {e.split("=")[0] for e in self.services["realtime"]["environment"]}
        caddy = {e.split("=")[0] for e in self.services["caddy"]["environment"]}
        for name in ("DATABASE_URL", "JWT_SECRET", "INVITATION_TOKEN_KEY", "AI_PROVIDER_API_KEY", "S3_BUCKET", "S3_REGION"):
            self.assertNotIn(name, realtime)
            self.assertNotIn(name, caddy)
        for name in SECRET_NAMES - {"INTERNAL_SERVICE_SECRET"}:
            self.assertIn(name, {e.split("=")[0] for e in self.services["api"]["environment"]})

    def test_ports_match_the_caddyfile_upstreams(self):
        caddyfile = CADDYFILE.read_text()
        self.assertIn("reverse_proxy api:3000", caddyfile)
        self.assertIn("reverse_proxy realtime:2567", caddyfile)
        self.assertIn("PORT=3000", self.services["api"]["environment"])
        self.assertIn("PORT=2567", self.services["realtime"]["environment"])

    def test_secrets_are_bare_names_never_literals(self):
        for name, service in self.services.items():
            for entry in service["environment"]:
                key, _, value = entry.partition("=")
                if key in SECRET_NAMES or key in {"ALLOWED_ORIGINS", "S3_BUCKET"}:
                    self.assertEqual(value, "", f"{name}: {key} must be a bare name")
            self.assertNotIn("env_file", service, name)


@unittest.skipIf(yaml is None, "PyYAML is not available")
class ComposeFileHygieneTests(unittest.TestCase):
    def test_no_secret_literals_or_env_files(self):
        text = compose_text()
        code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        self.assertNotRegex(code, r"(?i)(password|secret|token_key|database_url)\s*[:=]\s*[^\s$\"'#][^\s]*")
        self.assertNotIn("env_file", code)
        self.assertNotRegex(code, r"postgres(ql)?://")
        self.assertNotRegex(code, r"\b[0-9a-f]{32,}\b")
        self.assertNotIn(".env", code)

    def test_header_documents_how_the_file_is_used(self):
        header = compose_text().split("services:")[0]
        self.assertIn("start-app.sh", header)
        self.assertIn("bare", header.lower())


@unittest.skipUnless(compose_cli_available(), "docker compose CLI is not available")
class ComposeRenderTests(unittest.TestCase):
    """`docker compose config` renders the file without a daemon."""

    ENV = {
        "API_IMAGE": "111122223333.dkr.ecr.us-east-2.amazonaws.com/p/api:release-1",
        "REALTIME_IMAGE": "111122223333.dkr.ecr.us-east-2.amazonaws.com/p/realtime:release-1",
        "MIGRATE_IMAGE": "111122223333.dkr.ecr.us-east-2.amazonaws.com/p/migrate:release-1",
        "SITE_ADDRESS": "203-0-113-10.sslip.io",
        "AWS_REGION": "us-east-2",
        "LOG_GROUP_PREFIX": "/p",
        "JWT_SECRET": "j" * 40,
        "DATABASE_URL": "postgresql://u:p@h:5432/d",
        "INVITATION_TOKEN_KEY": "a" * 64,
        "INTERNAL_SERVICE_SECRET": "i" * 40,
        "AI_PROVIDER_API_KEY": "ai-key-" + "k" * 32,
        "ALLOWED_ORIGINS": "https://app.example.com",
        "PASSWORD_RESET_URL_BASE": "https://app.example.com/reset",
        "S3_REGION": "us-east-2",
        "S3_BUCKET": "bucket",
        "REALTIME_INTERNAL_URL": "http://realtime:2567",
        "API_INTERNAL_URL": "http://api:3000",
    }

    def render(self, env):
        full = dict(os.environ, **env)
        return subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE), "config", "--format", "json"],
            capture_output=True, env=full,
        )

    def test_renders_and_realtime_gets_no_api_only_values(self):
        result = self.render(self.ENV)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        services = json.loads(result.stdout)["services"]
        self.assertEqual(set(services["realtime"]["environment"]),
                         {"NODE_ENV", "PORT", "API_INTERNAL_URL", "INTERNAL_SERVICE_SECRET"})
        self.assertIn("DATABASE_URL", services["api"]["environment"])
        self.assertNotIn("DATABASE_URL", services["realtime"]["environment"])
        self.assertNotIn("JWT_SECRET", services["realtime"]["environment"])
        self.assertNotIn("AI_PROVIDER_API_KEY", services["realtime"]["environment"])
        self.assertIn("AI_PROVIDER_API_KEY", services["api"]["environment"])
        self.assertEqual(set(services["migrate"]["environment"]), {"DATABASE_URL"})

    def test_missing_required_inputs_fail_closed(self):
        for name in ("API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE", "SITE_ADDRESS", "AWS_REGION", "LOG_GROUP_PREFIX"):
            env = {k: v for k, v in self.ENV.items() if k != name}
            full = {k: v for k, v in os.environ.items() if k != name}
            full.update(env)
            result = subprocess.run(
                ["docker", "compose", "-f", str(COMPOSE), "config", "-q"], capture_output=True, env=full)
            self.assertNotEqual(result.returncode, 0, name)


if __name__ == "__main__":
    unittest.main()
