// The address the site is published at, for its canonical, sharing and
// sitemap URLs. The pages, sitemap and robots.txt name the default; a build
// with SITE_URL set (vite.config.ts) puts that address in their place, so a
// copy published elsewhere names itself, not nautavo.com.

export const DEFAULT_SITE_URL = 'https://nautavo.com/';

/**
 * The site address for a build: the default when `value` is unset, otherwise
 * an absolute http(s) URL at the root of its host (the app is built for the
 * `/` base), with the trailing slash added.
 */
export function siteUrl(value?: string): string {
  if (!value) return DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SITE_URL must be an absolute URL, not "${value}".`);
  }
  if (!/^https?:$/.test(url.protocol))
    throw new Error(`SITE_URL must use http or https, not "${value}".`);
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(
      `SITE_URL must be the root of a host, like https://example.org/, not "${value}": the site is built for the / base.`,
    );
  return url.href;
}

/** Puts `site` in place of every default site URL in `text`. */
export function withSite(text: string, site: string): string {
  return text.replaceAll(DEFAULT_SITE_URL, site);
}
