import {
  CaretDownIcon,
  DotsThreeCircleIcon,
  QueueIcon,
  QuotesIcon,
  RadioIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useAmbient } from "../lib/ambient";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { useUi, type PanelTab } from "../stores/ui";
import { Artwork } from "./Artwork";
import { FavoriteButton, Scrubber, Transport, VolumeRow } from "./Controls";
import { IconButton } from "./IconButton";
import { LyricsView } from "./Lyrics";
import { QueueList } from "./Queue";

/** The cover, floating over the ambient wash Apple-style. */
function Stage({ track, className }: { track: Track; className?: string }) {
  const t = useT();
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      <Artwork
        src={track.art}
        fallback={track.thumb}
        alt={t.nowPlaying.coverOf(track.title)}
        iconSize={48}
        className="relative size-full rounded-[12px] shadow-[0_24px_64px_rgb(0_0_0/0.5)]"
      />
    </div>
  );
}

function TrackHeading({ track, large = false }: { track: Track; large?: boolean }) {
  const statusText = useStatusText();
  const status = usePlayer((s) => s.status);
  const openMenu = useUi((s) => s.openMenu);
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <h2 className={cn("truncate tracking-tight", large ? "text-[22px] leading-tight font-bold" : "text-lg font-semibold")}>
          {track.title}
        </h2>
        <p className={cn("truncate", large ? "text-[17px]" : "text-sm", status === "error" ? "text-danger" : "text-fg-2")}>
          {statusText ?? (large ? track.artist : [track.artist, track.album].filter(Boolean).join(" · "))}
        </p>
      </div>
      <FavoriteButton track={track} size={large ? "lg" : "md"} />
      {large && (
        <IconButton
          label={t.trackList.more}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu({ track, x: r.right - 256, y: r.bottom + 6 });
          }}
          className="-mr-1 text-fg"
        >
          <DotsThreeCircleIcon size={24} />
        </IconButton>
      )}
    </div>
  );
}

