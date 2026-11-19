import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Repository files read by unit tests, by their path from the repository root.

const ROOT = resolve(__dirname, '..');

/** The text of a repository file, such as `index.html` or `src/seo.ts`. */
export const readRepoFile = (path: string): string =>
  readFileSync(resolve(ROOT, path), 'utf8');

/** The application's TypeScript sources, as paths like `src/seo.ts`. */
export const sourceFiles = (): string[] =>
  readdirSync(resolve(ROOT, 'src'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `src/${file}`);

/** Binary and generated files, never read as text. */
const NOT_TEXT =
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|fit|gz|zip)$|^package-lock\.json$/;

/** Every text file the repository tracks, as paths like `src/seo.ts`. */
export const trackedTextFiles = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !NOT_TEXT.test(file));
