// Fails when the given paths have uncommitted changes, including NEW untracked
// files (which `git diff --exit-code` does not report).
// Usage: node scripts/check-generated-clean.mjs <path> [<path>...]
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write('Usage: node scripts/check-generated-clean.mjs <path> [<path>...]\n');
  process.exit(2);
}

const status = execFileSync('git', ['status', '--porcelain', '--', ...paths], {
  encoding: 'utf8',
}).trim();

if (status !== '') {
  process.stderr.write(`${status}\n`);
  process.exit(1);
}
