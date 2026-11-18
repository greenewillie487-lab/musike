import { Capacitor } from "@capacitor/core";

/**
 * Resolving tracks on iOS goes through the app's own network stack (ios/App/App/MusikeYouTube.swift): YouTube
 * bot-checks the web view's requests, and only the native one gets a URL the phone can read to the end.
 */
interface ResolveResult {
  url: string;
  mime: string;
  title: string;
  duration: number;
  error?: string;
  code?: string;
}

interface MessageBridge {
  postMessage(message: unknown): void;
}

const bridge = (
  globalThis as { webkit?: { messageHandlers?: { musikeResolve?: MessageBridge } } }
).webkit?.messageHandlers?.musikeResolve;

export const nativeResolverAvailable = () => !!bridge && Capacitor.getPlatform() === "ios";

const pending = new Map<number, (result: ResolveResult) => void>();
let sequence = 0;

(globalThis as { __musikeResolve?: (req: number, result: ResolveResult) => void }).__musikeResolve = (req, result) => {
  const done = pending.get(req);
  if (!done) return;
  pending.delete(req);
  done(result);
};

/** Asks the iOS side for a stream URL; rejects with the reason YouTube gave. */
export function resolveNatively(videoId: string, lang: string, region: string): Promise<ResolveResult> {
  return new Promise((resolve, reject) => {
    if (!bridge) {
      reject(new Error("musikeResolve bridge is missing"));
      return;
    }
    const req = ++sequence;
    // The native cascade (three YouTube clients) usually answers in seconds or fails fast; a hung
    // one must not hold the queue — the in-app fallback takes over at this ceiling.
    const timer = setTimeout(() => {
      pending.delete(req);
      reject(new Error("YouTube took too long to answer."));
    }, 30_000);
    pending.set(req, (result) => {
      clearTimeout(timer);
      // The web view's media element can't read a file URL (the scheme handler only serves fetch/img), so the
      // downloaded bytes become a blob and the player gets that.
      resolve(result);
    });
    bridge.postMessage({ req, id: videoId, lang, region });
  });
}
