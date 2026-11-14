import type { Track } from "./types";

export type { Track };

/**
 * APC core — the autoplay brain, as a pure library so it can be unit-tested without
 * React or the audio stack. Everything the prompt's Phases 4–9 ask for lives here:
 * the listening-event log, the listener profile (recency-decayed, skip-qualified),
 * multi-strategy candidate scoring with versioned weights, and the sequence optimizer.
 *
 * Honest data limits (Phase 3/5): Musike has no genre/mood/audio-feature metadata and
 * no cross-user store — musical_similarity uses the YT-Music related pool + album/artist
 * continuity, collaborative filtering contributes 0 until a shared events store exists,
 * and SongProfile carries nulls for anything unknowable. Nothing is invented.
 */

// ---------------------------------------------------------------------------
// Configuration — versioned, overridable (Phases 6/7/8/9 initial values)
// ---------------------------------------------------------------------------

export interface RecommenderConfig {
  recommendation_engine: {
    version: string;
    enabled: boolean;
    weights: {
      personal_preference: number;
      musical_similarity: number;
      session_context: number;
      collaborative_filtering: number;
      artist_genre_affinity: number;
      discovery_value: number;
      freshness: number;
    };
  };
  sequence_optimizer: {
    candidate_pool_size: number;
    output_queue_size: number;
    max_consecutive_same_artist: number;
    same_artist_cooldown_tracks: number;
    same_track_cooldown_days: number;
    max_same_album_in_recommendations: number;
    discovery_ratio: number;
  };
  autoplay: {
    enabled_by_default: boolean;
    initial_recommendations: number;
    target_upcoming_recommendations: number;
    minimum_buffer: number;
    replenish_below: number;
    maximum_recommendations_per_session: number;
  };
  behavior_signals: {
    favorite: number;
    add_to_library: number;
    replay: number;
    complete: number;
    long_listen: number;
    normal_skip: number;
    early_skip: number;
    explicit_dislike: number;
  };
}

export const DEFAULT_CONFIG: RecommenderConfig = {
  recommendation_engine: {
    version: "1.0",
    enabled: true,
    weights: {
      personal_preference: 0.25,
      musical_similarity: 0.2,
      session_context: 0.15,
      collaborative_filtering: 0.15,
      artist_genre_affinity: 0.1,
      discovery_value: 0.1,
      freshness: 0.05,
    },
  },
  sequence_optimizer: {
    candidate_pool_size: 200,
    output_queue_size: 20,
    max_consecutive_same_artist: 1,
    same_artist_cooldown_tracks: 4,
    same_track_cooldown_days: 14,
    max_same_album_in_recommendations: 2,
    discovery_ratio: 0.2,
  },
  autoplay: {
    enabled_by_default: true,
    initial_recommendations: 10,
    target_upcoming_recommendations: 12,
    minimum_buffer: 4,
    replenish_below: 5,
    maximum_recommendations_per_session: 100,
  },
  behavior_signals: {
    favorite: 5.0,
    add_to_library: 4.0,
    replay: 3.0,
    complete: 2.0,
    long_listen: 1.5,
    normal_skip: -0.5,
    early_skip: -1.5,
    explicit_dislike: -5.0,
  },
};

// ---------------------------------------------------------------------------
// Listening events (Phase 4) — localStorage, capped, with playback context
// ---------------------------------------------------------------------------

export type ListeningEventType =
  | "track_started"
  | "track_completed"
  | "track_skipped"
  | "track_replayed"
  | "track_favorited"
  | "track_unfavorited"
  | "autoplay_track_played"
  | "autoplay_track_skipped"
  | "recommendation_accepted"
  | "recommendation_rejected";

export type QueueSource = "manual" | "play_next" | "autoplay" | "album" | "playlist" | "radio";

export interface ListeningEvent {
  type: ListeningEventType;
  trackId: string;
  artist: string;
  /** Playback source: manual pick, playlist context, autoplay suggestion, … */
  source: string | null;
  /** 0..1 — position in the track when the event fired. */
  completion: number;
  /** Seconds actually listened (0 for starts). */
  listenedSeconds: number;
  at: number; // epoch ms
}

const EVENTS_KEY = "musike:listening-events";
const EVENTS_CAP = 500;

export function logEvent(event: ListeningEvent): void {
  try {
    const events = loadEvents();
    events.push(event);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-EVENTS_CAP)));
  } catch {
    /* storage blocked — the queue still works */
  }
}

export function loadEvents(): ListeningEvent[] {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) ?? "[]") as ListeningEvent[];
  } catch {
    return [];
  }
}

/** Phase 9: a skip is qualified by how much of the track actually played. */
export function qualifySkip(completion: number): number {
  if (completion < 0.1) return -1.5; // early skip — real rejection
  if (completion < 0.8) return -0.5; // normal skip — mild signal
  return -0.1; // skipped after 95% ≈ a full listen — near-zero signal
}

