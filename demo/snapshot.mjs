// Commit-ready copy of today's demo: snapshots/YYYY-MM-DD - <title>.html. The index repo's nightly refresh finds it
// on the default branch and lists the day on the Sprint tab (and on the public sprint site, if the page opts in).
// Day snapshots are frozen records: today's can be rewritten, an earlier day's never is.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { file, day, today } = JSON.parse(readFileSync('dist/demo/name.txt', 'utf8'));
const out = join('snapshots', `${file}.html`);
if (day < today && existsSync(out)) {
  console.error(`snapshot: ${out} is a frozen record from an earlier day; not overwriting it`);
  process.exit(1);
}
mkdirSync('snapshots', { recursive: true });
copyFileSync('dist/demo/page.html', out);
console.log(`snapshot: ${out}`);
