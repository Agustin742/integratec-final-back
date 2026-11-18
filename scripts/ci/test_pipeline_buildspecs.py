"""Static checks of the CodeBuild buildspecs that run Terraform for the deploy pipeline (D19).

The plan buildspec saves a plan that a person approves; the apply buildspec must apply exactly
that file. The buildspecs are parsed with PyYAML (preinstalled on GitHub-hosted Ubuntu runners);
the tests that need it are skipped when it is missing.
"""
import re
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
