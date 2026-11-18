"""Static and behavioral checks of infra/deploy/start-app.sh.

The script runs against a stub `aws` (answers from fixture files) and a stub `docker` (records its
arguments and the environment `docker compose` would see), so no AWS account or Docker daemon is
needed. Stub logs live outside the directory the script runs in, which must stay empty.
"""
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra/deploy/start-app.sh"
BASH = shutil.which("bash")

PREFIX = "aula-virtual-prod"
REGION = "us-east-2"
REGISTRY = "111122223333.dkr.ecr.us-east-2.amazonaws.com"
API_IMAGE = f"{REGISTRY}/{PREFIX}/api:release-1"
REALTIME_IMAGE = f"{REGISTRY}/{PREFIX}/realtime:release-1"
MIGRATE_IMAGE = f"{REGISTRY}/{PREFIX}/migrate:release-1"
DB_SECRET_ARN = "arn:aws:secretsmanager:us-east-2:111122223333:secret:rds!db-1234-AbCdEf"

JWT = "jwt-" + "J" * 60
INVITATION = "0123456789abcdef" * 4
INTERNAL = "internal-" + "I" * 60
DB_USER = "aula_admin"
DB_PASSWORD = "a:b#c?d%e&f=g+h~i!j$k*l(m)n"
ECR_TOKEN = "ecr-token-" + "T" * 40

API_PARAMS = {
    "ALLOWED_ORIGINS": "https://app.example.com,https://admin.example.com",
    "PASSWORD_RESET_URL_BASE": "https://app.example.com/reset-password",
    "NODE_ENV": "production",
    "S3_REGION": "us-east-2",
    "S3_BUCKET": "aula-virtual-prod-files-0123",
    "REALTIME_INTERNAL_URL": "http://realtime:2567",
    "DB_HOST": "aula.abc123.us-east-2.rds.amazonaws.com",
    "DB_PORT": "5432",
    "DB_NAME": "aula",
    "DB_SECRET_ARN": DB_SECRET_ARN,
}
REALTIME_PARAMS = {"API_INTERNAL_URL": "http://api:3000", "NODE_ENV": "production"}

SECRET_VALUES = [JWT, INVITATION, INTERNAL, DB_PASSWORD, quote(DB_PASSWORD, safe=""), ECR_TOKEN]

# Fake aws: answers from $STUB_FIXTURES, one file per call target; a missing file is an
# AccessDenied-like failure. It emulates the --query/--output text of the real calls.
AWS_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/aws.log"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' _; }
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { printf '%s' "$2"; return; }; shift; done; }
case "$1 $2" in
  "ssm get-parameters-by-path") f="$STUB_FIXTURES/ssm_$(key "$(arg --path "$@")")" ;;
  "secretsmanager get-secret-value")
    if [[ "$*" == *"--query VersionId"* ]]; then f="$STUB_FIXTURES/version_$(key "$(arg --secret-id "$@")")"
    else f="$STUB_FIXTURES/secret_$(key "$(arg --secret-id "$@")")"; fi ;;
  "ecr get-login-password") f="$STUB_FIXTURES/ecr_token" ;;
  *) echo "unexpected aws call: $*" >&2; exit 2 ;;
esac
if [ ! -f "$f" ]; then
  echo "An error occurred (AccessDeniedException) when calling the $2 operation" >&2
  exit 254
fi
cat "$f"
"""

# Fake flock: records its call; STUB_FLOCK_FAIL simulates a lock that is never released.
FLOCK_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/flock.log"
if [ -n "${STUB_FLOCK_FAIL:-}" ]; then exit 1; fi
"""

# Fake docker: `login` keeps the password from stdin; `compose` dumps its environment.
DOCKER_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/docker.log"
case "$1" in
  login) echo "login-stdin: $(cat)" >> "$STUB_LOG/docker-login.log" ;;
  compose)
    env > "$STUB_LOG/compose-env.$STUB_RUN"
    if [ -n "${STUB_COMPOSE_FAIL:-}" ]; then exit 1; fi
    case " $* " in *" --force-recreate "*) if [ -n "${STUB_RECREATE_FAIL:-}" ]; then exit 1; fi ;; esac
    case " $* " in *" run "*) if [ -n "${STUB_MIGRATE_FAIL:-}" ]; then exit 1; fi ;; esac ;;