function PanelBody({ tab }: { tab: PanelTab; slot?: number }) {
  const track = usePlayer(selectCurrent);
  const startRadio = usePlayer((s) => s.startRadio);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const t = useT();

  if (tab === "lyrics") return <LyricsView compact />;
  if (tab === "queue") return <QueueList />;
  if (!track) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>;
  }
  const nextUp = queue[index + 1];
  return (
    <div className="flex flex-col gap-5 px-1 pb-4">
      <Stage track={track} />
      <TrackHeading track={track} />
      <button
        type="button"
        onClick={() => void startRadio(track)}
        className="glass-thin flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors hover:bg-fg/10 active:scale-[0.98]"
      >
        <RadioIcon size={18} /> {t.nowPlaying.startRadio}
      </button>
      {nextUp && (
        <div className="glass-thin rounded-[14px] p-3">
          <p className="pb-2 text-xs font-medium text-fg-3">{t.nowPlaying.upNext}</p>
          <div className="flex items-center gap-3">
            <Artwork src={nextUp.thumb} className="size-10 rounded-[6px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{nextUp.title}</p>
              <p className="truncate text-xs text-fg-2">{nextUp.artist}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelTabs({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const t = useT();
  return (
    <div role="tablist" className="flex gap-1">
      {(
        [
          ["playing", t.nowPlaying.tabPlaying],
          ["lyrics", t.nowPlaying.tabLyrics],
          ["queue", t.nowPlaying.tabQueue],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={cn(
            "h-9 rounded-full px-4 text-sm font-medium transition-colors",
            tab === id ? "bg-fg/15 text-fg" : "text-fg-2 hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Docked right column (≥1280px). */
export function SidePanel() {
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const togglePanel = useUi((s) => s.togglePanel);
  const t = useT();
  return (
    <aside className="island hidden w-[360px] shrink-0 xl:flex" aria-label={t.nowPlaying.panel}>
      <div className="island-core flex w-full flex-col overflow-hidden">
        <div className="flex h-16 items-center justify-between px-3">
          <PanelTabs tab={tab} onTab={openPanel} />
          <IconButton label={t.nowPlaying.closePanel} size="sm" onClick={() => togglePanel(tab)}>
            <XIcon size={18} />
          </IconButton>
        </div>
        <div className="scroll-area flex-1 overflow-y-auto px-2">
          <PanelBody tab={tab} />
        </div>
      </div>
    </aside>
  );
}

/** Same content as an overlay drawer for tablets and small laptops (768-1279px). */
export function PanelDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const close = useUi((s) => s.closePanel);
  const reduce = useReducedMotion();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 hidden md:block xl:hidden">
          <motion.div className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside
            aria-label={t.nowPlaying.panel}
            data-escape-closes
            initial={reduce ? { opacity: 0 } : { x: "105%" }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "105%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="island drawer-top absolute right-2 bottom-2 flex w-[380px] max-w-[calc(100vw-16px)]"
          >
            <div className="island-core flex w-full flex-col overflow-hidden">
              <div className="flex h-16 items-center justify-between px-3">
                <PanelTabs tab={tab} onTab={openPanel} />
                <IconButton label={t.common.close} size="sm" onClick={close}>
                  <XIcon size={18} />
                </IconButton>
              </div>
              <div className="scroll-area flex-1 overflow-y-auto px-2">
                <PanelBody tab={tab} />
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The plain-icon bar under the phone Now Playing content: lyrics · audio/video capsule · queue. */
function SheetBar({ view, onView }: { view: "player" | "lyrics" | "queue"; onView: (v: "player" | "lyrics" | "queue") => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between px-4 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))]">
      <IconButton
        label={view === "lyrics" ? t.nowPlaying.backToPlayer : t.nowPlaying.showLyrics}
        active={view === "lyrics"}
        onClick={() => onView(view === "lyrics" ? "player" : "lyrics")}
        className="glass-thin text-fg"
      >
        <QuotesIcon size={22} weight={view === "lyrics" ? "fill" : "regular"} />
      </IconButton>
      <IconButton
        label={view === "queue" ? t.nowPlaying.backToPlayer : t.nowPlaying.showQueue}
        active={view === "queue"}
        onClick={() => onView(view === "queue" ? "player" : "queue")}
        className="glass-thin -mr-2 text-fg"
      >
        <QueueIcon size={22} weight={view === "queue" ? "fill" : "regular"} />
      </IconButton>
    </div>
  );
}

/** Full-screen Now Playing for phones. Drag down (or Back) to close. */
export function NowPlayingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const track = usePlayer(selectCurrent);
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const [view, setView] = useState<"player" | "lyrics" | "queue">("player");
  const ambient = useAmbient(track?.art ?? track?.thumb);
  const t = useT();

  return createPortal(
    <AnimatePresence onExitComplete={() => setView("player")}>
      {open && track && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t.nowPlaying.title}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.9 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 700) onClose();
          }}
          className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg md:hidden"
        >
          {/* The ambient wash: the cover's own colors, muted like Apple's, crossfading on track change. */}
          <AnimatePresence initial={false}>
            <motion.div
              key={`${track.thumb}:${ambient.a}:${ambient.b}`}
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, ${ambient.a} 0%, ${ambient.b} 55%, color-mix(in srgb, ${ambient.b} 45%, #000) 100%)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          </AnimatePresence>
          <div className="pointer-events-none absolute inset-0 bg-black/20" />
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <img
              src={track.thumb}
              alt=""
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[38%] w-full scale-125 object-cover opacity-15 blur-3xl"
            />
          </div>

          <div className="overlay-top relative flex min-h-0 flex-1 flex-col px-6">
            <div className="flex h-14 touch-none items-center justify-between" onPointerDown={(e) => drag.start(e)}>
              <IconButton label={t.common.close} onClick={onClose} className="-ml-2 text-fg">
                <CaretDownIcon size={24} />
              </IconButton>
              <span className="h-1 w-10 rounded-full bg-fg/25" aria-hidden="true" />
            </div>

            {view === "queue" ? (
              <>
                <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
                  <QueueList />
                </div>
                <SheetBar view={view} onView={setView} />
              </>
            ) : view === "lyrics" ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="min-h-0 flex-1">
                    <LyricsView />
                  </div>
                  <Scrubber touch />
                  <Transport big plain />
                </div>
                <SheetBar view={view} onView={setView} />
              </>
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex touch-none flex-1 items-start justify-center pt-1" onPointerDown={(e) => drag.start(e)}>
                    <Stage track={track} className="max-w-[min(100%,52dvh)]" />
                  </div>
                  <div className="flex flex-col gap-3 pb-1">
                    <TrackHeading track={track} large />
                    <Scrubber touch />
                    <Transport big plain />
                    <VolumeRow />
                  </div>
                </div>
                <SheetBar view={view} onView={setView} />
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
