// Security headers of every response: the static files through _headers
// (vite.config.ts), the Worker's own answers (src/worker.ts) and the local
// servers, so the browser tests run under the same policy.

/** What the app loads, by kind; every service URL is configurable, so any
 * https host (and http on the local machine, as `src/core.ts` allows on an
 * https page) may be a server. */
const CSP: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  // Map images; maplibre-contour draws contour tiles from blob: images.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  // MapLibre's worker is a same-origin file; maplibre-contour's is a blob:.
  'worker-src': ["'self'", 'blob:'],
  // `src/core.ts` also accepts http://[::1], but browsers reject IPv6
  // sources in a policy: on the https site a local server is reached as
  // localhost or 127.0.0.1.
  'connect-src': [
    "'self'",
    'https:',
    'http://localhost:*',
    'http://127.0.0.1:*',
  ],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
};

const policy = (directives: Record<string, string[]>) =>
  Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');

const headers = (csp: string): Record<string, string> => ({
  'Content-Security-Policy': csp,
  // Two years, subdomains included (all of them are https); no preload.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // The browser default, stated: the services' terms rely on the Referer.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

export const SECURITY_HEADERS = headers(policy(CSP));

/** The development server injects each stylesheet as a <style> element. */
export const DEV_SECURITY_HEADERS = headers(
  policy({ ...CSP, 'style-src': [...CSP['style-src']!, "'unsafe-inline'"] }),
);

/** public/_headers with every security header added for all paths. */
export function headersFile(rules: string): string {
  const lines = Object.entries(SECURITY_HEADERS).map(
    ([name, value]) => `  ${name}: ${value}`,
  );
  return `${rules.trimEnd()}\n\n# Security headers (src/security-headers.ts).\n/*\n${lines.join('\n')}\n`;
}
