export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private interval = 1200) {}
  run<T>(
    fn: () => Promise<T>,
    isCurrent: () => boolean = () => true,
  ): Promise<T> {
    const task = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
        await pause(Math.max(0, this.interval - (Date.now() - this.last)));
        if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
        this.last = Date.now();
        return fn();
      });
    this.tail = task;
    return task;
  }
}
/**
 * Every external request omits credentials and has a deadline. Routing and
 * Nominatim receive the page origin as referrer, which the Nominatim usage
 * policy asks applications to provide; other providers receive no referrer.
 */
export function request(
  url: string | URL,
  timeoutMs: number,
  options: {
    signal?: AbortSignal;
    sendOrigin?: boolean;
    noStore?: boolean;
    /** A JSON body sent with POST (as text/plain, so no preflight is needed). */
    body?: string;
  } = {},
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    credentials: 'omit',
    ...(options.body !== undefined
      ? {
          method: 'POST',
          body: options.body,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        }
      : {}),
    referrerPolicy: options.sendOrigin
      ? 'strict-origin-when-cross-origin'
      : 'no-referrer',
    ...(options.noStore ? { cache: 'no-store' as const } : {}),
    signal: options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
  });
}
/** A server answer that was not a success, said in plain words (#210). */
export class ServerError extends Error {
  constructor(readonly status: number) {
    super('The server did not answer correctly.');
    this.name = 'ServerError';
  }
}
export async function json(url: string): Promise<unknown> {
  const r = await request(url, 30000, { sendOrigin: true });
  if (!r.ok) throw new ServerError(r.status);
  return r.json();
}
