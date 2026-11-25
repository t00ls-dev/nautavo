import { expect, it } from 'vitest';
import { readRepoFile, trackedTextFiles } from './repo-files';

// The writing rules of docs/BRAND.md (Name and writing), checked on every
// text file the project ships or keeps.

/** Third-party texts kept word for word: licenses, notices, the Covenant. */
const VERBATIM = new Set([
  'LICENSE',
  'CODE_OF_CONDUCT.md',
  'public/THIRD_PARTY_NOTICES.txt',
]);
const files = () => trackedTextFiles().filter((file) => !VERBATIM.has(file));

/** Lines of the repository's text files that match `pattern`. */
function matches(
  pattern: RegExp,
  allowed: (line: string) => boolean = () => false,
) {
  return files().flatMap((file) =>
    readRepoFile(file)
      .split('\n')
      .flatMap((line, i) =>
        pattern.test(line) && !allowed(line)
          ? [`${file}:${i + 1}: ${line.trim().slice(0, 160)}`]
          : [],
      ),
  );
}

it('uses no em dash: a colon, a comma, parentheses or two sentences instead', () => {
  expect(matches(/\u2014/)).toEqual([]);
});

it('uses straight quotes and apostrophes', () => {
  expect(matches(/[\u2018\u2019\u201C\u201D]/)).toEqual([]);
});

it('writes the name Nautavo in text; lowercase only in the wordmark, domain and identifiers', () => {
  // A bare word: not a domain, path, package, identifier or code span.
  const lowercase = /(?<![\w./@`-])nautavo(?![\w-]|\.[a-z]|\/|`)/;
  expect(
    matches(
      lowercase,
      (line) =>
        // The drawn wordmark, described, the npm package's and the saved
        // routes database's identifiers and this rule's own pattern.
        line.includes('The wordmark is **nautavo**') ||
        line.includes('"name": "nautavo"') ||
        line.includes("LIBRARY_DATABASE = 'nautavo'") ||
        line.includes('const lowercase = '),
    ),
  ).toEqual([]);
});
