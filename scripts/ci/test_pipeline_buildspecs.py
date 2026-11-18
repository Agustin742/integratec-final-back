"""Static checks of the CodeBuild buildspecs that run Terraform for the deploy pipeline (D19).

The plan buildspec saves a plan that a person approves; the apply buildspec must apply exactly
that file. The buildspecs are parsed with PyYAML (preinstalled on GitHub-hosted Ubuntu runners);
the tests that need it are skipped when it is missing.
"""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - depends on the interpreter
    yaml = None

ROOT = Path(__file__).resolve().parents[2]
BUILDSPEC_DIR = ROOT / "infra/pipeline/buildspecs"
PLAN = BUILDSPEC_DIR / "terraform-plan.yml"
APPLY = BUILDSPEC_DIR / "terraform-apply.yml"
IMAGES = BUILDSPEC_DIR / "images.yml"
DEPLOY = BUILDSPEC_DIR / "deploy.yml"
HOST_DEPLOY_SCRIPT = ROOT / "infra/pipeline/scripts/host-deploy.sh"
START_APP = ROOT / "infra/deploy/start-app.sh"
INSTALL_SCRIPT = ROOT / "infra/pipeline/scripts/install-terraform.sh"
CI_WORKFLOW = ROOT / ".github/workflows/ci.yml"

INIT_FLAGS = ("-input=false", "-lockfile=readonly", '-backend-config="bucket=$TF_STATE_BUCKET"')


def load(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def commands(spec):
    """Every command of every phase, in file order."""
    found = []
    for phase in spec["phases"].values():
        found.extend(phase["commands"])
    return found


def terraform_commands(spec, subcommand):
    return [c for c in commands(spec) if re.match(rf"^terraform {subcommand}\b", c)]


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class BuildspecTests(unittest.TestCase):
    def setUp(self):
        self.plan = load(PLAN)
        self.apply = load(APPLY)

    def test_both_files_are_buildspec_version_0_2(self):
        for spec in (self.plan, self.apply):
            self.assertEqual(spec["version"], 0.2)

    def test_terraform_version_equals_the_ci_pin(self):
        ci = re.search(r"terraform_version:\s*([0-9]+\.[0-9]+\.[0-9]+)", CI_WORKFLOW.read_text(encoding="utf-8"))
        self.assertIsNotNone(ci, "ci.yml must pin terraform_version")
        for spec in (self.plan, self.apply):
            self.assertEqual(spec["env"]["variables"]["TERRAFORM_VERSION"], ci.group(1))

    def test_both_install_terraform_through_the_checksum_verifying_script(self):
        for spec in (self.plan, self.apply):
            install = spec["phases"]["install"]["commands"]
            self.assertIn("bash infra/pipeline/scripts/install-terraform.sh", install)

    def test_plan_inits_locked_to_the_lock_file_and_the_injected_state_bucket(self):
        (init,) = terraform_commands(self.plan, "init")
        for flag in INIT_FLAGS:
            self.assertIn(flag, init)

    def test_apply_inits_the_same_way(self):
        (init,) = terraform_commands(self.apply, "init")
        for flag in INIT_FLAGS:
            self.assertIn(flag, init)

    def test_plan_saves_the_plan_and_prints_it_for_the_approver(self):
        (plan,) = terraform_commands(self.plan, "plan")
        self.assertIn("-out=tfplan", plan)
        self.assertIn("-input=false", plan)
        self.assertIn("-lock-timeout=5m", plan)
        self.assertIn("terraform show -no-color tfplan", commands(self.plan))

    def test_plan_runs_in_the_prod_root(self):
        self.assertIn("cd infra/envs/prod", commands(self.plan))
        self.assertIn("cd infra/envs/prod", commands(self.apply))

    def test_plan_exports_the_plan_and_the_infra_tree_without_provider_binaries(self):
        artifacts = self.plan["artifacts"]
        self.assertIn("infra/**/*", artifacts["files"])
        self.assertTrue(any(".terraform/" in p for p in artifacts["exclude-paths"]))
        # The lock file travels inside the tree and must not be excluded.
        self.assertFalse(any("lock.hcl" in p for p in artifacts["exclude-paths"]))

    def test_apply_applies_only_the_saved_plan(self):
        (apply,) = terraform_commands(self.apply, "apply")
        self.assertRegex(apply, r"\btfplan$")
        self.assertIn("-input=false", apply)
        self.assertIn("-lock-timeout=5m", apply)
        self.assertEqual(terraform_commands(self.apply, "plan"), [])
        self.assertNotIn("-auto-approve", apply)

    def test_apply_fails_early_when_the_lock_file_or_the_plan_is_missing(self):
        joined = "\n".join(commands(self.apply))
        self.assertIn(".terraform.lock.hcl", joined)
        self.assertIn("tfplan", joined)

    def test_apply_does_not_run_after_a_failed_step(self):
        # No `|| true` or other failure swallowing anywhere in the buildspecs.
        for spec in (self.plan, self.apply):
            for command in commands(spec):
                self.assertNotRegex(command, r"\|\|\s*(true|:)")

    def test_no_credentials_or_secrets_are_written_in_the_files(self):
        for path in (PLAN, APPLY, INSTALL_SCRIPT):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"AKIA[0-9A-Z]{16}")
            self.assertNotRegex(text, r"[0-9]{12}")
            self.assertNotIn("AWS_SECRET_ACCESS_KEY", text)