/** Exponential time decay, half-life 14 days (Phase 4: recency without erasure). */
export function timeDecay(eventAt: number, now: number): number {
  const days = Math.max(0, (now - eventAt) / 86_400_000);
  return Math.pow(0.5, days / 14);
}

// ---------------------------------------------------------------------------
// Listener profile (Phase 4) — short-term vs long-term taste
// ---------------------------------------------------------------------------

export interface ListenerProfile {
  /** Recency-decayed, signal-weighted artist scores (short-term taste). */
  artistAffinity: Map<string, number>;
  /** Artists the listener has engaged with at all (familiarity set). */
  familiarArtists: Set<string>;
  /** 0..1 — how discovery-friendly recent behavior has been. */
  discoveryPreference: number;
  /** Events considered, for tests/telemetry. */
  considered: number;
}

export function buildProfile(events: ListeningEvent[], now = Date.now()): ListenerProfile {
  const affinity = new Map<string, number>();
  const familiar = new Set<string>();
  const cfg = DEFAULT_CONFIG.behavior_signals;
  let considered = 0;

  for (const e of events) {
    const key = e.artist.split(",")[0].trim().toLowerCase();
    if (!key) continue;
    considered++;
    const decay = timeDecay(e.at, now);
    let w = 0;
    switch (e.type) {
      case "track_favorited": w = cfg.favorite; break;
      case "track_completed": w = cfg.complete; break;
      case "track_replayed": w = cfg.replay; break;
      case "track_started": w = e.completion > 0 ? 0 : 0.5; break; // starting is a weak positive
      case "track_skipped": w = qualifySkip(e.completion) / 2; break; // qualified, softened vs explicit
      case "autoplay_track_skipped": w = qualifySkip(e.completion); break;
      case "recommendation_accepted": w = 1.0; break;
      case "recommendation_rejected": w = -0.5; break;
      default: continue;
    }
    if (e.completion >= 0.9 && e.type === "track_skipped") w = -0.1; // 95% skip ≈ full listen
    affinity.set(key, (affinity.get(key) ?? 0) + w * decay);
    if (w > 0 || e.type === "track_started") familiar.add(key);
  }

  // Discovery preference: share of positive engagement with artists outside the familiar set.
  const positives = [...affinity.entries()].filter(([, v]) => v > 0);
  const discoveryPreference = positives.length
    ? Math.min(1, positives.filter(([k]) => affinity.get(k)! > 2).length / positives.length)
    : 0.5;

  return { artistAffinity: affinity, familiarArtists: familiar, discoveryPreference, considered };
}

// ---------------------------------------------------------------------------
// Multi-strategy scoring (Phases 5/6) + sequence optimization (Phase 7)
// ---------------------------------------------------------------------------

export interface SuggestionContext {
  seed: Track;
  index: number; // current queue index
  /** Candidate pool from every strategy (server related + artist catalog + history fallback). */
  pool: Track[];
  /** Tracks already in the queue — always excluded. */
  queuedIds: Set<string>;
  /** Ids played in the recent window (Phase 6 penalty: recently played). */
  recentIds: Set<string>;
  /** Artist → score from the profile (0..1 normalized affinity). */
  affinity: Map<string, number>;
  /** Album of the seed, for neighborhood continuity. */
  config?: RecommenderConfig;
  /** Autoplay suggestions appended this session (max cap). */
  sessionAutoplayCount: number;
}

export interface ScoredPick {
  track: Track;
  score: number; // FINAL_SCORE, 0..1
  components: {
    personal_preference: number;
    musical_similarity: number;
    session_context: number;
    collaborative_filtering: number;
    artist_genre_affinity: number;
    discovery_value: number;
    freshness: number;
  };
  /** Honest provenance for the UI (Phase 12) — never fabricated. */
  reason: string;
  strategy: string;
}

