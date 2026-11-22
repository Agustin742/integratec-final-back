"""Static and behavioral checks of the container health publisher: infra/deploy/publish-container-health.sh
and its systemd units (infra/deploy/systemd/app-container-health.{service,timer}).

The script runs against a stub `docker` (answers `ps` and `inspect` from fixture files) and a stub `aws`
(records its arguments), so no AWS account or Docker daemon is needed.
"""
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra/deploy/publish-container-health.sh"
SYSTEMD = ROOT / "infra/deploy/systemd"
COMPOSE = ROOT / "infra/deploy/compose.prod.yaml"
PROD_MAIN = ROOT / "infra/envs/prod/main.tf"
BASH = shutil.which("bash")

REGION = "us-east-2"
NAMESPACE = "AulaVirtual/Containers"

# Fake docker: `ps` prints the container id of the fixture ps_<service>; `inspect` prints the health
# status of the fixture inspect_<id>. STUB_DOCKER_FAIL simulates a daemon that does not answer.
DOCKER_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/docker.log"
if [ -n "${STUB_DOCKER_FAIL:-}" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
case "$1" in
  ps)
    for arg in "$@"; do
      case "$arg" in label=com.docker.compose.service=*) service="${arg#label=com.docker.compose.service=}" ;; esac
    done
    if [ -f "$STUB_FIXTURES/ps_$service" ]; then cat "$STUB_FIXTURES/ps_$service"; fi ;;
  inspect)
    id="${@: -1}"
    if [ -f "$STUB_FIXTURES/inspect_$id" ]; then cat "$STUB_FIXTURES/inspect_$id"; fi ;;
esac
exit 0
"""

# Fake aws: records the call; STUB_AWS_FAIL simulates a rejected or unreachable publish.
AWS_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/aws.log"
if [ -n "${STUB_AWS_FAIL:-}" ]; then echo "Could not connect to the endpoint URL" >&2; exit 255; fi
"""


class UnitFileTests(unittest.TestCase):
    def test_service_runs_the_publisher_once_with_the_non_secret_environment_file(self):
        text = (SYSTEMD / "app-container-health.service").read_text()
        self.assertIn("Type=oneshot", text)
        self.assertRegex(text, r"(?m)^ExecStart=/opt/aula/infra/deploy/publish-container-health\.sh$")
        self.assertRegex(text, r"(?m)^EnvironmentFile=/etc/\S+/deploy\.env$")
        self.assertRegex(text, r"(?m)^TimeoutStartSec=\d+$")
        self.assertNotIn("Restart=", text, "a failed publish must wait for the next timer run, not restart")

    def test_timer_fires_every_minute_and_shortly_after_boot(self):
        text = (SYSTEMD / "app-container-health.timer").read_text()
        for line in ("OnBootSec=1min", "OnUnitActiveSec=1min", "AccuracySec=5s", "WantedBy=timers.target"):
            self.assertIn(line, text)
        self.assertNotIn("Persistent", text, "Persistent= has no effect on monotonic timers")


class StaticTests(unittest.TestCase):
    def setUp(self):
        self.text = SCRIPT.read_text()
        self.code = "\n".join(l for l in self.text.splitlines() if not l.lstrip().startswith("#"))

    def test_strict_mode_and_no_xtrace(self):
        self.assertRegex(self.code, r"(?m)^set -euo pipefail$")
        self.assertNotRegex(self.code, r"set\s+-[a-z]*x|set\s+-o\s+xtrace|bash\s+-x")

    def test_every_docker_and_aws_call_is_bounded_by_a_timeout(self):
        for line in self.code.replace("\\\n", " ").splitlines():
            if re.search(r"\b(docker|aws)\s+(ps|inspect|cloudwatch)\b", line):
                self.assertRegex(line, r"\btimeout\s+\S+\s+(docker|aws)\b", line)
        self.assertRegex(self.code, r"--cli-connect-timeout \d+")
        self.assertRegex(self.code, r"--cli-read-timeout \d+")

    def test_namespace_matches_the_terraform_value(self):
        # The script cannot read Terraform, so the value lives in two places that must stay equal:
        # the root local that feeds the IAM condition and the alarms, and the script default.
        script_value = re.search(r"HEALTH_NAMESPACE:-([A-Za-z0-9_./#:-]+)\}", self.code)
        tf_value = re.search(r'(?m)^\s*container_health_namespace\s*=\s*"([^"]+)"', PROD_MAIN.read_text())
        self.assertIsNotNone(script_value, "the script must default HEALTH_NAMESPACE")
        self.assertIsNotNone(tf_value, "infra/envs/prod/main.tf must define local.container_health_namespace")
        self.assertEqual(script_value.group(1), tf_value.group(1))
        self.assertEqual(tf_value.group(1), NAMESPACE)

    def test_the_compose_project_name_is_read_from_the_compose_file(self):
        self.assertIn("compose.prod.yaml", self.code)
        self.assertRegex(COMPOSE.read_text(), r"(?m)^name: aula-virtual$")