def bash_works():
    """True when `bash` exists and runs POSIX scripts (the WSL stub on Windows does not)."""
    bash = shutil.which("bash")
    if bash is None:
        return False
    try:
        result = subprocess.run([bash, "-c", "echo ok"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip() == "ok"


def run_bash(script, env=None):
    return subprocess.run(
        [shutil.which("bash"), "-c", script],
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": "/usr/bin:/bin", **(env or {})},
    )


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class ImagesBuildspecTests(unittest.TestCase):
    def setUp(self):
        self.spec = load(IMAGES)
        self.commands = commands(self.spec)
        self.text = "\n".join(self.commands)

    def test_buildspec_is_version_0_2_and_runs_in_bash(self):
        self.assertEqual(self.spec["version"], 0.2)
        self.assertEqual(self.spec["env"]["shell"], "bash")

    def test_results_are_exported_for_the_deploy_stage(self):
        self.assertEqual(
            self.spec["env"]["exported-variables"],
            ["IMAGE_TAG", "API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE"],
        )
        for name in self.spec["env"]["exported-variables"]:
            self.assertRegex(self.text, rf"(?m)^export {name}=")

    def test_it_emits_no_artifact(self):
        self.assertNotIn("artifacts", self.spec)

    def test_tag_is_release_date_and_short_commit_and_fails_without_the_commit_id(self):
        guard = next((c for c in self.commands if "CODEBUILD_RESOLVED_SOURCE_VERSION" in c and "exit 1" in c), None)
        self.assertIsNotNone(guard, "a command must fail the build when the commit id is missing")
        tag = next(c for c in self.commands if c.startswith("export IMAGE_TAG="))
        self.assertIn("date -u +%Y%m%d", tag)
        self.assertIn("${CODEBUILD_RESOLVED_SOURCE_VERSION:0:7}", tag)
        self.assertLess(self.commands.index(guard), self.commands.index(tag))

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_guard_fails_when_the_commit_id_is_missing_or_empty(self):
        guard = next(c for c in self.commands if "CODEBUILD_RESOLVED_SOURCE_VERSION" in c and "exit 1" in c)
        for env in ({}, {"CODEBUILD_RESOLVED_SOURCE_VERSION": ""}):
            result = run_bash(guard, env)
            self.assertNotEqual(result.returncode, 0, env)

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_tag_has_the_expected_shape_and_passes_the_host_image_validation(self):
        guard = next(c for c in self.commands if "CODEBUILD_RESOLVED_SOURCE_VERSION" in c and "exit 1" in c)
        tag_command = next(c for c in self.commands if c.startswith("export IMAGE_TAG="))
        result = run_bash(
            f'{guard}\n{tag_command}\necho "$IMAGE_TAG"',
            {"CODEBUILD_RESOLVED_SOURCE_VERSION": "0123456789abcdef0123456789abcdef01234567"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        tag = result.stdout.strip()
        self.assertRegex(tag, r"^release-[0-9]{8}-0123456$")
        pattern = re.search(r"ecr_image_pattern='([^']+)'", START_APP.read_text(encoding="utf-8"))
        self.assertIsNotNone(pattern, "start-app.sh must define ecr_image_pattern")
        uri = f"123456789012.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod-api:{tag}"
        self.assertRegex(uri, pattern.group(1))

    def test_registry_login_sends_the_password_on_stdin(self):
        login = next(c for c in self.commands if "docker login" in c)
        self.assertIn("aws ecr get-login-password", login)
        self.assertIn("--password-stdin", login)
        self.assertNotRegex(login, r"(--password|-p)[ =]")

    def test_images_are_built_from_the_repository_root_with_the_expected_dockerfiles_and_targets(self):
        builds = [c for c in self.text.splitlines() if "docker build" in c]
        self.assertTrue(builds)
        self.assertIn("apps/api/Dockerfile", self.text)
        self.assertIn("apps/realtime/Dockerfile", self.text)
        self.assertRegex(self.text, r"--target migrate")
        self.assertRegex(self.text, r"(?m)^\s*(?:\S+ )*docker build .*\s\.\s*$")
        # Only the migrate image selects a target; api keeps the final (runner) stage.
        self.assertEqual(len(re.findall(r"--target", self.text)), 1)

    def test_each_image_is_checked_in_ecr_before_it_is_pushed(self):
        self.assertIn("aws ecr describe-images", self.text)
        self.assertLess(self.text.index("aws ecr describe-images"), self.text.index("docker push"))
        # Only a missing image is built; any other describe error fails the build.
        self.assertIn("ImageNotFoundException", self.text)
        self.assertRegex(self.text, r"already exists|skipping")
        # The check runs once per image: the three images go through one function.
        calls = [c for c in self.commands if re.match(r"^build_and_push ", c)]
        self.assertEqual(len(calls), 3)

    def test_images_use_the_repositories_and_registry_injected_by_terraform(self):
        for name in ("ECR_REGISTRY", "ECR_REPOSITORY_API", "ECR_REPOSITORY_REALTIME", "ECR_REPOSITORY_MIGRATE"):
            self.assertIn(f"${{{name}}}", self.text)

    def test_nothing_swallows_a_failure_and_no_account_id_is_written(self):
        for command in self.commands:
            self.assertNotRegex(command, r"\|\|\s*(true|:)")
        self.assertNotRegex(IMAGES.read_text(encoding="utf-8"), r"[0-9]{12}")


VALID_RELEASE_TAG = "release-20261118-0123456"
DEPLOY_ENV = {
    "IMAGE_TAG": VALID_RELEASE_TAG,
    "API_IMAGE": f"123456789012.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod-api:{VALID_RELEASE_TAG}",
    "REALTIME_IMAGE": f"123456789012.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod-realtime:{VALID_RELEASE_TAG}",
    "MIGRATE_IMAGE": f"123456789012.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod-migrate:{VALID_RELEASE_TAG}",
    "INSTANCE_ID": "i-0123456789abcdef0",
    "ARTIFACT_BUCKET": "aula-virtual-prod-pipeline-artifacts-0123",
    "SITE_ADDRESS": "203-0-113-10.sslip.io",
}


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class DeployBuildspecTests(unittest.TestCase):
    def setUp(self):
        self.spec = load(DEPLOY)
        self.commands = commands(self.spec)
        self.text = "\n".join(self.commands)

    def guard(self):
        return next(c for c in self.commands if "IMAGE_TAG" in c and "exit 1" in c)

    def test_buildspec_is_version_0_2_and_runs_in_bash(self):
        self.assertEqual(self.spec["version"], 0.2)
        self.assertEqual(self.spec["env"]["shell"], "bash")

    def test_it_emits_no_artifact(self):
        self.assertNotIn("artifacts", self.spec)

    def test_inputs_are_validated_before_anything_is_uploaded_or_sent(self):
        guard = self.guard()
        for name in ("IMAGE_TAG", "API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE", "INSTANCE_ID", "ARTIFACT_BUCKET", "SITE_ADDRESS"):
            self.assertIn(name, guard)
        self.assertIn("release-", guard)
        self.assertLess(self.commands.index(guard), min(i for i, c in enumerate(self.commands) if "aws s3 cp" in c))
        self.assertLess(self.commands.index(guard), min(i for i, c in enumerate(self.commands) if "aws ssm send-command" in c))

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_guard_accepts_the_values_the_pipeline_provides(self):
        result = run_bash(self.guard(), DEPLOY_ENV)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_guard_fails_when_a_variable_is_missing_or_empty(self):
        for name in DEPLOY_ENV:
            for env in ({k: v for k, v in DEPLOY_ENV.items() if k != name}, {**DEPLOY_ENV, name: ""}):
                result = run_bash(self.guard(), env)
                self.assertNotEqual(result.returncode, 0, name)

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_guard_rejects_images_that_are_not_release_ecr_uris_of_the_run(self):
        registry = "123456789012.dkr.ecr.us-east-2.amazonaws.com"
        bad_images = (
            f"{registry}/aula-virtual-prod-api:latest",
            f"{registry}/aula-virtual-prod-api:release-20261117-0123456",
            f"{registry}/aula-virtual-prod-api",
            "docker.io/library/nginx:release-20261118-0123456",
            f"{registry}/aula-virtual-prod-api:{VALID_RELEASE_TAG} --privileged",
        )
        for name in ("API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE"):
            for image in bad_images:
                result = run_bash(self.guard(), {**DEPLOY_ENV, name: image})
                self.assertNotEqual(result.returncode, 0, f"{name}={image}")
        for tag in ("latest", "release-1", "release-20261118-XYZ"):
            result = run_bash(self.guard(), {**DEPLOY_ENV, "IMAGE_TAG": tag})
            self.assertNotEqual(result.returncode, 0, tag)

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_guard_rejects_an_instance_id_or_host_name_that_could_inject_shell(self):
        for name, value in (("INSTANCE_ID", "i-123; reboot"), ("INSTANCE_ID", "web-1"), ("SITE_ADDRESS", "a.example.com/x"), ("SITE_ADDRESS", "a b")):
            result = run_bash(self.guard(), {**DEPLOY_ENV, name: value})
            self.assertNotEqual(result.returncode, 0, f"{name}={value}")

    def test_host_files_are_packaged_from_exactly_the_deploy_and_caddy_directories(self):
        (tar,) = [l for l in self.text.splitlines() if re.search(r"\btar\b.*-czf", l)]
        self.assertRegex(tar, r"-C infra deploy caddy\s*$")
        self.assertNotIn("--exclude", tar)

    def test_tarball_and_its_sha256_are_uploaded_under_host_files_of_the_image_tag(self):
        uploads = [l for l in self.text.splitlines() if "aws s3 cp" in l]
        self.assertEqual(len(uploads), 2)
        self.assertTrue(any('"s3://${ARTIFACT_BUCKET}/host-files/${IMAGE_TAG}/host-files.tar.gz"' in l for l in uploads))
        self.assertTrue(any('"s3://${ARTIFACT_BUCKET}/host-files/${IMAGE_TAG}/host-files.tar.gz.sha256"' in l for l in uploads))
        self.assertIn("sha256sum", self.text)
        self.assertLess(self.text.index("sha256sum"), self.text.index("aws s3 cp"))

    def test_send_command_targets_the_instance_with_the_shell_document_and_explicit_timeouts(self):
        send = self.text[self.text.index("aws ssm send-command"):]
        send = send[: send.index("--output text") + len("--output text")]
        self.assertIn("--document-name AWS-RunShellScript", send)
        self.assertIn('--instance-ids "$INSTANCE_ID"', send)
        self.assertNotIn("--targets", send)
        self.assertIn('--timeout-seconds "$SSM_DELIVERY_TIMEOUT_SECONDS"', send)
        self.assertIn("executionTimeout", self.text)
        self.assertIn("SSM_EXECUTION_TIMEOUT_SECONDS", self.text)
        self.assertIn("--comment", send)
        self.assertIn("CODEBUILD_INITIATOR", send)
        self.assertIn("IMAGE_TAG", send)

    def test_timeouts_are_declared_and_ordered(self):
        variables = self.spec["env"]["variables"]
        delivery = int(variables["SSM_DELIVERY_TIMEOUT_SECONDS"])
        execution = int(variables["SSM_EXECUTION_TIMEOUT_SECONDS"])
        poll = int(variables["SSM_POLL_DEADLINE_SECONDS"])
        self.assertGreaterEqual(delivery, 30)
        self.assertGreater(poll, delivery + execution)

    def test_remote_script_is_the_checked_in_file_and_the_values_travel_shell_quoted(self):
        self.assertIn("infra/pipeline/scripts/host-deploy.sh", self.text)
        self.assertIn("--rawfile", self.text)
        for name in ("HOST_FILES_URI", "HOST_FILES_SHA256", "API_IMAGE", "REALTIME_IMAGE", "MIGRATE_IMAGE"):
            self.assertIn(name, self.text)
        self.assertIn("@sh", self.text)
        self.assertIn("file://", self.text)

    def test_the_run_is_polled_until_a_terminal_status_within_a_deadline(self):
        self.assertIn("aws ssm get-command-invocation", self.text)
        self.assertIn("SSM_POLL_DEADLINE_SECONDS", self.text)
        for status in ("Pending", "InProgress", "Delayed", "Cancelling"):
            self.assertIn(status, self.text)
        self.assertIn("InvocationDoesNotExist", self.text)
        self.assertIn("sleep", self.text)
        self.assertIn("StandardOutputContent", self.text)
        self.assertIn("StandardErrorContent", self.text)
        self.assertRegex(self.text, r'"\$status" = "Success"|"\$status" != "Success"')

    def packaging_block(self):
        return next(c for c in self.commands if re.search(r"\btar\b.*-czf", c))

    def test_packaging_block_fails_the_build_on_any_error(self):
        block = self.packaging_block()
        self.assertRegex(block, r"(?m)^set -euo pipefail$")
        # The options must not leak into the later commands, which handle statuses themselves.
        self.assertRegex(block, r"(?m)^set \+eu \+o pipefail$")

    @unittest.skipUnless(bash_works(), "a working bash is required")
    def test_packaging_block_exits_non_zero_when_the_host_files_are_missing(self):
        with tempfile.TemporaryDirectory() as empty:
            result = subprocess.run(
                [shutil.which("bash"), "-c", self.packaging_block()],
                capture_output=True, text=True, timeout=60, cwd=empty,
                env={"PATH": "/usr/bin:/bin", **DEPLOY_ENV},
            )
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_a_poll_deadline_cancels_the_command_before_failing(self):
        poll = next(c for c in self.commands if "aws ssm get-command-invocation" in c and "deadline" in c)
        self.assertIn('aws ssm cancel-command --command-id "$command_id" --instance-ids "$INSTANCE_ID"', poll)
        self.assertRegex(poll, r"(?i)cancel(l)?ed")
        self.assertLess(poll.index("cancel-command"), poll.index("did not succeed"))

    def test_health_checks_cover_both_public_paths_with_retries_and_a_deadline(self):
        self.assertIn("https://${SITE_ADDRESS}/api/health", self.text)
        self.assertIn("https://${SITE_ADDRESS}/realtime/health", self.text)
        self.assertIn("HEALTH_CHECK_DEADLINE_SECONDS", self.text)
        self.assertIn("curl", self.text)
        self.assertIn("^2[0-9][0-9]$", self.text)
        self.assertLess(self.text.index("aws ssm get-command-invocation"), self.text.index("/api/health"))

    def test_nothing_swallows_a_failure_traces_or_writes_an_account_id(self):
        for command in self.commands:
            self.assertNotRegex(command, r"\|\|\s*(true|:)")
        text = DEPLOY.read_text(encoding="utf-8")
        self.assertNotRegex(text, r"\bset\s+-[a-z]*x")
        self.assertNotRegex(text, r"[0-9]{12}")
        self.assertNotRegex(text, r"AKIA[0-9A-Z]{16}")
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", text)


class HostDeployScriptSourceTests(unittest.TestCase):
    def test_script_is_strict_never_traces_and_fits_a_heredoc(self):
        text = HOST_DEPLOY_SCRIPT.read_text(encoding="utf-8")
        self.assertRegex(text, r"(?m)^set -euo pipefail$")
        self.assertNotRegex(text, r"\bset\s+-[a-z]*x")
        self.assertTrue(text.endswith("\n"))
        # The buildspec sends the file through a quoted heredoc ended by this word.
        self.assertNotIn("HOST_DEPLOY_SCRIPT", text)


class InstallScriptTests(unittest.TestCase):
    def setUp(self):
        self.text = INSTALL_SCRIPT.read_text(encoding="utf-8")

    def test_script_fails_fast(self):
        self.assertRegex(self.text, r"(?m)^set -euo pipefail$")

    def test_script_requires_the_version_from_the_buildspec(self):
        self.assertIn("${TERRAFORM_VERSION:?", self.text)

    def test_script_downloads_from_hashicorp_and_verifies_the_official_checksums(self):
        self.assertIn("https://releases.hashicorp.com/terraform/", self.text)
        self.assertIn("_SHA256SUMS", self.text)
        self.assertIn("sha256sum -c", self.text)

    def test_script_selects_the_checksum_line_of_the_downloaded_archive_only(self):
        self.assertRegex(self.text, r"terraform_\$\{TERRAFORM_VERSION\}_linux_amd64\.zip")

    def test_script_installs_after_the_verification(self):
        self.assertLess(self.text.index("sha256sum -c"), self.text.index("unzip"))

    def test_script_checks_the_installed_version(self):
        self.assertIn("terraform version", self.text)


if __name__ == "__main__":
    unittest.main()
