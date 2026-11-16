import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Each entry: "<Name> <version>", "Source: <url naming the version>",
// "License reproduced from the installed <package>/<file>." and the text.
const notices = readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8');
const entries = [
  ...notices.matchAll(
    /^(.+) (\d+\.\d+\.\d+)\nSource: (\S+)\nLicense reproduced from the installed (.+)\/([^/\s]+)\.\n/gm,
  ),
].map(([, name, version, source, pkg, file]) => ({
  name,
  version,
  source,
  pkg,
  file,
}));
const installed = (pkg: string) =>
  (
    JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8')) as {
      version: string;
    }
  ).version;
const words = (text: string) =>
  text
    .replace(/^[-=]+$/gm, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

it('lists every redistributed dependency at its installed version', () => {
  expect(entries.map((e) => e.pkg).sort()).toEqual(
    ['fflate', 'maplibre-contour', 'maplibre-gl'].sort(),
  );
  for (const entry of entries) {
    expect(entry.version, entry.name).toBe(installed(entry.pkg));
    expect(entry.source, entry.name).toContain(entry.version);
  }
});
it('reproduces each installed license text', () => {
  for (const entry of entries) {
    const license = readFileSync(
      `node_modules/${entry.pkg}/${entry.file}`,
      'utf8',
    );
    expect(words(notices), entry.name).toContain(words(license));
  }
});
