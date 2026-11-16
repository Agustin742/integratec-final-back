"""Static and behavioral checks of infra/scripts/seed-app-secrets.sh."""
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra/scripts/seed-app-secrets.sh"
BASH = shutil.which("bash")

ARNS = {
    "INTERNAL_SERVICE_SECRET": "arn:aws:secretsmanager:us-east-2:111122223333:secret:p/internal-service-secret-AAAAAA",
    "JWT_SECRET": "arn:aws:secretsmanager:us-east-2:111122223333:secret:p/jwt-secret-BBBBBB",
    "INVITATION_TOKEN_KEY": "arn:aws:secretsmanager:us-east-2:111122223333:secret:p/invitation-token-key-CCCCCC",
}

# Fake aws: records every call (arguments only, values included only because the
# test needs to assert them) and answers from environment-controlled behavior.
STUB = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$2" in
  list-secret-version-ids)
    case "$*" in
      *jwt-secret*) [ -n "${STUB_JWT_SET:-}" ] && echo "version-id" || echo "None" ;;
      *) echo "None" ;;
    esac
    ;;
  get-random-password)
    if [[ "$*" == *--exclude-uppercase* ]]; then
      printf '%s\n' "${STUB_HEX:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
    else
      printf '%s\n' "${STUB_PLAIN:-Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1A}"
    fi
    ;;
  put-secret-value) ;;
esac
"""


def script_text():
    return SCRIPT.read_text()


class StaticTests(unittest.TestCase):
    def setUp(self):
        self.text = script_text()
        self.code = "\n".join(l for l in self.text.splitlines() if not l.lstrip().startswith("#"))

    def test_strict_mode_and_no_xtrace(self):
        self.assertRegex(self.code, r"(?m)^set -euo pipefail$")
        self.assertNotRegex(self.code, r"set\s+-[a-z]*x|set\s+-o\s+xtrace|bash\s+-x")

    def test_checks_current_version_before_put(self):
        self.assertIn("has_current_version", self.code)
        self.assertLess(self.code.index('if has_current_version "$arn"'), self.code.index("put-secret-value"))
        self.assertIn("AWSCURRENT", self.code)
        self.assertIn("already set", self.code)

    def test_exact_generation_flags(self):
        plain = re.search(r"generate_secret\(\) \{(.*?)\n\}", self.code, re.S).group(1)
        for flag in ["--password-length 64", "--exclude-punctuation", "--no-include-space",
                     "--require-each-included-type", "--query RandomPassword", "--output text"]:
            self.assertIn(flag, plain)
        self.assertNotIn("--exclude-uppercase", plain)
        hexed = re.search(r"generate_hex_key\(\) \{(.*?)\n\}", self.code, re.S).group(1)
        for flag in ["--password-length 64", "--exclude-uppercase", "--exclude-punctuation",
                     "--exclude-characters ghijklmnopqrstuvwxyz", "--no-include-space",
                     "--no-require-each-included-type", "--query RandomPassword", "--output text"]:
            self.assertIn(flag, hexed)

    def test_secret_to_generator_and_validation_mapping(self):
        self.assertIn("seed INTERNAL_SERVICE_SECRET generate_secret '^[A-Za-z0-9]{64}$'", self.code)
        self.assertIn("seed JWT_SECRET generate_secret '^[A-Za-z0-9]{64}$'", self.code)
        self.assertIn("seed INVITATION_TOKEN_KEY generate_hex_key '^[0-9a-f]{64}$'", self.code)
        self.assertLess(self.code.index('[[ ! "$value" =~ $pattern ]]'), self.code.index("put-secret-value"))

    def test_value_is_never_printed_or_written(self):
        self.assertNotRegex(self.code, r"(echo|printf)[^\n]*\$\{?value\b")
        self.assertNotRegex(self.code, r"\$\{?value\b[^\n]*(>|>>)\s*(?!/dev/null|&)[^\s]")
        self.assertNotRegex(self.code, r"\btee\b")
        self.assertIn("unset value", self.code)


@unittest.skipIf(BASH is None, "bash is not available")
class BehaviorTests(unittest.TestCase):
    def run_script(self, extra_env=None, args=None):
        tmp = tempfile.mkdtemp(dir=ROOT)
        self.addCleanup(shutil.rmtree, tmp, True)
        stub = Path(tmp) / "aws"
        stub.write_text(STUB, newline="\n")
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        log = Path(tmp) / "calls.log"
        log.write_text("")
        env = dict(os.environ, STUB_LOG=str(log), PATH=tmp + os.pathsep + os.environ["PATH"])
        env.update(extra_env or {})
        arns = "{" + ",".join(f'"{k}": "{v}"' for k, v in ARNS.items()) + "}"
        result = subprocess.run([BASH, str(SCRIPT)] + (["--region", "us-east-2"] if args is None else args),
                                input=arns.encode(), capture_output=True, env=env)
        calls = log.read_text().splitlines()
        return result, calls

    def test_seeds_unset_secrets_and_skips_existing(self):
        result, calls = self.run_script({"STUB_JWT_SET": "1"})
        out = result.stdout.decode() + result.stderr.decode()
        self.assertEqual(result.returncode, 0, out)
        puts = [c for c in calls if "put-secret-value" in c]
        self.assertEqual(len(puts), 2)
        self.assertFalse(any("jwt-secret" in c for c in puts))
        self.assertIn("JWT_SECRET: already set", out)
        self.assertIn("INTERNAL_SERVICE_SECRET: set", out)
        self.assertIn("INVITATION_TOKEN_KEY: set", out)

    def test_values_are_never_printed(self):
        result, _ = self.run_script()
        out = result.stdout.decode() + result.stderr.decode()
        self.assertEqual(result.returncode, 0, out)
        self.assertNotIn("Ab1Ab1", out)
        self.assertNotIn("0123456789abcdef", out)

    def test_invalid_hex_key_is_rejected_before_put(self):
        result, calls = self.run_script({"STUB_HEX": "G" * 64})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("put-secret-value" in c and "invitation-token-key" in c for c in calls))

    def test_invalid_plain_secret_is_rejected_before_put(self):
        result, calls = self.run_script({"STUB_PLAIN": "short"})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("put-secret-value" in c for c in calls))

    def test_region_is_required(self):
        result, calls = self.run_script(args=[])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