esac
"""


def fixture_name(prefix, target):
    return prefix + "_" + "".join(c if c.isalnum() else "_" for c in target)


def ssm_text(params, service):
    return "\n".join(f"/{PREFIX}/config/{service}/{k}\t{v}" for k, v in params.items()) + "\n"


def script_text():
    return SCRIPT.read_text()


SYSTEMD = ROOT / "infra/deploy/systemd"


class SystemdUnitTests(unittest.TestCase):
    def test_service_runs_the_refresh_once_with_a_non_secret_environment_file(self):
        text = (SYSTEMD / "app-db-refresh.service").read_text()
        self.assertIn("Type=oneshot", text)
        self.assertRegex(text, r"(?m)^ExecStart=\S*start-app\.sh --refresh-if-rotated$")
        self.assertRegex(text, r"(?m)^EnvironmentFile=/etc/\S+/deploy\.env$")

    def test_timer_checks_every_ten_minutes_and_after_boot(self):
        text = (SYSTEMD / "app-db-refresh.timer").read_text()
        for line in ("OnBootSec=2min", "OnUnitActiveSec=10min", "WantedBy=timers.target"):
            self.assertIn(line, text)
        self.assertNotIn("Persistent", text, "Persistent= has no effect on monotonic timers")


class StaticTests(unittest.TestCase):
    def setUp(self):
        self.text = script_text()
        self.code = "\n".join(l for l in self.text.splitlines() if not l.lstrip().startswith("#"))

    def test_strict_mode_and_no_xtrace(self):
        self.assertRegex(self.code, r"(?m)^set -euo pipefail$")
        self.assertNotRegex(self.code, r"set\s+-[a-z]*x|set\s+-o\s+xtrace|bash\s+-x")

    def test_never_writes_secrets_to_disk(self):
        self.assertNotRegex(self.code, r"\btee\b")
        self.assertNotRegex(self.code, r"\.env\b")
        self.assertNotRegex(self.code, r"--env-file")
        self.assertNotRegex(self.code, r"(?m)>>?\s*(?!/dev/null|&|\"\$(state|lock)_file\")[\"$\w./]")

    def test_secret_variables_are_never_echoed(self):
        for line in self.code.replace("\\\n", " ").splitlines():
            if re.search(r"\b(echo|printf)\b", line):
                self.assertNotRegex(
                    line,
                    r"\$\{?(jwt|invitation|internal|db_password|db_user|database_url|JWT_SECRET|"
                    r"INVITATION_TOKEN_KEY|INTERNAL_SERVICE_SECRET|DATABASE_URL|password|token)",
                    line,
                )

    def test_ecr_login_reads_the_password_from_stdin(self):
        self.assertIn("--password-stdin", self.code)
        self.assertRegex(self.code, r"aws ecr get-login-password[^|\n]*\|[^\n]*docker login --username AWS --password-stdin")

    def test_header_says_where_the_ecr_token_lands(self):
        header = self.text.split("set -euo pipefail")[0]
        self.assertIn("docker login", header)
        self.assertRegex(header, r"(?s)12 hours.*Docker config")

    def test_state_line_is_written_on_one_line(self):
        self.assertNotRegex(self.code, r"(?m)printf '[^'\n]*$")
        self.assertIn("printf 'db_secret_version=%s\\n'", self.code)

    def test_compose_runs_with_wait(self):
        self.assertRegex(self.code, r"docker compose -f \"\$compose_file\" up -d --remove-orphans --wait")


@unittest.skipIf(BASH is None, "bash is not available")
class BehaviorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(dir=ROOT))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = self.tmp / "bin"
        self.fixtures = self.tmp / "fixtures"
        self.logs = self.tmp / "logs"
        self.work = self.tmp / "work"
        for d in (self.bin, self.fixtures, self.logs, self.work):
            d.mkdir()
        for name, body in (("aws", AWS_STUB), ("docker", DOCKER_STUB), ("flock", FLOCK_STUB)):
            stub = self.bin / name
            stub.write_text(body, newline="\n")
            stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        self.runs = 0
        self.state = self.tmp / "state" / "deployed-state"
        self.write_defaults()

    # fixtures -------------------------------------------------------------------------------
    def write_secret(self, name, value):
        (self.fixtures / fixture_name("secret", f"{PREFIX}/{name}")).write_text(value, newline="\n")

    def write_defaults(self):
        self.write_secret("internal-service-secret", INTERNAL)
        self.write_secret("jwt-secret", JWT)
        self.write_secret("invitation-token-key", INVITATION)
        (self.fixtures / fixture_name("secret", DB_SECRET_ARN)).write_text(
            f'{{"username":"{DB_USER}","password":"{DB_PASSWORD}"}}', newline="\n")
        (self.fixtures / fixture_name("ssm", f"/{PREFIX}/config/api")).write_text(
            ssm_text(API_PARAMS, "api"), newline="\n")
        (self.fixtures / fixture_name("ssm", f"/{PREFIX}/config/realtime")).write_text(
            ssm_text(REALTIME_PARAMS, "realtime"), newline="\n")
        self.write_version("v1")
        (self.fixtures / "ecr_token").write_text(ECR_TOKEN, newline="\n")

    def write_version(self, version):
        (self.fixtures / fixture_name("version", DB_SECRET_ARN)).write_text(version + "\n", newline="\n")

    def remove_fixture(self, name):
        (self.fixtures / name).unlink()

    # execution ------------------------------------------------------------------------------
    def args(self):
        return [
            "--name-prefix", PREFIX, "--region", REGION,
            "--api-image", API_IMAGE, "--realtime-image", REALTIME_IMAGE,
            "--migrate-image", MIGRATE_IMAGE,
            "--site-address", "203-0-113-10.sslip.io",
        ]

    def run_script(self, args=None, extra_env=None):
        self.runs += 1
        inputs = ("NAME_PREFIX", "AWS_REGION", "API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE", "SITE_ADDRESS", "DB_ENDPOINT",
                  "DB_NAME", "DB_SECRET_ARN", "DB_HOST", "DB_PORT")
        env = dict((k, v) for k, v in os.environ.items() if k not in inputs)
        env.update(STUB_LOG=str(self.logs), STUB_FIXTURES=str(self.fixtures),
                   STUB_RUN=str(self.runs), DEPLOY_STATE_FILE=str(self.state), PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        env.update(extra_env or {})
        result = subprocess.run([BASH, str(SCRIPT)] + (self.args() if args is None else args),
                                capture_output=True, env=env, cwd=self.work)
        return result, result.stdout.decode() + result.stderr.decode()

    def log(self, name):
        path = self.logs / name
        return path.read_text().splitlines() if path.exists() else []

    def compose_calls(self):
        return [c for c in self.log("docker.log") if c.startswith("compose")]

    def up_calls(self):
        return [c for c in self.compose_calls() if " up " in c]

    def migrate_calls(self):
        return [c for c in self.compose_calls() if " run " in c]

    def state_values(self):
        return dict(line.split("=", 1) for line in self.state.read_text().splitlines())

    def compose_env(self, run=None):
        path = self.logs / f"compose-env.{run or self.runs}"
        env = {}
        for line in path.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep:
                env[key] = value
        return env

    # tests ----------------------------------------------------------------------------------
    def test_happy_path_starts_compose_with_the_expected_environment(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        compose_calls = self.up_calls()
        self.assertEqual(len(compose_calls), 1)
        self.assertRegex(compose_calls[0], r"^compose -f \S+compose\.prod\.yaml up -d --remove-orphans --wait")
        env = self.compose_env()
        self.assertEqual(env["API_IMAGE"], API_IMAGE)
        self.assertEqual(env["REALTIME_IMAGE"], REALTIME_IMAGE)
        self.assertEqual(env["MIGRATE_IMAGE"], MIGRATE_IMAGE)
        self.assertEqual(env["SITE_ADDRESS"], "203-0-113-10.sslip.io")
        self.assertEqual(env["AWS_REGION"], REGION)
        self.assertEqual(env["LOG_GROUP_PREFIX"], f"/{PREFIX}")
        self.assertEqual(env["JWT_SECRET"], JWT)
        self.assertEqual(env["INVITATION_TOKEN_KEY"], INVITATION)
        self.assertEqual(env["INTERNAL_SERVICE_SECRET"], INTERNAL)
        for key, value in {**API_PARAMS, **REALTIME_PARAMS}.items():
            if key != "NODE_ENV" and not key.startswith("DB_"):
                self.assertEqual(env[key], value, key)
        for key in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_SECRET_ARN"):
            self.assertNotIn(key, env, "database connection info is for building DATABASE_URL, not for the containers")

    def test_database_url_url_encodes_the_credentials_and_requires_tls(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        expected = (f"postgresql://{quote(DB_USER, safe='')}:{quote(DB_PASSWORD, safe='')}"
                    "@aula.abc123.us-east-2.rds.amazonaws.com:5432/aula?sslmode=require")
        self.assertEqual(self.compose_env()["DATABASE_URL"], expected)

    def test_ecr_login_precedes_compose_and_uses_stdin(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        calls = self.log("docker.log")
        logins = [c for c in calls if c.startswith("login")]
        self.assertEqual(logins, [f"login --username AWS --password-stdin {REGISTRY}"])
        self.assertLess(calls.index(logins[0]), next(i for i, c in enumerate(calls) if c.startswith("compose")))
        self.assertEqual(self.log("docker-login.log"), [f"login-stdin: {ECR_TOKEN}"])
        self.assertTrue(any(c.startswith("ecr get-login-password") and f"--region {REGION}" in c
                            for c in self.log("aws.log")))

    def test_values_are_never_printed_or_passed_in_arguments(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        for value in SECRET_VALUES:
            self.assertNotIn(value, out)
            for call in self.log("docker.log") + self.log("aws.log"):
                self.assertNotIn(value, call)

    def test_caller_environment_cannot_override_fetched_values(self):
        result, out = self.run_script(extra_env={"JWT_SECRET": "attacker", "DATABASE_URL": "attacker"})
        self.assertEqual(result.returncode, 0, out)
        env = self.compose_env()
        self.assertEqual(env["JWT_SECRET"], JWT)
        self.assertTrue(env["DATABASE_URL"].startswith("postgresql://"))

    def test_nothing_is_written_to_disk(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(list(self.work.iterdir()), [])
        self.assertEqual([p.name for p in SCRIPT.parent.iterdir() if p.name.startswith(".env")], [])

    def test_rerun_is_idempotent(self):
        first, out1 = self.run_script()
        second, out2 = self.run_script()
        self.assertEqual((first.returncode, second.returncode), (0, 0), out1 + out2)
        envs = [{k: v for k, v in self.compose_env(n).items() if k != "STUB_RUN"} for n in (1, 2)]
        self.assertEqual(envs[0], envs[1])

    def test_missing_secret_or_database_secret_fails_closed(self):
        targets = {
            "INTERNAL_SERVICE_SECRET": fixture_name("secret", f"{PREFIX}/internal-service-secret"),
            "JWT_SECRET": fixture_name("secret", f"{PREFIX}/jwt-secret"),
            "INVITATION_TOKEN_KEY": fixture_name("secret", f"{PREFIX}/invitation-token-key"),
            "RDS master secret": fixture_name("secret", DB_SECRET_ARN),
        }
        for label, fixture in targets.items():
            with self.subTest(label):
                self.write_defaults()
                self.remove_fixture(fixture)
                result, out = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(label.split()[0], out)
                self.assertFalse(bool(self.compose_calls()))

    def test_empty_secret_value_fails_closed(self):
        self.write_secret("jwt-secret", "None\n")
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("JWT_SECRET", out)
        self.assertFalse(bool(self.compose_calls()))

    def test_missing_config_parameter_fails_closed(self):
        for service, params in (("api", API_PARAMS), ("realtime", REALTIME_PARAMS)):
            for name in params:
                if name == "NODE_ENV":
                    continue
                with self.subTest(f"{service}/{name}"):
                    self.write_defaults()
                    trimmed = {k: v for k, v in params.items() if k != name}
                    (self.fixtures / fixture_name("ssm", f"/{PREFIX}/config/{service}")).write_text(
                        ssm_text(trimmed, service), newline="\n")
                    result, out = self.run_script()
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(name, out)
                    self.assertFalse(bool(self.compose_calls()))

    def test_unreadable_parameter_path_fails_closed(self):
        self.remove_fixture(fixture_name("ssm", f"/{PREFIX}/config/realtime"))
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("realtime", out)
        self.assertFalse(bool(self.compose_calls()))

    def test_database_secret_without_a_usable_password_fails_closed(self):
        for body in ('{"username":"u"}', '{"password":"p"}', '{"username":"u","password":"a\\\\b"}', "not json"):
            with self.subTest(body):
                (self.fixtures / fixture_name("secret", DB_SECRET_ARN)).write_text(body, newline="\n")
                result, out = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(bool(self.compose_calls()))
                self.assertNotIn("not json", out)

    def test_failed_ecr_login_stops_before_compose(self):
        self.remove_fixture("ecr_token")
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(bool(self.compose_calls()))

    def test_missing_or_invalid_inputs_are_usage_errors_without_aws_calls(self):
        base = self.args()
        cases = {}
        for flag in ("--name-prefix", "--region", "--api-image", "--realtime-image", "--migrate-image", "--site-address"):
            i = base.index(flag)
            cases[f"missing {flag}"] = base[:i] + base[i + 2:]
        cases["non-ECR image"] = [a if a != API_IMAGE else "docker.io/library/nginx:latest" for a in base]
        cases["non-ECR migrate image"] = [a if a != MIGRATE_IMAGE else "docker.io/library/nginx:latest" for a in base]
        cases["image without tag"] = [a if a != API_IMAGE else f"{REGISTRY}/{PREFIX}/api" for a in base]
        for old in ("--db-endpoint", "--db-name", "--db-secret-arn"):
            cases[f"removed {old}"] = base + [old, "x"]
        cases["unknown argument"] = base + ["--bogus", "x"]
        cases["option without value"] = base + ["--region"]
        for label, args in cases.items():
            with self.subTest(label):
                result, out = self.run_script(args=args)
                self.assertEqual(result.returncode, 2, out)
                self.assertEqual(self.log("aws.log"), [])
                self.assertEqual(self.log("docker.log"), [])


    def test_deploy_records_only_the_secret_version(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(self.state_values(), {
            "db_secret_version": "v1", "api_image": API_IMAGE, "realtime_image": REALTIME_IMAGE,
            "migrate_image": MIGRATE_IMAGE})
        for value in SECRET_VALUES:
            self.assertNotIn(value, self.state.read_text())

    def test_refresh_with_the_same_version_does_nothing(self):
        self.run_script()
        result, out = self.run_script(args=self.args() + ["--refresh-if-rotated"])
        self.assertEqual((result.returncode, out), (0, ""))
        self.assertEqual(len(self.up_calls()), 1)

    def test_refresh_after_rotation_redeploys_with_the_new_password(self):
        self.run_script()
        self.write_version("v2")
        (self.fixtures / fixture_name("secret", DB_SECRET_ARN)).write_text(
            '{"username":"aula_admin","password":"rotated"}', newline="\n")
        result, out = self.run_script(args=self.args() + ["--refresh-if-rotated"])
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(len(self.up_calls()), 2)
        self.assertIn(":rotated@", self.compose_env()["DATABASE_URL"])
        self.assertEqual(self.state_values()["db_secret_version"], "v2")

    def test_refresh_without_state_deploys(self):
        result, out = self.run_script(args=self.args() + ["--refresh-if-rotated"])
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(len(self.up_calls()), 1)
        self.assertEqual(self.state_values()["db_secret_version"], "v1")

    def test_state_is_not_written_when_compose_fails(self):
        self.run_script()
        self.write_version("v2")
        result, out = self.run_script(extra_env={"STUB_COMPOSE_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state_values()["db_secret_version"], "v1")

    def test_unreadable_version_fails_closed(self):
        self.remove_fixture(fixture_name("version", DB_SECRET_ARN))
        for extra in ([], ["--refresh-if-rotated"]):
            result, out = self.run_script(args=self.args() + extra)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(self.compose_calls())
            self.assertFalse(self.state.exists())

    def args_without(self, *flags):
        args = self.args()
        for flag in flags:
            i = args.index(flag)
            args = args[:i] + args[i + 2:]
        return args

    def test_refresh_redeploys_the_images_last_deployed_not_the_environment_ones(self):
        image_b = {"--api-image": f"{REGISTRY}/{PREFIX}/api:release-2",
                   "--realtime-image": f"{REGISTRY}/{PREFIX}/realtime:release-2",
                   "--migrate-image": f"{REGISTRY}/{PREFIX}/migrate:release-2"}
        args = self.args()
        for flag, value in image_b.items():
            args[args.index(flag) + 1] = value
        self.assertEqual(self.run_script(args=args)[0].returncode, 0)
        self.write_version("v2")
        stale = {"API_IMAGE": API_IMAGE, "REALTIME_IMAGE": REALTIME_IMAGE, "MIGRATE_IMAGE": MIGRATE_IMAGE}
        result, out = self.run_script(
            args=self.args_without("--api-image", "--realtime-image", "--migrate-image") + ["--refresh-if-rotated"],
            extra_env=stale)
        self.assertEqual(result.returncode, 0, out)
        env = self.compose_env()
        self.assertEqual((env["API_IMAGE"], env["REALTIME_IMAGE"], env["MIGRATE_IMAGE"]), tuple(image_b.values()))
        self.assertEqual(self.state_values()["api_image"], image_b["--api-image"])
        self.assertEqual(self.state_values()["migrate_image"], image_b["--migrate-image"])

    def test_refresh_of_a_state_without_migrate_image_fails_and_asks_for_a_redeploy(self):
        self.state.parent.mkdir(parents=True)
        self.state.write_text(
            f"db_secret_version=v0\napi_image={API_IMAGE}\nrealtime_image={REALTIME_IMAGE}\n", newline="\n")
        result, out = self.run_script(
            args=self.args_without("--migrate-image") + ["--refresh-if-rotated"],
            extra_env={"MIGRATE_IMAGE": MIGRATE_IMAGE})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--migrate-image", out)
        self.assertFalse(self.compose_calls())
        self.assertNotIn("migrate_image", self.state.read_text())

    def test_migrations_run_once_before_up_with_the_same_compose_file(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        calls = self.compose_calls()
        self.assertEqual(len(calls), 2, calls)
        self.assertRegex(calls[0], r"^compose -f \S+compose\.prod\.yaml run --rm --no-deps migrate$")
        self.assertRegex(calls[1], r" up -d --remove-orphans --wait")
        self.assertEqual(calls[0].split()[2], calls[1].split()[2])

        self.assertTrue(self.compose_env()["DATABASE_URL"].startswith("postgresql://"))

    def test_recreate_caddy_runs_a_second_up_for_caddy_only_after_the_stack_is_up(self):
        result, out = self.run_script(args=self.args() + ["--recreate-caddy"])
        self.assertEqual(result.returncode, 0, out)
        calls = self.compose_calls()
        self.assertEqual(len(calls), 3, calls)
        self.assertRegex(calls[2], r"^compose -f \S+compose\.prod\.yaml up -d --no-deps --force-recreate --wait --wait-timeout 180 caddy$")
        self.assertEqual(calls[1].split()[2], calls[2].split()[2])
        self.assertEqual(self.compose_env(self.runs)["SITE_ADDRESS"], "203-0-113-10.sslip.io")

    def test_without_the_flag_caddy_is_not_recreated(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertFalse(any("--force-recreate" in c for c in self.compose_calls()))

    def test_a_failed_recreate_fails_the_run_and_leaves_the_state_unwritten(self):
        result, out = self.run_script(args=self.args() + ["--recreate-caddy"], extra_env={"STUB_RECREATE_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0, out)
        self.assertFalse(self.state.exists())

    def test_refresh_after_rotation_also_migrates_before_up(self):
        self.run_script()
        self.write_version("v2")
        result, out = self.run_script(args=self.args() + ["--refresh-if-rotated"])
        self.assertEqual(result.returncode, 0, out)
        calls = self.compose_calls()
        self.assertEqual([" run " in c for c in calls], [True, False, True, False])

    def test_a_failing_migration_aborts_before_up_and_keeps_the_previous_state(self):
        self.run_script()
        previous = self.state.read_text()
        self.write_version("v2")
        up_before = len(self.up_calls())
        result, out = self.run_script(extra_env={"STUB_MIGRATE_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("migration", out.lower())
        self.assertEqual(len(self.migrate_calls()), 2)
        self.assertEqual(len(self.up_calls()), up_before, "up must not run after a failed migration")
        self.assertEqual(self.state.read_text(), previous)

    def test_refresh_without_state_or_images_fails_closed(self):
        result, out = self.run_script(
            args=self.args_without("--api-image", "--realtime-image", "--migrate-image") + ["--refresh-if-rotated"])
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.compose_calls())

    def test_a_deploy_runs_under_one_lock_with_a_bounded_wait(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(len(self.log("flock.log")), 1)
        self.assertRegex(self.log("flock.log")[0], r"^-w 300 \d+$")

    def test_lock_timeout_fails_with_a_clear_message_before_any_work(self):
        result, out = self.run_script(extra_env={"STUB_FLOCK_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("another deployment", out.lower())
        self.assertEqual(self.log("aws.log"), [])
        self.assertFalse(self.compose_calls())

    @unittest.skipIf(shutil.which("flock") is None, "flock is not installed here (it ships with util-linux)")
    def test_a_held_lock_is_respected_with_the_real_flock(self):
        (self.bin / "flock").unlink()
        lock = self.state.parent / "deploy.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        holder = subprocess.Popen(["flock", str(lock), "sleep", "10"])
        self.addCleanup(holder.kill)
        import time
        time.sleep(0.5)
        result, out = self.run_script(extra_env={"DEPLOY_LOCK_WAIT": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("another deployment", out.lower())
        self.assertFalse(self.compose_calls())

    def test_two_registries_get_two_logins(self):
        other = "999988887777.dkr.ecr.us-east-2.amazonaws.com"
        args = self.args()
        args[args.index("--realtime-image") + 1] = f"{other}/{PREFIX}/realtime:release-1"
        result, out = self.run_script(args=args)
        self.assertEqual(result.returncode, 0, out)
        logins = [c for c in self.log("docker.log") if c.startswith("login")]
        self.assertEqual(logins, [f"login --username AWS --password-stdin {REGISTRY}",
                                  f"login --username AWS --password-stdin {other}"])

    def test_database_settings_come_from_the_api_config_not_from_the_caller(self):
        stale = {"DB_ENDPOINT": "evil.example.com:1", "DB_NAME": "evil", "DB_SECRET_ARN": "arn:evil",
                 "DB_HOST": "evil.example.com", "DB_PORT": "1"}
        result, out = self.run_script(extra_env=stale)
        self.assertEqual(result.returncode, 0, out)
        self.assertIn("@aula.abc123.us-east-2.rds.amazonaws.com:5432/aula?sslmode=require", self.compose_env()["DATABASE_URL"])
        self.assertTrue(any(f"--secret-id {DB_SECRET_ARN}" in c for c in self.log("aws.log")))
        self.assertFalse(any("evil" in c for c in self.log("aws.log")))

    def test_missing_database_parameter_fails_closed_before_touching_secrets(self):
        for name in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_SECRET_ARN"):
            with self.subTest(name):
                self.write_defaults()
                self.logs.joinpath("aws.log").unlink(missing_ok=True)
                trimmed = {k: v for k, v in API_PARAMS.items() if k != name}
                (self.fixtures / fixture_name("ssm", f"/{PREFIX}/config/api")).write_text(
                    ssm_text(trimmed, "api"), newline="\n")
                result, out = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, out)
                self.assertFalse(self.compose_calls())
                self.assertFalse(any(c.startswith("secretsmanager") for c in self.log("aws.log")))

    def test_malformed_database_parameters_fail_closed(self):
        bad = {"DB_HOST": "not a host", "DB_PORT": "5432x", "DB_NAME": "Bad-Name"}
        for name, value in bad.items():
            with self.subTest(name):
                self.write_defaults()
                params = {**API_PARAMS, name: value}
                (self.fixtures / fixture_name("ssm", f"/{PREFIX}/config/api")).write_text(
                    ssm_text(params, "api"), newline="\n")
                result, out = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, out)
                self.assertFalse(self.compose_calls())

    def test_usage_and_header_no_longer_mention_database_inputs(self):
        header = script_text().split("set -euo pipefail")[0]
        self.assertNotRegex(header, r"--db-|DB_ENDPOINT")
        self.assertIn("DB_HOST", header)

    def test_service_unit_environment_file_only_needs_the_host_basics(self):
        text = (SYSTEMD / "app-db-refresh.service").read_text()
        self.assertNotRegex(text, r"DB_ENDPOINT|DB_NAME|DB_SECRET_ARN")

    def test_inputs_may_come_from_the_environment(self):
        args = self.args()
        env = {}
        for flag, var in (("--name-prefix", "NAME_PREFIX"), ("--region", "AWS_REGION"),
                          ("--api-image", "API_IMAGE"), ("--realtime-image", "REALTIME_IMAGE"),
                          ("--migrate-image", "MIGRATE_IMAGE"),
                          ("--site-address", "SITE_ADDRESS")):
            env[var] = args[args.index(flag) + 1]
        result, out = self.run_script(args=[], extra_env=env)
        self.assertEqual(result.returncode, 0, out)


if __name__ == "__main__":
    unittest.main()
