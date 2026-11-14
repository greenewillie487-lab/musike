import { Link } from "react-router";
import { useRemote } from "../hooks/useRemote";
import { useEffect, useState } from "react";
import { useI18n, useT } from "../i18n";
import { api } from "../lib/api";
import { paths } from "../lib/routes";
import type { Genre, GenrePage } from "../lib/types";
import { Artwork } from "./Artwork";

/** YouTube Music's genre list as chips; each opens the genre's artists and songs. */
export function GenrePanel({ id }: { id: string }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  // Genre names come from YouTube Music in the app language, so each language has its own list.
  const genres = useRemote<Genre[]>(`genres:${lang}`, () => api.genres());
  // Real-time covers: each tile mirrors the first artists of its genre page.
  const [covers, setCovers] = useState<Record<string, string[]>>({});
  const genreData = genres.status === "ok" ? genres.data : null;
  // One shared ticker drives the rotation (Apple's browse tiles cycle their artwork).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!genreData?.length) return;
    let alive = true;
    for (const g of genreData) {
      api
        .genre(g.id)
        .then((page: GenrePage) => {
          const thumbs = page.artists
            .slice(0, 4)
            .map((a) => a.thumb ?? a.art)
            .filter((u): u is string => !!u);
          if (!alive || !thumbs.length) return;
          setCovers((c) => (c[g.id]?.length ? c : { ...c, [g.id]: thumbs }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [genreData]);

  // Deterministic, tasteful color treatments: real genre names from YouTube Music,
  // bold duotone gradients for tiles without artwork (the browse-grid reference style).
  const PALETTES = [
    ["#e11d48", "#f97316"], ["#7c3aed", "#db2777"], ["#0891b2", "#22d3ee"],
    ["#16a34a", "#84cc16"], ["#d97706", "#facc15"], ["#4f46e5", "#818cf8"],
    ["#be185d", "#fb7185"], ["#0d9488", "#2dd4bf"], ["#dc2626", "#7c3aed"],
    ["#ca8a04", "#ea580c"], ["#2563eb", "#38bdf8"], ["#059669", "#10b981"],
  ];
  const paletteFor = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTES[h % PALETTES.length];
  };

  return (
    <div id={id}>
      {genres.status === "loading" && (
        <div aria-label={t.common.loading} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="skeleton aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      )}

      {genres.status === "error" && (
        <p className="px-1 text-sm text-fg-2">
          {genres.message}{" "}
          <button type="button" onClick={genres.retry} className="font-medium text-fg underline-offset-2 hover:underline">
            {t.common.retry}
          </button>
        </p>
      )}

      {genres.status === "ok" && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {genres.data.map((g, gi) => {
            const [c1, c2] = paletteFor(g.name);
            const coversForGenre = covers[g.id];
            const offset = gi * 2; // tiles don't all flip at the same moment
            const cover = coversForGenre?.length ? coversForGenre[(tick + offset) % coversForGenre.length] : null;
            return (
              <li key={g.id}>
                <Link
                  to={paths.genre(g.id)}
                  state={{ name: g.name }}
                  className="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl p-3.5 transition-transform duration-300 ease-out-expo hover:scale-[1.03] active:scale-[0.98]"
                  style={cover ? undefined : { background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                >
                  {cover ? <Artwork src={cover} className="absolute inset-0 size-full transition-opacity duration-700" /> : null}
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.45), transparent 60%)" }}
                  />
                  <span className="relative text-[17px] leading-tight font-bold tracking-tight text-white">{g.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
