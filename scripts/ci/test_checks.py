"""Deterministic public-check regressions; fixtures stay inside the project."""
import os
import sys
import tempfile
import shlex
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/ci/check_docs.py"


def guard_script(workflow):
    return workflow.split('        run: |\n', 1)[1].split('\n      - uses:', 1)[0]


class PromotionTests(unittest.TestCase):
    def test_develop_trigger(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('pull_request:\n    branches:\n      - develop\n', workflow)

    def test_public_guard_cases(self):
        script = guard_script((ROOT / '.github/workflows/ci.yml').read_text())
        for base, head, accepted in [
            ('develop', 'docs/work', True), ('develop', 'feat/tasks', True),
            ('test', 'develop', True), ('main', 'test', True),
            ('test', 'docs/work', False), ('test', 'main', False),
            ('main', 'develop', False), ('main', 'docs/work', False),
        ]:
            with self.subTest(base=base, head=head):
                assignments = f'BASE_REF={shlex.quote(base)}; HEAD_REF={shlex.quote(head)};\n'
                result = subprocess.run(['bash'], input=(assignments + script).encode(),
                                        capture_output=True)
                error = '' if accepted else (
                    f"Pull requests into '{base}' must come from the promotion branch (got '{head}').\n")
                self.assertEqual((result.returncode, result.stdout.decode(), result.stderr.decode()),
                                 (0 if accepted else 1, '', error))


class PackageTests(unittest.TestCase):
    def test_package_detection(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        script = workflow.split('      - name: Detect frontend package\n', 1)[1]
        script = script.split('        run: |\n', 1)[1].split('\n      - name:', 1)[0]
        for name, package, lock, code, output, error in [
            ('no_package', False, False, 0, 'present=false\n', ''),
            ('locked_package', True, True, 0, 'present=true\n', ''),
            ('missing_lock', True, False, 1, '',
             'package.json exists, but pnpm-lock.yaml is missing; CI requires the pnpm lockfile.\n'),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory(
                    prefix='.fixtures-', dir=CHECKER.parent) as scratch:
                folder = Path(scratch)
                if package:
                    (folder / 'package.json').write_text('{}', encoding='utf-8')
                if lock:
                    (folder / 'pnpm-lock.yaml').write_text('', encoding='utf-8')
                (folder / 'output').write_text('', encoding='utf-8')
                result = subprocess.run(['bash'], cwd=ROOT,
                    input=(f'cd {shlex.quote(folder.relative_to(ROOT).as_posix())}\n'
                           'GITHUB_OUTPUT=output\n' + script).encode(), capture_output=True)
                self.assertEqual((result.returncode, result.stdout.decode(), result.stderr.decode()),
                                 (code, '', error))
                self.assertEqual((folder / 'output').read_text(), output)

    def test_absence_notices(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        cases = [
            ('Run tests',
             '::notice title=Tests not configured::No test script is configured; no tests were run.\n',
             '## Tests not configured\nNo `test` script is configured in `package.json`; no tests were run.\n'),
            ('Report docs-only frontend',
             '::notice title=Tests not configured::No package.json or test script is present; no tests were run.\n',
             '## Tests not configured\nThis frontend has no `package.json` or test script; no tests were run.\n'),
        ]
        for step, notice, summary in cases:
            script = workflow.split(f'      - name: {step}\n', 1)[1]
            script = script.split('        run: |\n', 1)[1].split('\n      - name:', 1)[0]
            with self.subTest(step=step), tempfile.TemporaryDirectory(
                    prefix='.fixtures-', dir=CHECKER.parent) as scratch:
                folder = Path(scratch)
                result = subprocess.run(['bash'], cwd=ROOT,
                    input=(f'cd {shlex.quote(folder.relative_to(ROOT).as_posix())}\n'
                           'GITHUB_STEP_SUMMARY=summary\n'
                           'node() { return 1; }\n' + script).encode(), capture_output=True)
                self.assertEqual((result.returncode, result.stdout.decode(), result.stderr.decode()),
                                 (0, notice, ''))
                self.assertEqual((folder / 'summary').read_text(), summary)


class DocumentationTests(unittest.TestCase):
    def test_public_checker_cases(self):
        cases = [
            ('accepted_anchor', '# Title\n\n[Self](#title)\n', ''),
            ('accepted_path', '[Target](target.md#hello-world)\n', ''),
            ('accepted_ignored_examples', '`[Plan](planned.md)`\n```md\n[Plan](planned.md)\n```\n[Web](https://example.invalid)\n', ''),
            ('rejected_path', '[Missing](missing.md)\n', 'README.md: broken link: missing.md\n'),
            ('rejected_anchor', '[Missing](#absent)\n', 'README.md: broken anchor: #absent\n'),
            ('accepted_existing_whitespace', '# Title  \n\nExisting text \n', ''),
            ('accepted_no_final_newline', '# Title', ''),
        ]
        with tempfile.TemporaryDirectory(prefix='.fixtures-', dir=CHECKER.parent) as scratch:
            folder = Path(scratch)
            (folder / 'target.md').write_text('# Hello World\n', encoding='utf-8')
            for name, source, error in cases:
                with self.subTest(name=name):
                    (folder / 'README.md').write_text(source, encoding='utf-8')
                    result = subprocess.run([sys.executable, str(CHECKER), 'README.md'],
                        cwd=folder, capture_output=True, text=True,
                        env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
                    self.assertEqual((result.returncode, result.stdout, result.stderr),
                                     (1, '', error) if error else
                                     (0, 'Documentation checks passed (1 files).\n', ''))


if __name__ == '__main__':
    unittest.main()