@unittest.skipIf(BASH is None or shutil.which("timeout") is None, "bash and timeout are required")
class BehaviorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(dir=ROOT))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin, self.fixtures, self.logs = (self.tmp / n for n in ("bin", "fixtures", "logs"))
        for d in (self.bin, self.fixtures, self.logs):
            d.mkdir()
        for name, body in (("docker", DOCKER_STUB), ("aws", AWS_STUB)):
            stub = self.bin / name
            stub.write_text(body, newline="\n")
            stub.chmod(stub.stat().st_mode | stat.S_IEXEC)

    def container(self, service, status):
        """Makes the stub report a running container whose healthcheck status is `status`."""
        (self.fixtures / f"ps_{service}").write_text(f"id-{service}\n", newline="\n")
        (self.fixtures / f"inspect_id-{service}").write_text(status + "\n", newline="\n")

    def run_script(self, extra_env=None, drop=()):
        env = {k: v for k, v in os.environ.items() if k not in ("AWS_REGION", "HEALTH_NAMESPACE") and k not in drop}
        env.update(STUB_LOG=str(self.logs), STUB_FIXTURES=str(self.fixtures), AWS_REGION=REGION,
                   PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        env.update(extra_env or {})
        for name in drop:
            env.pop(name, None)
        result = subprocess.run([BASH, str(SCRIPT)], capture_output=True, env=env, cwd=self.tmp, timeout=60)
        return result, result.stdout.decode() + result.stderr.decode()

    def log(self, name):
        path = self.logs / name
        return path.read_text().splitlines() if path.exists() else []

    def published(self):
        """Value published for each service, read from the single put-metric-data call."""
        (call,) = self.log("aws.log")
        self.assertTrue(call.startswith("cloudwatch put-metric-data "), call)
        values = dict(re.findall(r"MetricName=Healthy,Dimensions=\[\{Name=Service,Value=(\w+)\}\],Value=(\d+)", call))
        return call, values

    def test_healthy_containers_publish_one(self):
        self.container("api", "healthy")
        self.container("realtime", "healthy")
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        call, values = self.published()
        self.assertEqual(values, {"api": "1", "realtime": "1"})
        self.assertIn(f"--region {REGION}", call)
        self.assertIn(f"--namespace {NAMESPACE}", call)
        self.assertIn("Unit=Count", call)

    def test_any_status_other_than_healthy_publishes_zero(self):
        for status in ("unhealthy", "starting", "", "none"):
            with self.subTest(status=status):
                shutil.rmtree(self.logs)
                self.logs.mkdir()
                self.container("api", status)
                self.container("realtime", "healthy")
                result, out = self.run_script()
                self.assertEqual(result.returncode, 0, out)
                self.assertEqual(self.published()[1], {"api": "0", "realtime": "1"})

    def test_a_missing_or_stopped_container_publishes_zero_without_inspecting_it(self):
        self.container("realtime", "healthy")
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(self.published()[1], {"api": "0", "realtime": "1"})
        self.assertEqual([c for c in self.log("docker.log") if c.startswith("inspect")], ["inspect --format {{if .State.Health}}{{.State.Health.Status}}{{end}} id-realtime"])

    def test_containers_are_found_by_the_compose_project_and_service_labels(self):
        self.container("api", "healthy")
        self.container("realtime", "healthy")
        self.run_script()
        for service in ("api", "realtime"):
            self.assertIn(
                f"ps --quiet --filter label=com.docker.compose.project=aula-virtual --filter label=com.docker.compose.service={service}",
                self.log("docker.log"),
            )

    def test_an_unreachable_docker_daemon_publishes_zero_for_both(self):
        result, out = self.run_script({"STUB_DOCKER_FAIL": "1"})
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(self.published()[1], {"api": "0", "realtime": "0"})

    def test_a_failed_publish_exits_non_zero_once_without_retrying(self):
        self.container("api", "healthy")
        self.container("realtime", "healthy")
        result, out = self.run_script({"STUB_AWS_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not publish", out.lower())
        self.assertEqual(len(self.log("aws.log")), 1, "the next timer run is the retry")

    def test_the_namespace_can_be_overridden_for_tests_only_through_the_environment(self):
        self.container("api", "healthy")
        self.container("realtime", "healthy")
        result, out = self.run_script({"HEALTH_NAMESPACE": "Other/Namespace"})
        self.assertEqual(result.returncode, 0, out)
        self.assertIn("--namespace Other/Namespace", self.published()[0])

    def test_a_missing_region_fails_before_any_call(self):
        result, out = self.run_script(drop=("AWS_REGION",))
        self.assertEqual(result.returncode, 2, out)
        self.assertIn("AWS_REGION", out)
        self.assertEqual(self.log("docker.log"), [])
        self.assertEqual(self.log("aws.log"), [])


if __name__ == "__main__":
    unittest.main()
