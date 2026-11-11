import { CaretRightIcon, ClockCounterClockwiseIcon, DatabaseIcon, HeartIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Cover } from "../components/Cover";
import { NamePlaylistDialog } from "../components/Dialogs";
import { PageHeader } from "../components/Page";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { IconButton } from "../components/IconButton";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";

/** A Library category row: red icon, label, chevron — the Apple Library layout. */
function Row({ to, label, Icon }: { to: string; label: string; Icon: typeof HeartIcon }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-fg/10 md:px-4"
      >
        <Icon size={22} weight="fill" className="shrink-0 text-accent-text" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <CaretRightIcon size={16} className="shrink-0 text-fg-3" aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function Library() {
  const { playlists, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const navigate = useNavigate();
  const t = useT();

  return (
    <div className="pb-8">
      <PageHeader
        title={t.nav.library}
        actions={
          <>
          <IconButton label={t.library.backup} onClick={() => setSettingsOpen(true)}>
            <DatabaseIcon size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-10 items-center gap-1.5 rounded-full bg-accent pr-4 pl-3 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97]"
          >
            <PlusIcon size={18} weight="bold" /> <span className="hidden sm:inline">{t.nav.newPlaylist}</span>
            <span className="sm:hidden">{t.library.newShort}</span>
          </button>
          </>
        }
      />

      <ul className="mx-2 flex flex-col pt-1 md:mx-4">
        <Row to={paths.favorites} label={t.nav.favorites} Icon={HeartIcon} />
        <Row to={paths.history} label={t.nav.recentlyPlayed} Icon={ClockCounterClockwiseIcon} />
      </ul>

      <section className="flex flex-col gap-3 pt-8">
        <h2 className="px-4 text-xl font-bold tracking-tight md:px-6">{t.nav.playlists}</h2>
        {playlists.length > 0 ? (
          <ul className="grid grid-cols-1 gap-1 px-2 md:grid-cols-3 md:gap-2 md:px-4 lg:grid-cols-4 2xl:grid-cols-6">
            {playlists.map((p) => (
              <li key={p.id}>
                <Link
                  to={paths.playlist(p.id)}
                  className="group flex items-center gap-3 rounded-[16px] p-2 transition-colors hover:bg-fg/10 md:flex-col md:items-stretch md:gap-3 md:p-3"
                >
                  <Cover
                    kind="playlist"
                    tracks={p.tracks}
                    iconSize={26}
                    className="size-16 shrink-0 rounded-md md:aspect-square md:size-auto md:w-full md:rounded-lg md:shadow-[0_12px_32px_rgb(0_0_0/0.3)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-sm text-fg-2">{t.library.playlistSub(p.tracks.length)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 text-sm text-fg-2 md:px-6">{t.library.noPlaylists}</p>
        )}
      </section>

      <NamePlaylistDialog
        open={creating}
        title={t.nav.newPlaylist}
        action={t.library.create}
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const p = await createPlaylist(name);
          setCreating(false);
          if (p) navigate(paths.playlist(p.id));
        }}
      />
    </div>
  );
}
