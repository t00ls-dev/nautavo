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
