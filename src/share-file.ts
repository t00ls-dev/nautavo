/**
 * Exporting a file: through the system share sheet, as a named File, or as a
 * download. Touch devices that can share files share first, since some of
 * their browsers (Firefox for iOS) drop a download's name and save a blob
 * under its UUID with no extension; the share sheet keeps the name and offers
 * Save to Files. Elsewhere the download, whose name is kept, stays first.
 */

/** MIME types to offer for a GPX file, most specific first. */
export const GPX_TYPES = [
  'application/gpx+xml',
  'application/xml',
  'text/xml',
  'application/octet-stream',
  'text/plain',
];
/** The type of a downloaded GPX file. */
export const GPX_DOWNLOAD = 'application/gpx+xml;charset=utf-8';
/** MIME types to offer for a TCX course, most specific first. */
export const TCX_TYPES = [
  'application/vnd.garmin.tcx+xml',
  'application/xml',
  'text/xml',
  'application/octet-stream',
  'text/plain',
];
/** The type of a downloaded TCX course. */
export const TCX_DOWNLOAD = 'application/vnd.garmin.tcx+xml;charset=utf-8';
/** MIME types to offer for a FIT course, most specific first. */
export const FIT_TYPES = [
  'application/vnd.ant.fit',
  'application/octet-stream',
];
/** The type of a downloaded FIT course. */
export const FIT_DOWNLOAD = 'application/vnd.ant.fit';
/** A text file, or the bytes of a binary one (FIT). */
type Content = string | Uint8Array<ArrayBuffer>;
/** MIME types to offer for a JSON backup, most specific first. */
export const JSON_TYPES = [
  'application/json',
  'text/plain',
  'application/octet-stream',
];

/** The content as a File of the first type the browser can share, or null. */
export function shareFile(
  content: Content,
  name: string,
  canShare: (data: ShareData) => boolean,
  types: readonly string[] = GPX_TYPES,
): File | null {
  for (const type of types) {
    const file = new File([content], name, { type });
    try {
      if (canShare({ files: [file] })) return file;
    } catch {
      /* Try the next supported MIME type. */
    }
  }
  return null;
}

/** Whether this browser can share a GPX file through the share sheet. */
export function canShareFiles(): boolean {
  if (!navigator.canShare || !navigator.share) return false;
  return !!shareFile('<gpx/>', 'route.gpx', (data) => navigator.canShare(data));
}

/** Whether exports share first: file sharing on a touch-first device. */
export function sharesFirst(): boolean {
  return matchMedia('(pointer: coarse)').matches && canShareFiles();
}

function downloadFile(content: Content, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ExportResult = 'shared' | 'cancelled' | 'downloaded';

/**
 * Share the content as a named file when `share` is set and the browser can,
 * otherwise download it. A cancelled share sheet does nothing; any other
 * share failure falls back to the download.
 */
export async function exportFile(
  content: Content,
  name: string,
  options: {
    share: boolean;
    types: readonly string[];
    downloadType: string;
  },
): Promise<ExportResult> {
  const file =
    options.share && canShareFiles()
      ? shareFile(
          content,
          name,
          (data) => navigator.canShare(data),
          options.types,
        )
      : null;
  if (file) {
    try {
      // Only the file: iOS saves a title or text as a second, text file.
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if ((error as Error | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadFile(content, name, options.downloadType);
  return 'downloaded';
}
