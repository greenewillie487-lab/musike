import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { needsAttention, useSystem } from "../stores/system";
import { useUi } from "../stores/ui";
import { AppIconMark } from "./Brand";

/** Sticky page header. On phones it carries the brand mark and the settings entry, since there is no rail. */
export function PageHeader({
  title,
  actions,
  mobileOnly,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  /** Pages with their own large hero title only need the compact bar on phones. */
  mobileOnly?: boolean;
  className?: string;
}) {
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const attention = useSystem((s) => needsAttention(s.info));
  const t = useT();
  return (
    <header
      className={cn(
        "safe-top sticky top-0 z-10 border-b border-line/60 bg-bg/55 backdrop-blur-2xl backdrop-saturate-150 md:border-0 md:bg-surface-1/70",
        // Without a title or actions the header only exists for the phone brand bar.
        ((!title && !actions) || mobileOnly) && "md:hidden",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-3 px-4 md:h-16 md:px-6">
        <AppIconMark className="size-7 shrink-0 md:hidden" />
        {title && <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>}
        {!title && <span className="flex-1" />}
        {actions}
        {/* Profile avatar (browse references): opens Settings — the app has no accounts,
            so the Musike mark stands in for a profile photo. Replaces the gear on phones. */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={attention ? t.nav.settingsUpdate : t.nav.settings}
          className="relative shrink-0"
        >
          <AppIconMark className="size-9 rounded-full ring-2 ring-line transition-transform active:scale-95" />
          {attention && <span className="absolute top-0 right-0 size-2.5 rounded-full bg-accent ring-2 ring-bg" />}
        </button>
      </div>
    </header>
  );
}

export function Section({ title, action, children, className, chevron }: { title: string; action?: ReactNode; children: ReactNode; className?: string; chevron?: boolean }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-4 px-4 md:px-6">
        <h2 className="flex items-center gap-1 text-xl font-bold tracking-tight">
          {title}
          {chevron && <CaretRightIcon size={18} weight="bold" className="text-fg-3" aria-hidden="true" />}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Back in history when there is somewhere to go back to (in the app), else to `fallback`. */
export function BackButton({ fallback, label }: { fallback: string; label?: string }) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate(fallback))}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg"
    >
      <ArrowLeftIcon size={16} /> {label ?? t.common.back}
    </button>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-[18px] bg-surface-3 text-fg-2">{icon}</span>
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="max-w-[40ch] text-sm text-fg-2">{body}</p>
      {action}
    </div>
  );
}
