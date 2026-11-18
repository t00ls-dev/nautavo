import { expect, it } from 'vitest';
import { readRepoFile } from './repo-files';

// Each entry: "<Name> <version>", "Source: <url naming the version>",
// "License reproduced from the installed <package>/<file>." and the text.
const notices = readRepoFile('public/THIRD_PARTY_NOTICES.txt');
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
    JSON.parse(readRepoFile(`node_modules/${pkg}/package.json`)) as {
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
    const license = readRepoFile(`node_modules/${entry.pkg}/${entry.file}`);
    expect(words(notices), entry.name).toContain(words(license));
  }
});
