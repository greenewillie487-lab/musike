/**
 * Appearance modes: "system" (follow the iPhone — the default), "light", "dark".
 *
 * The resolved theme lands on <html data-theme>, which the whole stylesheet keys off.
 * In system mode the web view's own prefers-color-scheme tracks the iPhone's setting
 * natively (the WKWebView is not style-locked), and iOS pushes live changes through
 * the MusikeAppearance bridge (mobile/ios/App/App/MusikeAppearance.swift) — with a
 * matchMedia listener as the web/browser fallback.
 */

export type ThemeMode = "system" | "light" | "dark";

const MODE_KEY = "musike:theme";
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

let mode: ThemeMode = "system";
let listeners = new Set<(dark: boolean) => void>();

/** Applies a resolved theme to the document + the browser/system chrome. */
function applyResolved(dark: boolean): void {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#F2F2F7");
  for (const fn of listeners) fn(dark);
}

/** Reads the persisted mode. Fresh installs and old saved values resolve to "system". */
export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    if (saved === "system") return "system";
  } catch { /* private mode */ }
  return "system";
}

/** Applies a mode now and persists it. "system" re-resolves on every OS change. */
export function applyThemeMode(next: ThemeMode): void {
  mode = next;
  applyResolved(next === "system" ? systemDark() : next === "dark");
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch { /* private mode */ }
  pushToNative();
}

/** The currently selected mode (not the resolved theme). */
export function currentMode(): ThemeMode {
  return mode;
}

/** Register a callback for resolved-theme changes (dark=true). Returns an unsubscribe. */
export function onThemeChange(fn: (dark: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wires the system listener + the native iOS push channel. Call once at startup. */
export function initTheme(): void {
  mode = readThemeMode();
  applyResolved(mode === "system" ? systemDark() : mode === "dark");
  pushToNative();

  // Live system changes: the media query fires on iPhone appearance switches while open.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", (e) => {
    if (mode === "system") applyResolved(e.matches);
  });
  // The native bridge pushes the same truth from Swift (status bar + webview background sync).
  window.__musikeAppearanceChange = (dark: boolean) => {
    if (mode === "system") applyResolved(dark);
  };
}

/** Talks to the MusikeAppearance plugin over the same bridge MusikePlayback uses. */
function pushToNative(): void {
  const native = (window as unknown as { webkit?: { messageHandlers?: { musikeAppearance?: { postMessage: (b: unknown) => void } } } }).webkit;
  native?.messageHandlers?.musikeAppearance?.postMessage({ mode });
}

declare global {
  interface Window {
    /** Set by MusikeAppearance.swift — fires on iPhone appearance changes while open. */
    __musikeAppearanceChange?: (dark: boolean) => void;
  }
}

// One-time wiring at module load: the bootstrap script in index.html already set the
// pre-paint theme; this attaches the live listeners for everything after first paint.
initTheme();