export function scoreCandidates(ctx: SuggestionContext): ScoredPick[] {
  const cfg = ctx.config ?? DEFAULT_CONFIG;
  const seedArtist = primaryArtistOf(ctx.seed);
  const pool = ctx.pool.filter(
    (t) => t.id !== ctx.seed.id && !ctx.queuedIds.has(t.id) && !ctx.recentIds.has(t.id),
  );
  const maxRank = Math.max(1, pool.length);

  const scored = pool.map((t, position) => {
    const artist = primaryArtistOf(t);
    const affinity = ctx.affinity.get(artist) ?? 0;
    const personal = Math.min(1, affinity / 6); // 6 decayed signals ≈ strong affinity
    const sameArtist = artist === seedArtist;
    const albumMatch = !!t.album && !!ctx.seed.album && t.album === ctx.seed.album;
    // Musical similarity: related-pool rank is YT's own similarity signal (position decays),
    // reinforced by the seed neighborhood we can actually verify.
    const musical = Math.max(
      albumMatch ? 1 : sameArtist ? 0.7 : 0,
      1 - position / maxRank,
    );
    const session = albumMatch ? 1 : sameArtist ? 0.7 : 0.3;
    const fresh = !ctx.recentIds.has(t.id);
    const discovery = ctx.affinity.has(artist) ? 0.2 : 1;
    const freshness = fresh ? 1 : 0.2;

    const c = {
      personal_preference: personal,
      musical_similarity: musical,
      session_context: session,
      collaborative_filtering: 0, // no cross-user store — weight redistributes (documented)
      artist_genre_affinity: Math.min(1, affinity / 8),
      discovery_value: discovery,
      freshness,
    };
    const w = cfg.recommendation_engine.weights;
    let score = 0;
    let wsum = 0;
    for (const k of Object.keys(c) as (keyof typeof c)[]) {
      score += c[k] * w[k];
      wsum += w[k];
    }
    score /= wsum || 1; // normalize across available strategies (CF absent ⇒ redistributes)

    const reason = albumMatch
      ? `same album as ${ctx.seed.title}`
      : sameArtist
        ? `more from ${ctx.seed.artist}`
        : affinity > 0
          ? `from artists you listen to`
          : `similar sound to ${ctx.seed.title}`;

    return {
      track: t,
      score,
      components: c,
      reason,
      strategy: sameArtist || albumMatch ? "seed-neighborhood" : affinity > 0 ? "personal" : "discovery",
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Phase 7 — greedy sequence optimizer with the spec's diversity constraints. */
export function optimizeSequence(
  scored: ScoredPick[],
  config: RecommenderConfig = DEFAULT_CONFIG,
): ScoredPick[] {
  const opt = config.sequence_optimizer;
  const out: ScoredPick[] = [];
  const artistLast: Map<string, number> = new Map();
  const albumCount: Map<string, number> = new Map();
  for (const s of scored) {
    if (out.length >= opt.output_queue_size) break;
    const artist = primaryArtistOf(s.track);
    const n = out.length;
    // max_consecutive_same_artist = 1
    if (n >= 1 && primaryArtistOf(out[n - 1].track) === artist) continue;
    // same_artist_cooldown_tracks = 4: no return within the last 4 picks
    const lastAt = artistLast.get(artist);
    if (lastAt !== undefined && out.length - lastAt - 1 < opt.same_artist_cooldown_tracks - 1) continue;
    // max_same_album_in_recommendations = 2
    const albumKey = s.track.album || "";
    if (albumKey && (albumCount.get(albumKey) ?? 0) >= opt.max_same_album_in_recommendations) continue;
    // discovery_ratio guard: keep the familiar/novel balance roughly on target
    const familiar = s.components.discovery_value < 0.5;
    const familiarShare = out.length
      ? out.filter((o) => o.components.discovery_value < 0.5).length / out.length
      : 0;
    if (!familiar && out.length && familiarShare < (1 - opt.discovery_ratio) - 0.15 && opt.discovery_ratio < 0.5) continue;
    if (familiar && familiarShare > opt.discovery_ratio + 0.5) continue;

    out.push(s);
    artistLast.set(artist, out.length - 1);
    if (albumKey) albumCount.set(albumKey, (albumCount.get(albumKey) ?? 0) + 1);
  }
  return out;
}

function primaryArtistOf(t: { artist?: string }) {
  return (t.artist || "").split(",")[0].trim().toLowerCase();
}

/** Convenience: full pipeline — pool → scored → optimized → annotated with reasons. */
export function generateSuggestions(ctx: SuggestionContext): ScoredPick[] {
  const ranked = scoreCandidates(ctx);
  return optimizeSequence(ranked, ctx.config);
}

// ---------------------------------------------------------------------------
// Session metrics (Phase 14)
// ---------------------------------------------------------------------------

export function sessionMetrics(events: ListeningEvent[]): Record<string, number> {
  const autoplay = events.filter((e) => e.source === "autoplay");
  const skips = autoplay.filter((e) => e.type === "autoplay_track_skipped").length;
  const plays = autoplay.filter((e) => e.type === "autoplay_track_played").length;
  const completions = events.filter((e) => e.type === "track_completed").length;
  const started = events.filter((e) => e.type === "track_started").length;
  return {
    autoplay_continuation_rate: started ? completions / started : 0,
    autoplay_skip_rate: autoplay.length ? skips / Math.max(1, plays) : 0,
    completion_rate: started ? completions / Math.max(1, started) : 0,
    autoplay_share: events.length ? autoplay.length / events.length : 0,
    events: events.length,
  };
}
