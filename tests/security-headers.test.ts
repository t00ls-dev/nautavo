import { describe, expect, it } from 'vitest';
import {
  DEV_SECURITY_HEADERS,
  headersFile,
  HSTS,
  SECURITY_HEADERS,
} from '../src/security-headers';
import worker from '../src/worker';
import { readRepoFile } from './repo-files';

const CSP = 'Content-Security-Policy';
const directives = (policy: string) =>
  Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );

describe('security headers', () => {
  it('allow scripts only from the site and refuse framing', () => {
    const policy = directives(SECURITY_HEADERS[CSP]);
    expect(policy['default-src']).toEqual(["'none'"]);
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    // The services' terms rely on the browser's own Referer.
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('require https as the Cloudflare zone does, preload-ready', () => {
    // The zone's HSTS setting replaces this header at the edge; both stay
    // the same value (AGENTS.md, Hosting and publication).
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toBe(HSTS);
    expect(HSTS).toBe('max-age=31536000; includeSubDomains; preload');
    // hstspreload.org's requirements: at least a year, subdomains, preload.
    const [age, ...flags] = HSTS.split('; ');
    expect(Number(age.replace('max-age=', ''))).toBeGreaterThanOrEqual(
      31536000,
    );
    expect(flags).toEqual(['includeSubDomains', 'preload']);
  });

  it('connect the published site only to https services', () => {
    const policy = directives(SECURITY_HEADERS[CSP]);
    expect(policy['connect-src']).toEqual(["'self'", 'https:']);
    expect(SECURITY_HEADERS[CSP]).not.toMatch(/\bhttp:/);
  });

  it('differ on the development server only by its styles and local servers', () => {
    const published = directives(SECURITY_HEADERS[CSP]);
    const dev = directives(DEV_SECURITY_HEADERS[CSP]);
    expect(dev['style-src']).toEqual([
      ...published['style-src'],
      "'unsafe-inline'",
    ]);
    expect(dev['connect-src']).toEqual([
      ...published['connect-src'],
      'http://localhost:*',
      'http://127.0.0.1:*',
    ]);
    expect({
      ...dev,
      'style-src': published['style-src'],
      'connect-src': published['connect-src'],
    }).toEqual(published);
    expect({ ...DEV_SECURITY_HEADERS, [CSP]: '' }).toEqual({
      ...SECURITY_HEADERS,
      [CSP]: '',
    });
  });

  it('are added for every path to the published _headers rules', () => {
    const rules = readRepoFile('public/_headers');
    const file = headersFile(rules);
    expect(file.startsWith(rules.trimEnd())).toBe(true);
    const block = file.slice(file.lastIndexOf('/*\n'));
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      expect(block).toContain(`\n  ${name}: ${value}\n`);
  });

  it("leave HSTS to the owner of another site's address", () => {
    const rules = readRepoFile('public/_headers');
    const file = headersFile(rules, 'https://routes.example.org/');
    expect(file).not.toContain('Strict-Transport-Security');
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      if (name !== 'Strict-Transport-Security')
        expect(file).toContain(`\n  ${name}: ${value}`);
  });

  it('keep Cloudflare from rewriting every page in the sitemap', () => {
    const rules = readRepoFile('public/_headers').split('\n');
    const paths = [
      ...readRepoFile('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map(([, loc]) => new URL(loc).pathname);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of new Set(paths))
      expect(rules[rules.indexOf(path) + 1], path).toBe(
        '  Cache-Control: public, max-age=0, must-revalidate, no-transform',
      );
  });

  it("are sent with the Worker's own answers", async () => {
    for (const path of ['/api/region', '/missing']) {
      const response = await worker.fetch(
        new Request(`https://nautavo.com${path}`),
      );
      for (const [name, value] of Object.entries(SECURITY_HEADERS))
        expect(response.headers.get(name), `${path} ${name}`).toBe(value);
    }
  });
});
