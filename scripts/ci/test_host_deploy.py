"""Behavioral checks of infra/pipeline/scripts/host-deploy.sh, the script the deploy pipeline sends
to the EC2 host through SSM Run Command (D19).

The script runs against a stub `aws` (copies a fixture tarball instead of calling S3) and a
start-app.sh stub that lives inside the tarball, so no AWS account or Docker daemon is needed. The
sha256sum, tar and mv of the real system are used. Stub logs live outside the fake host root.
"""
import hashlib
import io
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra/pipeline/scripts/host-deploy.sh"
BASH = shutil.which("bash")

REGISTRY = "111122223333.dkr.ecr.us-east-2.amazonaws.com"
TAG = "release-20261118-0123456"
API_IMAGE = f"{REGISTRY}/aula-virtual-prod-api:{TAG}"
REALTIME_IMAGE = f"{REGISTRY}/aula-virtual-prod-realtime:{TAG}"
MIGRATE_IMAGE = f"{REGISTRY}/aula-virtual-prod-migrate:{TAG}"
URI = f"s3://aula-virtual-prod-pipeline-artifacts-0123/host-files/{TAG}/host-files.tar.gz"

# Fake aws: `s3 cp <uri> <destination> ...` copies the fixture tarball and records the call.
AWS_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/aws.log"
if [ "$1 $2" = "s3 cp" ] && [ -f "$STUB_FIXTURES/host-files.tar.gz" ]; then
  cp "$STUB_FIXTURES/host-files.tar.gz" "$4"
  exit 0
fi
echo "unexpected aws call: $*" >&2
exit 2
"""

# start-app.sh inside the tarball: records its arguments, the inputs it inherits from deploy.env and
# the release it belongs to; STUB_START_FAIL is the exit code it returns.
START_APP_STUB = r"""#!/usr/bin/env bash
{
  echo "args: $*"
  echo "release: $(cat "$(dirname "$0")/RELEASE")"
  echo "env: NAME_PREFIX=${NAME_PREFIX:-} AWS_REGION=${AWS_REGION:-} SITE_ADDRESS=${SITE_ADDRESS:-}"
} >> "$STUB_LOG/start-app.log"
exit "${STUB_START_FAIL:-0}"
"""


# Fake systemctl: records its arguments; STUB_SYSTEMCTL_FAIL is the exit code it returns.
SYSTEMCTL_STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG/systemctl.log"
exit "${STUB_SYSTEMCTL_FAIL:-0}"
"""

HEALTH_UNITS = ("app-container-health.service", "app-container-health.timer")


def tarball(release, health_units=True):
    """Builds the host-files tarball: deploy/ and caddy/ at the top, like the pipeline packs them."""
    buffer = io.BytesIO()
    members = [
        ("deploy/start-app.sh", START_APP_STUB, 0o755),
        ("deploy/compose.prod.yaml", "name: aula-virtual\n", 0o644),
        ("deploy/RELEASE", release + "\n", 0o644),
        ("caddy/Caddyfile", f"# {release}\n", 0o644),
    ]
    if health_units:
        # Packed without the executable bit on purpose: the deploy must set it, like for start-app.sh.
        members.append(("deploy/publish-container-health.sh", "#!/usr/bin/env bash\n", 0o644))
        members += [(f"deploy/systemd/{unit}", f"# {unit} {release}\n", 0o644) for unit in HEALTH_UNITS]
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, body, mode in members:
            data = body.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = mode
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def posix(path):
    return Path(path).as_posix()


class HostDeployScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(dir=ROOT))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin, self.fixtures, self.logs = (self.tmp / n for n in ("bin", "fixtures", "logs"))
        self.aula = self.tmp / "aula"
        for directory in (self.bin, self.fixtures, self.logs, self.aula / "infra" / "deploy", self.aula / "infra" / "caddy"):
            directory.mkdir(parents=True)
        for name, body in (("aws", AWS_STUB), ("systemctl", SYSTEMCTL_STUB)):
            stub = self.bin / name
            stub.write_text(body, newline="\n")
            stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        self.systemd = self.tmp / "systemd"
        self.systemd.mkdir()
        (self.aula / "infra" / "deploy" / "RELEASE").write_text("old\n", newline="\n")
        (self.aula / "infra" / "caddy" / "Caddyfile").write_text("# old\n", newline="\n")
        self.deploy_env = self.tmp / "deploy.env"
        self.deploy_env.write_text("NAME_PREFIX=aula-virtual-prod\nAWS_REGION=us-east-2\nSITE_ADDRESS=203-0-113-10.sslip.io\n", newline="\n")
        self.publish(tarball("new"))

    def publish(self, data):
        (self.fixtures / "host-files.tar.gz").write_bytes(data)
        self.digest = hashlib.sha256(data).hexdigest()

    def run_script(self, extra_env=None, drop=()):
        env = {k: v for k, v in os.environ.items() if k not in drop}
        env.update(
            STUB_LOG=posix(self.logs),
            STUB_FIXTURES=posix(self.fixtures),
            PATH=posix(self.bin) + os.pathsep + os.environ["PATH"],
            AULA_ROOT=posix(self.aula),
            SYSTEMD_DIR=posix(self.systemd),
            DEPLOY_ENV_FILE=posix(self.deploy_env),
            HOST_FILES_URI=URI,
            HOST_FILES_SHA256=self.digest,
            API_IMAGE=API_IMAGE,
            REALTIME_IMAGE=REALTIME_IMAGE,
            MIGRATE_IMAGE=MIGRATE_IMAGE,
        )
        env.update(extra_env or {})
        for name in drop:
            env.pop(name, None)
        result = subprocess.run([BASH, str(SCRIPT)], capture_output=True, env=env, cwd=self.tmp, timeout=60)
        return result, result.stdout.decode() + result.stderr.decode()

    def release(self):
        return (self.aula / "infra" / "deploy" / "RELEASE").read_text().strip()

    def log(self, name):
        path = self.logs / name
        return path.read_text().splitlines() if path.exists() else []

    def leftovers(self):
        return sorted(p.name for p in self.aula.iterdir() if p.name != "infra" and not p.name.startswith("infra."))

    def test_happy_path_swaps_the_tree_and_runs_start_app_with_the_three_images(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "new")
        self.assertEqual((self.aula / "infra" / "caddy" / "Caddyfile").read_text().strip(), "# new")
        self.assertEqual(
            self.log("start-app.log")[0],
            f"args: --api-image {API_IMAGE} --realtime-image {REALTIME_IMAGE} --migrate-image {MIGRATE_IMAGE} --recreate-caddy",
        )
        self.assertEqual(len(self.log("start-app.log")), 3, "start-app.sh runs exactly once")

    def test_start_app_runs_from_the_new_tree_with_the_non_secret_inputs_of_deploy_env(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        log = self.log("start-app.log")
        self.assertEqual(log[1], "release: new")
        self.assertEqual(log[2], "env: NAME_PREFIX=aula-virtual-prod AWS_REGION=us-east-2 SITE_ADDRESS=203-0-113-10.sslip.io")

    def test_start_app_keeps_its_executable_bit(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertTrue(os.access(self.aula / "infra" / "deploy" / "start-app.sh", os.X_OK))

    def test_the_tarball_is_downloaded_from_the_uri_of_the_run_in_the_configured_region(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        (call,) = self.log("aws.log")
        self.assertTrue(call.startswith(f"s3 cp {URI} "), call)
        self.assertIn("--region us-east-2", call)

    def test_the_previous_tree_is_kept_as_a_backup_after_a_successful_swap(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual((self.aula / "infra.prev" / "deploy" / "RELEASE").read_text().strip(), "old")
        self.assertEqual((self.aula / "infra.prev" / "caddy" / "Caddyfile").read_text().strip(), "# old")

    def test_only_one_backup_is_kept_across_deployments(self):
        self.assertEqual(self.run_script()[0].returncode, 0)
        self.publish(tarball("newer"))
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "newer")
        self.assertEqual((self.aula / "infra.prev" / "deploy" / "RELEASE").read_text().strip(), "new")
        self.assertEqual(self.leftovers(), [])

    def test_checksum_mismatch_aborts_before_the_swap(self):
        result, out = self.run_script({"HOST_FILES_SHA256": "0" * 64})
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "old")
        self.assertFalse((self.aula / "infra.prev").exists())
        self.assertEqual(self.log("start-app.log"), [], "start-app.sh must not run")
        self.assertEqual(self.leftovers(), [], "the staging directory is removed")
        self.assertRegex(out.lower(), r"sha-?256|checksum")

    def test_a_tampered_tarball_is_rejected(self):
        digest = self.digest
        self.publish(tarball("tampered"))
        result, out = self.run_script({"HOST_FILES_SHA256": digest})
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "old")

    def test_a_failing_start_restores_the_previous_tree_and_exits_non_zero(self):
        result, out = self.run_script({"STUB_START_FAIL": "7"})
        self.assertEqual(result.returncode, 7, out)
        self.assertEqual(self.release(), "old")
        self.assertEqual((self.aula / "infra" / "caddy" / "Caddyfile").read_text().strip(), "# old")
        self.assertEqual(len(self.log("start-app.log")) // 3, 1, "start-app.sh ran once, from the new tree")
        self.assertEqual(self.log("start-app.log")[1], "release: new")
        self.assertEqual(self.leftovers(), [])

    def test_a_failed_download_aborts_without_touching_the_tree(self):
        (self.fixtures / "host-files.tar.gz").unlink()
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "old")
        self.assertEqual(self.log("start-app.log"), [])
        self.assertEqual(self.leftovers(), [])

    def test_a_tarball_without_the_expected_directories_is_rejected_before_the_swap(self):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            data = b"x"
            info = tarfile.TarInfo("deploy/RELEASE")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        self.publish(buffer.getvalue())
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "old")

    def test_a_changed_caddyfile_asks_start_app_to_recreate_caddy(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertTrue(self.log("start-app.log")[0].endswith(" --recreate-caddy"))

    def test_an_unchanged_caddyfile_does_not_recreate_caddy(self):
        (self.aula / "infra" / "caddy" / "Caddyfile").write_text("# new\n", newline="\n")
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertNotIn("--recreate-caddy", self.log("start-app.log")[0])

    def test_a_first_deployment_without_a_previous_tree_recreates_caddy(self):
        shutil.rmtree(self.aula / "infra")
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertTrue(self.log("start-app.log")[0].endswith(" --recreate-caddy"))

    def test_unsafe_member_paths_abort_before_the_swap(self):
        for name in ("/etc/evil", "../evil", "deploy/../../evil"):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
                info = tarfile.TarInfo(name)
                info.size = 1
                archive.addfile(info, io.BytesIO(b"x"))
            self.publish(buffer.getvalue())
            result, out = self.run_script()
            self.assertNotEqual(result.returncode, 0, name)
            self.assertEqual(self.release(), "old", name)
            self.assertEqual(self.log("start-app.log"), [], name)
            self.assertEqual(self.leftovers(), [], name)

    def test_a_tarball_that_cannot_be_listed_aborts_before_the_swap(self):
        self.publish(tarball("new")[:-40])  # truncated gzip stream; the checksum matches what was published
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.release(), "old")
        self.assertEqual(self.log("start-app.log"), [])
        self.assertIn("list", out.lower())

    def test_the_member_guard_is_not_a_pipeline_that_can_hide_a_listing_failure(self):
        self.assertNotRegex(SCRIPT.read_text(), r"tar -tzf [^\n|]*\|(?!\|)")

    def test_missing_or_malformed_inputs_fail_before_any_download(self):
        cases = [({}, (name,)) for name in ("HOST_FILES_URI", "HOST_FILES_SHA256", "API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE")]
        cases += [
            ({"HOST_FILES_URI": "https://example.com/host-files.tar.gz"}, ()),
            ({"HOST_FILES_URI": f"{URI}; reboot"}, ()),
            ({"HOST_FILES_SHA256": "abc"}, ()),
            ({"API_IMAGE": "nginx:latest"}, ()),
            ({"MIGRATE_IMAGE": f"{MIGRATE_IMAGE} --privileged"}, ()),
        ]
        for env, drop in cases:
            self.logs.joinpath("aws.log").unlink(missing_ok=True)
            result, out = self.run_script(env, drop)
            self.assertNotEqual(result.returncode, 0, f"{env} {drop}: {out}")
            self.assertEqual(self.log("aws.log"), [], f"{env} {drop}")
            self.assertEqual(self.release(), "old")

    def test_a_missing_deploy_env_fails_before_any_download(self):
        self.deploy_env.unlink()
        result, out = self.run_script()
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.log("aws.log"), [])

    def test_a_deploy_env_without_a_region_fails(self):
        self.deploy_env.write_text("NAME_PREFIX=aula-virtual-prod\n", newline="\n")
        result, out = self.run_script(drop=("AWS_REGION",))
        self.assertNotEqual(result.returncode, 0, out)
        self.assertEqual(self.log("aws.log"), [])

    def test_the_container_health_units_are_installed_and_the_timer_is_enabled_after_a_successful_start(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        for unit in HEALTH_UNITS:
            self.assertEqual((self.systemd / unit).read_text(), f"# {unit} new\n")
        self.assertEqual(self.log("systemctl.log"), ["daemon-reload", "enable --now app-container-health.timer"])

    def test_the_container_health_publisher_is_made_executable(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertTrue(os.access(self.aula / "infra" / "deploy" / "publish-container-health.sh", os.X_OK))

    def test_a_failing_start_installs_no_unit(self):
        result, out = self.run_script({"STUB_START_FAIL": "7"})
        self.assertEqual(result.returncode, 7, out)
        self.assertEqual(list(self.systemd.iterdir()), [])
        self.assertEqual(self.log("systemctl.log"), [])

    def test_a_failing_systemctl_warns_but_does_not_fail_a_deployment_that_already_started(self):
        result, out = self.run_script({"STUB_SYSTEMCTL_FAIL": "1"})
        self.assertEqual(result.returncode, 0, out)
        self.assertIn("could not enable the container health timer", out)
        self.assertEqual(self.release(), "new")

    def test_a_tarball_without_the_container_health_units_skips_the_install(self):
        self.publish(tarball("new", health_units=False))
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertEqual(list(self.systemd.iterdir()), [])
        self.assertEqual(self.log("systemctl.log"), [])

    def test_output_never_includes_secret_looking_values(self):
        result, out = self.run_script()
        self.assertEqual(result.returncode, 0, out)
        self.assertNotRegex(out, r"(?i)password|secret|token")


if __name__ == "__main__":
    unittest.main()
