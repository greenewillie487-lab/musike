import { CaretDownIcon, CaretUpIcon, InfinityIcon, QueueIcon, RepeatIcon, RepeatOnceIcon, ShuffleIcon, XIcon } from "@phosphor-icons/react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { usePlayer } from "../player/player";
import { Artwork } from "./Artwork";
import { IconButton } from "./IconButton";
import { Equalizer } from "./Brand";

export function QueueList({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const suggestedFrom = usePlayer((s) => s.suggestedFrom);
  const queueReasons = usePlayer((s) => s.queueReasons);
  const reorderQueue = usePlayer((s) => s.reorderQueue);
  const live = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const autoRadio = usePlayer((s) => s.autoRadio);
  const setAutoRadio = usePlayer((s) => s.setAutoRadio);
  const shuffle = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const repeat = usePlayer((s) => s.repeat);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const RepeatGlyph = repeat === "one" ? RepeatOnceIcon : RepeatIcon;

  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  // Autoplay suggestions (the ∞ brain) split off into their own marked section.
  const boundary = suggestedFrom !== null && suggestedFrom > index + 1 ? suggestedFrom - index - 1 : suggestedFrom !== null ? 0 : upcoming.length;
  const upNext = upcoming.slice(0, boundary);
  const suggested = suggestedFrom !== null ? upcoming.slice(boundary) : [];

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="glass-thin grid size-14 place-items-center rounded-[14px] text-fg-3">
          <QueueIcon size={26} />
        </span>
        <p className="font-medium">{t.queue.emptyTitle}</p>
        <p className="max-w-[28ch] text-sm text-fg-2">{t.queue.emptyBody}</p>
      </div>
    );
  }

  const row = (i: number, isCurrent: boolean) => {
    const track = queue[i];
    return (
      <li key={`${track.id}-${i}`} className="group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-fg/10">
        <button type="button" onClick={() => jumpTo(i)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(track.title)} />
        <Artwork src={track.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isCurrent ? "text-accent-text" : "text-fg")}>{track.title}</p>
          <p className="truncate text-xs text-fg-2">{track.artist}</p>
        </div>
        {isCurrent ? (
          <Equalizer live={live} className="mr-2" />
        ) : (
          <>
            <span className="pointer-events-none font-mono text-xs text-fg-3 tabular-nums group-hover:hidden">
              {track.duration ? formatTime(track.duration) : ""}
            </span>
            <span className="relative z-10 hidden items-center group-hover:flex max-md:flex">
              <button
                type="button"
                onClick={() => reorderQueue(i, i - 1)}
                aria-label={t.queue.moveUp}
                title={t.queue.moveUp}
                disabled={i - 1 <= index}
                className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-fg/15 hover:text-fg disabled:opacity-30"
              >
                <CaretUpIcon size={13} />
              </button>
              <button
                type="button"
                onClick={() => reorderQueue(i, i + 1)}
                aria-label={t.queue.moveDown}
                title={t.queue.moveDown}
                disabled={i + 1 >= queue.length}
                className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-fg/15 hover:text-fg disabled:opacity-30"
              >
                <CaretDownIcon size={13} />
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={t.queue.removeX(track.title)}
                title={t.queue.remove}
                className="grid size-7 place-items-center rounded-full text-fg-2 hover:bg-fg/15 hover:text-fg"
              >
                <XIcon size={15} />
              </button>
            </span>
          </>
        )}
        {!isCurrent && queueReasons[i] && (
          <span className="pointer-events-none absolute right-2 bottom-0.5 hidden truncate text-[10px] text-fg-3 md:block">{queueReasons[i]}</span>
        )}
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", compact ? "" : "pb-4")}>
      <section>
        <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">{t.queue.nowPlaying}</h3>
        <ul>{row(index, true)}</ul>
      </section>

      <section>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-xs font-medium text-fg-3">
            {t.queue.upNext} <span className="font-mono">{upNext.length}</span>
          </h3>
          <div className="flex items-center gap-0.5">
            <IconButton
              label={shuffle ? t.player.shuffleOn : t.player.shuffleOff}
              active={shuffle}
              size="sm"
              onClick={toggleShuffle}
              className={shuffle ? "text-fg" : undefined}
            >
              <ShuffleIcon size={18} />
            </IconButton>
            <IconButton
              label={repeat === "one" ? t.player.repeatOne : repeat === "all" ? t.player.repeatAll : t.player.repeatOff}
              active={repeat !== "off"}
              size="sm"
              onClick={cycleRepeat}
              className={repeat !== "off" ? "text-fg" : undefined}
            >
              <RepeatGlyph size={18} />
            </IconButton>
            {upcoming.length > 0 && (
              <button type="button" onClick={clearUpcoming} className="ml-1 text-xs font-medium text-fg-2 hover:text-fg">
                {t.queue.clear}
              </button>
            )}
          </div>
        </div>
        {upNext.length ? <ul>{upNext.map((_, k) => row(index + 1 + k, false))}</ul> : null}
        {suggested.length > 0 && (
          <div className="pt-3">
            <h3 className="flex items-center gap-1.5 px-2 pb-1.5 text-xs font-medium text-fg-3">
              <InfinityIcon size={14} /> {t.queue.suggested}
            </h3>
            <ul>{suggested.map((_, k) => row((suggestedFrom ?? index + 1) + k, false))}</ul>
          </div>
        )}
        {!upNext.length && !suggested.length && (
          <p className="px-2 text-sm text-fg-2">
            {t.queue.nothingQueued} {autoRadio ? t.queue.radioContinues : ""}
          </p>
        )}
      </section>

      <label className="glass-thin mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">{t.queue.autoRadio}</span>
          <span className="block text-xs text-fg-2">{t.queue.autoRadioBody}</span>
        </span>
        <input
          type="checkbox"
          checked={autoRadio}
          onChange={(e) => setAutoRadio(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            autoRadio ? "bg-accent" : "bg-fg/20",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              autoRadio ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </div>
  );
}
