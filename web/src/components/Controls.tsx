import {
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerXIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { IconButton } from "./IconButton";
import { Slider } from "./Slider";

export function PlayPauseIcon({ size = 22 }: { size?: number }) {
  const status = usePlayer((s) => s.status);
  if (status === "loading") {
    return <span className="block size-[18px] animate-spin rounded-full border-2 border-current border-t-transparent" />;
  }
  return status === "playing" ? <PauseIcon size={size} weight="fill" /> : <PlayIcon size={size} weight="fill" />;
}

export function Transport({ big = false, plain = false }: { big?: boolean; plain?: boolean }) {
  const t = useT();
  const p = usePlayer(
    useShallow((s) => ({
      hasQueue: s.queue.length > 0,
      status: s.status,
      shuffle: s.shuffle,
      repeat: s.repeat,
      toggle: s.toggle,
      prev: s.prev,
      next: s.next,
      toggleShuffle: s.toggleShuffle,
      cycleRepeat: s.cycleRepeat,
    })),
  );
  const hasTrack = p.hasQueue;
  const RepeatGlyph = p.repeat === "one" ? RepeatOnceIcon : RepeatIcon;
  const repeatLabel = { off: t.player.repeatOff, all: t.player.repeatAll, one: t.player.repeatOne }[p.repeat];
  const iconSize = big ? 30 : 19;

  // The phone Now Playing shows only the three big glyphs, Apple-style — shuffle/repeat live in the queue.
  if (plain) {
    return (
      <div className="flex items-center justify-around px-4">
        <IconButton label={t.player.previous} size="lg" onClick={p.prev} disabled={!hasTrack} className="text-fg">
          <SkipBackIcon size={32} weight="fill" />
        </IconButton>
        <button
          type="button"
          onClick={p.toggle}
          aria-label={p.status === "playing" ? t.common.pause : t.common.play}
          disabled={!hasTrack}
          className="grid size-16 shrink-0 place-items-center rounded-full text-fg transition-transform duration-200 ease-out-expo hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <PlayPauseIcon size={38} />
        </button>
        <IconButton label={t.player.next} size="lg" onClick={p.next} disabled={!hasTrack} className="text-fg">
          <SkipForwardIcon size={32} weight="fill" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center", big ? "justify-between" : "gap-2")}>
      <IconButton
        label={p.shuffle ? t.player.shuffleOn : t.player.shuffleOff}
        active={p.shuffle}
        size={big ? "lg" : "sm"}
        onClick={p.toggleShuffle}
        disabled={!hasTrack}
        className={p.shuffle ? "text-fg" : undefined}
      >
        <ShuffleIcon size={big ? 22 : 17} />
        {p.shuffle && <span className="absolute bottom-0.5 size-1 rounded-full bg-fg" />}
      </IconButton>
      <IconButton label={t.player.previous} size={big ? "lg" : "md"} onClick={p.prev} disabled={!hasTrack} className="text-fg">
        <SkipBackIcon size={iconSize} weight="fill" />
      </IconButton>
      {/* Plain glyphs, no container — the Apple transport. */}
      <button
        type="button"
        onClick={p.toggle}
        aria-label={p.status === "playing" ? t.common.pause : t.common.play}
        disabled={!hasTrack}
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-fg",
          "transition-transform duration-200 ease-out-expo hover:scale-105 active:scale-95",
          "disabled:pointer-events-none disabled:opacity-40",
          big ? "size-14" : "size-10",
        )}
      >
        <PlayPauseIcon size={big ? 34 : 24} />
      </button>
      <IconButton label={t.player.next} size={big ? "lg" : "md"} onClick={p.next} disabled={!hasTrack} className="text-fg">
        <SkipForwardIcon size={iconSize} weight="fill" />
      </IconButton>
      <IconButton
        label={repeatLabel}
        active={p.repeat !== "off"}
        size={big ? "lg" : "sm"}
        onClick={p.cycleRepeat}
        disabled={!hasTrack}
        className={p.repeat !== "off" ? "text-fg" : undefined}
      >
        <RepeatGlyph size={big ? 22 : 17} />
        {p.repeat !== "off" && <span className="absolute bottom-0.5 size-1 rounded-full bg-fg" />}
      </IconButton>
    </div>
  );
}

export function Scrubber({ touch = false, className }: { touch?: boolean; className?: string }) {
  const t = useT();
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const buffered = usePlayer((s) => s.buffered);
  const seek = usePlayer((s) => s.seek);
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? position;

  const time = <span className="w-10 shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">{formatTime(shown)}</span>;
  // Apple counts the right side down: -1:00 remaining.
  const total = (
    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-fg-3 tabular-nums">
      {duration > 0 ? `-${formatTime(Math.max(0, duration - shown))}` : formatTime(duration)}
    </span>
  );

  if (touch) {
    return (
      <div className={className}>
        <Slider label={t.player.progress} value={position} max={duration} buffered={buffered} onChange={seek} onScrub={setScrub} showThumb step={5} valueText={formatTime} />
        <div className="mt-0.5 flex justify-between">
          {time}
          {total}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-right">{time}</span>
      <Slider label={t.player.progress} value={position} max={duration} buffered={buffered} onChange={seek} onScrub={setScrub} step={5} valueText={formatTime} className="flex-1" />
      {total}
    </div>
  );
}

export function Volume({ className }: { className?: string }) {
  const t = useT();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const level = muted ? 0 : volume;
  const Glyph = level === 0 ? SpeakerXIcon : level < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <IconButton label={muted ? t.player.unmute : t.player.mute} size="sm" onClick={toggleMute}>
        <Glyph size={18} />
      </IconButton>
      <Slider label={t.player.volume} value={level} max={1} step={0.05} live onChange={setVolume} valueText={(v) => `${Math.round(v * 100)}%`} className="w-24" />
    </div>
  );
}

/** Full-width volume row with speaker glyphs at both ends — the Now Playing sheet layout. */
export function VolumeRow({ className }: { className?: string }) {
  const t = useT();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const level = muted ? 0 : volume;
  const Glyph = level === 0 ? SpeakerXIcon : level < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button type="button" onClick={toggleMute} aria-label={muted ? t.player.unmute : t.player.mute} className="shrink-0 text-fg-3 hover:text-fg-2">
        <Glyph size={16} />
      </button>
      <Slider label={t.player.volume} value={level} max={1} step={0.05} live onChange={setVolume} valueText={(v) => `${Math.round(v * 100)}%`} className="flex-1" />
      <button
        type="button"
        onClick={() => setVolume(1)}
        aria-label={t.player.volMax}
        className="shrink-0 text-fg-3 hover:text-fg-2"
      >
        <SpeakerHighIcon size={16} />
      </button>
    </div>
  );
}

export function FavoriteButton({ track, size = "md" }: { track: Track | null; size?: "sm" | "md" | "lg" }) {
  const isFavorite = useLibrary((s) => !!track && s.favorites.some((t) => t.id === track.id));
  const toggle = useLibrary((s) => s.toggleFavorite);
  const t = useT();
  return (
    <IconButton
      label={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
      active={isFavorite}
      size={size}
      disabled={!track}
      onClick={() => track && void toggle(track)}
    >
      <StarIcon size={size === "lg" ? 24 : 19} weight={isFavorite ? "fill" : "regular"} />
    </IconButton>
  );
}
