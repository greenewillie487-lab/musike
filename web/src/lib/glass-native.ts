import { Capacitor, registerPlugin } from "@capacitor/core";
import { create } from "zustand";
import type { Track } from "./types";

/**
 * JS bridge to the native Liquid Glass mini-player (GlassPlayerPlugin.swift).
 *
 * On iOS 26+ the native bar carries Apple's genuine UIGlassEffect; on iOS 15–25 it
 * carries the system chrome blur. When the native bar is enabled, the web MiniPlayer
 * steps aside so there is exactly one mini-player on screen.
 *
 * Native-only: on the web build this module resolves to no-op stubs.
 */

interface GlassPlayerPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
  setTrack(options: { title: string; artist: string; artwork?: string; duration?: number }): Promise<void>;
  setPlaying(options: { playing: boolean; progress: number }): Promise<void>;
}

const plugin = Capacitor.isNativePlatform()
  ? registerPlugin<GlassPlayerPlugin>("GlassPlayer")
  : null;

/** True while the native glass bar is on screen (web mini-player stays hidden). */
export const useNativeGlass = create<{ active: boolean }>(() => ({ active: false }));

let active = false;

function setActive(v: boolean) {
  active = v;
  useNativeGlass.setState({ active: v });
}

export function nativeGlassSupported(): boolean {
  return plugin !== null;
}

export function isNativeGlassActive(): boolean {
  return active;
}

export async function showNativeGlass(track: Track, progress: number, playing: boolean): Promise<void> {
  if (!plugin) return;
  try {
    await plugin.setTrack({
      title: track.title,
      artist: track.artist,
      artwork: track.thumb || undefined,
      duration: track.duration,
    });
    await plugin.setPlaying({ playing, progress });
    await plugin.enable();
    setActive(true);
  } catch {
    setActive(false); // the web mini-player keeps working regardless
  }
}

export async function hideNativeGlass(): Promise<void> {
  if (!plugin || !active) return;
  try {
    await plugin.disable();
  } catch { /* keep going */ }
  setActive(false);
}

export async function syncNativeGlass(track: Track, progress: number, playing: boolean): Promise<void> {
  if (!active || !plugin) return;
  try {
    await plugin.setTrack({ title: track.title, artist: track.artist, artwork: track.thumb || undefined, duration: track.duration });
    await plugin.setPlaying({ playing, progress });
  } catch { /* non-fatal */ }
}
