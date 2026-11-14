import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  generateSuggestions,
  optimizeSequence,
  qualifySkip,
  timeDecay,
  type ScoredPick,
  type SuggestionContext,
} from "./recommender";
import type { Track } from "./types";

const mk = (id: string, artist: string, album?: string, title = id): Track => ({
  id,
  title,
  artist,
  album,
  duration: 200,
  thumb: "",
  art: "",
  kind: "song",
});

const ctx = (pool: Track[], seed: Track, overrides: Partial<SuggestionContext> = {}): SuggestionContext => ({
  seed,
  index: 0,
  pool,
  queuedIds: new Set([seed.id]),
  recentIds: new Set([seed.id]),
  affinity: new Map(),
  config: { ...DEFAULT_CONFIG },
  sessionAutoplayCount: 0,
  ...overrides,
});

describe("generateSuggestions (Phase 5/6/7)", () => {
  it("never queues the seed or anything already queued (Phase 2)", () => {
    const seed = mk("seed", "Masicka");
    const pool = [mk("a", "Alkaline"), mk("q", "Masicka"), mk("seed", "Masicka")];
    const picks = generateSuggestions(ctx(pool, seed, { queuedIds: new Set(["seed", "q"]) }));
    const ids = picks.map((p) => p.track.id);
    expect(ids).not.toContain("seed");
    expect(ids).not.toContain("q");
  });

  it("respects max_consecutive_same_artist = 1 (Phase 7)", () => {
    const seed = mk("seed", "Someone Else");
    const pool = [mk("m1", "Masicka"), mk("m2", "Masicka"), mk("m3", "Masicka"), mk("o1", "Alkaline"), mk("o2", "Popcaan")];
    const picks = generateSuggestions(ctx(pool, seed));
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].track.artist).not.toBe(picks[i - 1].track.artist);
    }
  });

  it("enforces the same_artist_cooldown_tracks = 4 (Phase 7)", () => {
    const seed = mk("seed", "Someone Else");
    const pool = [
      mk("m1", "Masicka"), mk("m2", "Masicka"), mk("o1", "Alkaline"), mk("o2", "Popcaan"),
      mk("m3", "Masicka"), mk("o3", "Vybz Kartel"), mk("m4", "Masicka"),
    ];
    const picks = generateSuggestions(ctx(pool, seed));
    const positions = picks.map((p, i) => (p.track.artist === "Masicka" ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < positions.length; k++) {
      expect(positions[k] - positions[k - 1]).toBeGreaterThanOrEqual(4);
    }
  });

  it("excludes tracks played in the recent window (Phase 6 penalty: recently played)", () => {
    const seed = mk("seed", "Masicka");
    const replay = mk("old1", "Alkaline");
    const pool = [replay, mk("fresh", "Popcaan")];
    const picks = generateSuggestions(ctx(pool, seed, { recentIds: new Set(["old1", "seed"]) }));
    const ids = picks.map((p) => p.track.id);
    expect(ids).not.toContain("old1");
    expect(ids).toContain("fresh");
  });

  it("keeps seed-neighborhood continuity: album matches rank first (Phase 5E)", () => {
    const seed = mk("seed", "Masicka", "The Truth");
    const sameAlbum = mk("sa", "Masicka", "The Truth");
    const other = mk("other", "Alkaline", "Other");
    const picks = generateSuggestions(ctx([other, sameAlbum], seed));
    expect(picks[0].track.id).toBe("sa");
    expect(picks[0].reason).toContain("same album");
  });

  it("keeps discovery in the mix (Phase 5F): novel artists appear alongside familiar ones", () => {
    const seed = mk("seed", "Masicka");
    const pool = [mk("n1", "Novel One"), mk("n2", "Novel Two"), mk("f1", "Masicka"), mk("f2", "Alkaline")];
    const picks = generateSuggestions(ctx(pool, seed, {
      affinity: new Map([["masicka", 5], ["alkaline", 4]]),
    }));
    const artists = picks.map((p) => p.track.artist);
    expect(artists).toContain("Novel One");
    expect(artists).toContain("Masicka");
  });
});

describe("optimizeSequence (Phase 7 constraints)", () => {
  const scored = (ids: string[]): ScoredPick[] =>
    ids.map((id, i) => ({
      track: mk(id, "A" + (i % 2)),
      score: 0.9 - i * 0.01,
      components: { personal_preference: 0.5, musical_similarity: 0.5, session_context: 0.5, collaborative_filtering: 0, artist_genre_affinity: 0.5, discovery_value: id.startsWith("n") ? 0.9 : 0.3, freshness: 0.8 },
      reason: "test",
      strategy: "test",
    }));

  it("caps the output queue size", () => {
    const out = optimizeSequence(scored(Array.from({ length: 30 }, (_, i) => "t" + i)));
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it("never leaves two consecutive tracks by the same artist (max_consecutive = 1)", () => {
    const ids = ["a1", "a2", "a3", "b1", "a4", "b2", "a5"];
    const out = optimizeSequence(scored(ids));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].track.artist).not.toBe(out[i - 1].track.artist);
    }
  });
});

describe("listener profile signals (Phase 4/9)", () => {
  it("qualifies skips by completion", () => {
    expect(qualifySkip(0.05)).toBe(-1.5);  // early skip — real rejection
    expect(qualifySkip(0.4)).toBe(-0.5);   // normal skip — mild
    expect(qualifySkip(0.96)).toBe(-0.1);  // 95% skip ≈ a full listen
  });

  it("decays old events with a 14-day half-life", () => {
    const now = Date.now();
    expect(timeDecay(now, now)).toBe(1);
    expect(timeDecay(now - 14 * 86_400_000, now)).toBeCloseTo(0.5);
    expect(timeDecay(now - 28 * 86_400_000, now)).toBeCloseTo(0.25);
  });
});
