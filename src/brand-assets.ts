// Brand files (icons, wordmark, social card) live in src/brand/ and are named
// by the build with a hash of their contents, so a redrawn icon gets a new
// URL that no browser, home-screen icon cache or proxy has kept (docs/BRAND.md).

/** Where the brand files are referenced in the sources (pages and manifest). */
export const BRAND_PATH = '/src/brand/';

/** Brand files no page links to: the build emits them for the manifest and the sharing metadata. */
export const UNLINKED_BRAND_FILES = [
  'icon-192.png',
  'icon-512.png',
  'maskable-512.png',
  'social-card.png',
] as const;

const BRAND_URL = /\/src\/brand\/([\w.-]+)/g;

/** Replaces each `/src/brand/<file>` with its built URL; a file the build did not emit is an error. */
export function hashedBrandUrls(
  text: string,
  built: ReadonlyMap<string, string>,
): string {
  return text.replace(BRAND_URL, (_, file: string) => {
    const url = built.get(file);
    if (!url) throw new Error(`No built file for ${BRAND_PATH}${file}`);
    return url;
  });
}
