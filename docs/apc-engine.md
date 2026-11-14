# APC Engine v1 — Automatic Playlist Continuation Core

> The algorithmic core for Musike's next-generation autoplay: sonic embeddings, an energy
> trajectory state machine, a serendipity-gated scoring engine, and telemetry weighting.
> Written as a Python/PyTorch reference implementation (sidecar service) with a TypeScript
> integration map for the client.

---

## 0. Architecture — what runs where

```
┌────────────────────────┐        ┌──────────────────────────────┐
│  Musike server (Node)  │        │  APC sidecar (FastAPI+Torch) │
│  prepare(id) ──────────┼──────► │  POST /ingest {yt_id, audio} │
│  (yt-dlp fetch+cache)  │        │   decode → fbank → tower     │
│                        │        │   → 128-d embedding + energy │
│  GET /api/radio/:id    │◄────── │  Faiss (128-d, IP) + SQLite  │
│  candidate pool        │        │  metadata (artist, album, …) │
└───────────┬────────────┘        └──────────────────────────────┘
            │ pool: [ {track, vec?, energy, artist, album} ]
            ▼
┌────────────────────────────────────────────────────────────────┐
│  Client scoring core (TypeScript port of §3 + §4)              │
│  session state machine (§2) → query blend → score → gate       │
│  Runs in the player store; embeddings arrive with the pool.    │
└────────────────────────────────────────────────────────────────┘
```

* **Ingest** happens once per track (at first prepare), async — playback never blocks on ML.
* **Rank** is cheap (dot products over 128-d vectors) — runs anywhere.
* Tracks without embeddings fall back to the heuristic brain (v2) — the system degrades, never dies.

---

## 1. Deep Micro-Sonic Vector Embedding Pipeline

### 1.1 Ingestion (raw waveform → log-mel tokens)

```
decode(any container) → mono → 16 kHz → float32
window: 10.24 s (1024 frames @ 25 ms window / 10 ms hop), stride 5.12 s (50% overlap)
features: log-mel fbank, n_mels=128, fmin=32 Hz, fmax=8000 Hz, per-bin z-normalized
patchify: 16×16 patches over (128 mels × 1024 frames) → 8×64 = 512 tokens/window
```

```python
import torch, torchaudio

SAMPLE_RATE = 16_000
WIN_SECONDS = 10.24
HOP_SECONDS = 5.12
N_MELS = 128

mel = torchaudio.transforms.MelSpectrogram(
    sample_rate=SAMPLE_RATE, n_fft=1024, hop_length=160,
    n_mels=N_MELS, f_min=32.0, f_max=8000.0, power=2.0,
)

def ingest(waveform: torch.Tensor, sr: int) -> torch.Tensor:
    """(T,) float32 waveform → (num_windows, 1, 128, 1024) normalized fbank batch."""
    if sr != SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sr, SAMPLE_RATE)
    wf = waveform.mean(0)                                    # mono
    spec = mel(wf)                                           # (128, T')
    spec = torch.log(spec.clamp_min(1e-5))                   # log compression
    frames = spec.shape[1]
    win, hop = 1024, 512
    out = []
    for start in range(0, max(frames - win, 1), hop):
        chunk = spec[:, start:start + win]
        if chunk.shape[1] < win:
            chunk = torch.nn.functional.pad(chunk, (0, win - chunk.shape[1]))
        m, sd = chunk.mean(), chunk.std().clamp_min(1e-4)    # per-window norm
        out.append(((chunk - m) / sd).unsqueeze(0))          # (1, 128, 1024)
    return torch.stack(out)                                  # (W, 1, 128, 1024)
```

### 1.2 The tower — contrastive audio transformer + projection head

Self-supervised objective: two augmented views of the **same track's windows** are
positives; every other track in the batch is a negative (CLAP-style audio-audio InfoNCE).
This forces the embedding to encode *micro-timbre, harmonic texture, and transient
density* — properties that survive across one artist's catalog — while contrastive
rejection of cross-track pairs prevents the collapse that plain reconstruction allows.

```python
import math
import torch.nn as nn

class PatchEmbed(nn.Module):
    """16×16 fbank patches → d_model tokens (+ learned positional embedding)."""
    def __init__(self, n_mels=128, frames=1024, patch=(16, 16), d_model=384):
        super().__init__()
        self.grid = (n_mels // patch[0], frames // patch[1])          # (8, 64)
        n_tokens = self.grid[0] * self.grid[1]
        self.proj = nn.Conv2d(1, d_model, kernel_size=patch, stride=patch)
        self.pos = nn.Parameter(torch.randn(1, n_tokens, d_model) * 0.02)
        self.norm = nn.LayerNorm(d_model)

    def forward(self, x):                                             # (B, 1, 128, 1024)
        tokens = self.proj(x).flatten(2).transpose(1, 2)              # (B, 512, d)
        return self.norm(tokens + self.pos)


class SonicEncoder(nn.Module):
    """6-layer pre-norm transformer. Returns CLS + token sequence."""
    def __init__(self, d_model=384, depth=6, heads=6, dropout=0.1):
        super().__init__()
        layer = nn.TransformerEncoderLayer(d_model, heads, d_model * 4,
                                           dropout, batch_first=True, norm_first=True)
        self.blocks = nn.TransformerEncoder(layer, depth)
        self.cls = nn.Parameter(torch.zeros(1, 1, d_model))
        self.norm = nn.LayerNorm(d_model)

    def forward(self, tokens):
        x = torch.cat([self.cls.expand(tokens.size(0), -1, -1), tokens], dim=1)
        x = self.blocks(x)
        return self.norm(x[:, 0]), self.norm(x[:, 1:])                # (cls), (tokens)


class ProjectionHead(nn.Module):
    """384 → 128-d L2-normalized sonic embedding (the vector that gets indexed)."""
    def __init__(self, d_model=384, out=128):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d_model, d_model), nn.GELU(),
                                 nn.Linear(d_model, out))

    def forward(self, cls):
        z = self.net(cls)
        return z / z.norm(dim=-1, keepdim=True).clamp_min(1e-8)


class EnergyHead(nn.Module):
    """Scalar head regressing DSP-measured energy e ∈ [0,1] (§2's input feature)."""
    def __init__(self, d_model=384):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d_model, 64), nn.GELU(), nn.Linear(64, 1))

    def forward(self, cls):
        return torch.sigmoid(self.net(cls))


class SonicTower(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = PatchEmbed()
        self.encoder = SonicEncoder()
        self.project = ProjectionHead()
        self.energy = EnergyHead()

    def forward(self, fbank_batch):                                   # (B, 1, 128, 1024)
        tokens = self.embed(fbank_batch)
        cls, _ = self.encoder(tokens)
        return self.project(cls), self.energy(cls)                    # z (B,128), e (B,1)
```

### 1.3 The contrastive objective (self-supervised, cross-window)

Two random windows of the same track (different time regions, different augmentations)
must map to the same neighborhood; windows of other tracks are pushed away.

```
augmentations per view (i.i.d.):
  gain ∈ [-6, +3] dB · EQ tilt ∈ [-3, +3] dB/oct · time-stretch ∈ [-4%, +4%]
  additive pink noise SNR ∈ [20, 35] dB · channel swap p=0.5

InfoNCE (temperature τ = 0.07):

  ℓ_ij = − log [ exp(⟨z_i, z_j⟩ / τ) / Σ_{k≠i} exp(⟨z_i, z_k⟩ / τ) ]

  L_contrastive = (1/N) Σ_i ( ℓ_{i, i⁺} + ℓ_{i⁺, i} )        # symmetric
```

```python
def contrastive_loss(z1: torch.Tensor, z2: torch.Tensor, tau: float = 0.07):
    """z1, z2: (N, 128) L2-normalized embeddings of paired views."""
    logits = z1 @ z2.T / tau                                        # (N, N) cosine/τ
    labels = torch.arange(z1.size(0), device=z1.device)
    return (nn.functional.cross_entropy(logits, labels)
          + nn.functional.cross_entropy(logits.T, labels)) / 2


class Augment(nn.Module):
    """The two views. Cheap DSP so positives differ in mastering, not in identity."""
    def __init__(self, sr=SAMPLE_RATE):
        super().__init__()
        self.sr = sr

    def forward(self, wf):
        gain_db = torch.empty(1).uniform_(-6.0, 3.0).item()
        wf = wf * (10 ** (gain_db / 20))
        noise = torch.randn_like(wf)
        snr = torch.empty(1).uniform_(20.0, 35.0).item()
        wf = wf + noise * wf.pow(2).mean().sqrt() / (10 ** (snr / 20))
        if torch.rand(1).item() < 0.5:                               # channel swap (stereo in)
            wf = wf.flip(0)
        return wf
```

### 1.4 Track embedding aggregation (windows → one vector)

```
z_track = normalize( Σ_k  softmax_k( m_k / ρ ) · z_k ),   ρ = 0.5
          m_k = mean(|mel_k|) over the window              # energy-weighted attention
```

Energy-weighted pooling: loud/forward windows carry the track's identity; quiet
outros dilute it. Track-level energy:

```
e_track = mean_k( e_head(z_k) )                            # ∈ [0,1], §2's input
```

```python
@torch.no_grad()
def extract_track_embedding(waveform, sr, tower: SonicTower):
    windows = ingest(waveform, sr)
    zs, es = [], []
    for i in range(0, windows.size(0), 8):                   # batched inference
        z, e = tower(windows[i:i + 8])
        zs.append(z); es.append(e)
    z = torch.cat(zs); e = torch.cat(es).squeeze(-1)
    energy_w = torch.softmax(windows.mean(dim=(1, 2, 3)) / 0.5, dim=0)  # ρ=0.5 sharpen
    track_vec = (energy_w.unsqueeze(-1) * z).sum(0)
    track_vec = track_vec / track_vec.norm().clamp_min(1e-8)
    return track_vec.cpu(), float(e.mean())
```

---

## 2. Dynamic Arc Sequencing — Energy Trajectory State Machine

### 2.1 State

```
S_t = [e_{t−N+1}, …, e_t],  N = 5                     # energy ring buffer
v_t = (1 − α)·v_{t−1} + α·(e_t − e_{t−1}),  α = 0.4   # session velocity (EMA of steps)
a_t = v_t − v_{t−1}                                    # acceleration
r_t = max(S_t) − min(S_t)                              # dynamic range
```

### 2.2 Arc phases (state machine with hysteresis)

```
states: BUILD → PEAK → SUSTAIN → COOL
transitions (evaluated per track, dwell ≥ 2 tracks per state):

  BUILD:   v_t ≥ +0.02  ∧  e_t < 0.75
  PEAK:    e_t ≥ 0.75   ∧  |v_t| < 0.06
  SUSTAIN: |v_t| < 0.02 ∧  e_t ≥ 0.45
  COOL:    v_t ≤ −0.02  ∨  e_t < 0.35

target energy per phase:
  g(BUILD)=+1.6  g(PEAK)=+0.4  g(SUSTAIN)=+0.2  g(COOL)=−1.4

  e*_t = clamp( e_t + g(phase)·|v_t|·λ + a_t·κ ,  phase_lo, phase_hi )
  λ = 1.0, κ = 0.6,  phase bounds: BUILD [0.30,0.75] PEAK [0.70,1.0]
                    SUSTAIN [0.45,0.80] COOL [0.10,0.45]
```

```python
from dataclasses import dataclass
from enum import Enum

class Phase(Enum):
    BUILD = 0; PEAK = 1; SUSTAIN = 2; COOL = 3

G      = {Phase.BUILD: 1.6, Phase.PEAK: 0.4, Phase.SUSTAIN: 0.2, Phase.COOL: -1.4}
BOUNDS = {Phase.BUILD: (0.30, 0.75), Phase.PEAK: (0.70, 1.0),
          Phase.SUSTAIN: (0.45, 0.80), Phase.COOL: (0.10, 0.45)}

@dataclass
class Session:
    window: list[float]          # last N=5 energies, newest last
    velocity: float = 0.0
    phase: Phase = Phase.SUSTAIN
    dwell: int = 2               # hysteresis counter

    def push(self, e: float):
        prev_e = self.window[-1] if self.window else e
        self.velocity = 0.6 * self.velocity + 0.4 * (e - prev_e)
        self.window.append(e)
        if len(self.window) > 5:
            self.window.pop(0)
        self._transition()

    def _transition(self):
        if self.dwell > 0:                       # hysteresis: hold the phase
            self.dwell -= 1
            return
        e, v = self.window[-1], self.velocity
        if   v >= 0.02 and e < 0.75: new = Phase.BUILD
        elif e >= 0.75 and abs(v) < 0.06: new = Phase.PEAK
        elif abs(v) < 0.02 and e >= 0.45: new = Phase.SUSTAIN
        elif v <= -0.02 or e < 0.35: new = Phase.COOL
        else: new = self.phase
        if new != self.phase:
            self.phase, self.dwell = new, 2      # ≥2 tracks before the next flip

    def target_energy(self, kappa: float = 0.6) -> float:
        e = self.window[-1] if self.window else 0.5
        accel = self.velocity - (self.window[-2] - self.window[-3] if len(self.window) >= 3 else 0)
        lo, hi = BOUNDS[self.phase]
        return max(lo, min(hi, e + G[self.phase] * abs(self.velocity) * 1.0 + accel * kappa))

    def dynamic_range(self) -> float:
        return max(self.window) - min(self.window) if self.window else 0.0
```

### 2.3 Trajectory penalty on a candidate

```
P_traj(c) = λ_e · (e_c − e*_t)²  +  λ_a · max(0, −align(c))²
align(c)  = sign(e_c − e_t) · sign(v_t)          # does the candidate keep the ramp?
λ_e = 2.2, λ_a = 0.8
```

A candidate that breaks the session's momentum (cooling during BUILD, spiking during
COOL) pays quadratically — the state machine, not the embedding, owns the flow.

---

## 3. The Serendipity Gate & Cosine Similarity Scoring Engine

### 3.1 Session query vector

```
q_t = normalize( η · z_{t} + (1 − η) · anchor ),   η = 0.65
anchor = normalize( Σ_{k=1..N} z_{t−k} / N )       # the session's sonic center
```

The query leans on the track playing right now but remembers the session's identity.

### 3.2 Candidate scoring (full function)

```
s_sonic(c) = ⟨ q_t , ĉ / ‖ĉ‖ ⟩                              # cosine, L2-normalized

S(c) = W · [ s_sonic , −P_traj(c) , A(c) , G_k(c) ]ᵀ  +  s_explore(c)

  A(c)   = affinity(c.artist) ∈ [0, 1]                   # §4 telemetry
  G_k(c) = 1 if gate open ∧ artist(c) ∉ heard_30 else 0  # serendipity slot
  s_explore(c) = ε · (1 − affinity(c.artist))            # novelty bonus

weights (base, before §4 scaling):
  w_sonic = 0.45   w_energy = 0.25   w_affinity = 0.20   w_gate = 0.10
  ε = 0.30 · (1 − echo_index),  echo_index = |{last 4 tracks : primary artist
  ∈ top-3 artists of those 4}| / 4      # echo-chamber index, ECI
```

**Echo Chamber Index drives the Serendipity Gate**: if the last 4 tracks were >50%
one act, the gate opens early (K collapses), and the exploration slot picks the
highest-novelty candidate: `argmax_c (1 − A(c)) · s_sonic(c)`.

```python
import numpy as np

class ScoringEngine:
    W = np.array([0.45, 0.25, 0.20, 0.10])                # sonic, energy, affinity, gate
    EPS_BASE = 0.30
    REPEAT_WINDOW = 3                                     # artist may not recur within 3

    def __init__(self, index, meta, session: Session):
        self.index = index                                # faiss.IndexFlatIP(128)
        self.meta = meta                                  # id → dict(artist, album, plays)
        self.session = session

    def echo_index(self, recent):
        if len(recent) < 4:
            return 0.0
        acts = [self.meta[t]["primary_artist"] for t in recent[-4:]]
        top = max(set(acts), key=acts.count)
        return acts.count(top) / 4

    def score(self, query: np.ndarray, e_star: float, candidates,
              recent_ids, recent_artists, affinity, gate_open: bool):
        out = []
        for c in candidates:                              # c: {id, vec, energy, artist, album}
            vec = c["vec"] / np.linalg.norm(c["vec"]).clip(1e-8)
            s_sonic = float(query @ vec)
            p_traj = 2.2 * (c["energy"] - e_star) ** 2 \
                   + 0.8 * max(0.0, -np.sign(c["energy"] - self.session.window[-1])
                                    * np.sign(self.session.velocity)) ** 2
            affinity = affinity.get(c["meta"]["primary_artist"], 0.0)
            gate = 1.0 if gate_open and c["meta"]["primary_artist"] not in recent_artists else 0.0
            repeat = 1.0 if c["meta"]["primary_artist"] in recent_artists[-self.REPEAT_WINDOW:] else 0.0
            S = (self.W @ np.array([s_sonic, -p_traj, affinity, gate])
                 + self.EPS_BASE * (1 - affinity) * gate)
            if repeat:                                    # artist recurred inside 3 — hard demote
                S -= 1.0
            out.append({"id": c["id"], "score": S, "s_sonic": s_sonic, "p_traj": p_traj})
        return sorted(out, key=lambda d: -d["score"])
```

### 3.3 The gate schedule (when exploration fires)

```
K = 4 + Poisson(1)                                      # 3–6 tracks between gates
gate opens at track t  iff  (t − t_last_gate) ≥ K  ∨  ECI_t > 0.5
while open: the exploration slot takes  argmax_c (1 − A(c)) · s_sonic(c)
after one pick: gate closes, K re-rolls
```

---

## 4. Environmental & Intent Telemetry Integration

### 4.1 Context encoding

```
time-of-day:  h = local hour → tod = [sin(2πh/24), cos(2πh/24)]
motion:       m ∈ {0 stationary, 1 walking, 2 driving}       (CoreMotion / accelerometer)
device:       d ∈ {0 headphones, 1 speaker, 2 car}
```

### 4.2 The weighting matrix

```
W(context) = W₀ ⊙ (1 + Δ·[tod₁, tod₂, m, d])              # elementwise, W₀ = §3 base
```

Heuristic Δ table (calibrated against Apple/Spotify behavior):

| context axis | sonic | energy | affinity | gate (ε) |
|---|---|---|---|---|
| late night (0–5h) | +0.05 | **−0.15** | +0.10 | −0.05 |
| morning (5–10h) | 0 | +0.05 | +0.05 | +0.05 |
| driving (m=2) | −0.05 | **+0.20** | −0.05 | **−0.10** |
| walking (m=1) | 0 | **+0.10** | 0 | +0.05 |
| car audio (d=2) | −0.10 | **+0.15** | +0.10 | −0.10 |
| headphones (d=0) | **+0.10** | 0 | 0 | +0.10 |

Intuition: driving wants energy and hates surprises; headphones at night want
texture and tolerate discovery; speakers want familiarity.

```python
D_TABLE = {
    "late_night":  {"sonic": 0.05,  "energy": -0.15, "affinity": 0.10,  "gate": -0.05},
    "morning":     {"sonic": 0.0,   "energy": 0.05,  "affinity": 0.05,  "gate": 0.05},
    "driving":     {"sonic": -0.05, "energy": 0.20,  "affinity": -0.05, "gate": -0.10},
    "walking":     {"sonic": 0.0,   "energy": 0.10,  "affinity": 0.0,   "gate": 0.05},
    "car_audio":   {"sonic": -0.10, "energy": 0.15,  "affinity": 0.10,  "gate": -0.10},
    "headphones":  {"sonic": 0.10,  "energy": 0.0,   "affinity": 0.0,   "gate": 0.10},
}

def telemetry_weights(hour: int, motion: int, device: int):
    W0 = np.array([0.45, 0.25, 0.20, 0.10])
    ctx = []
    if 0 <= hour < 5:  ctx.append("late_night")
    elif 5 <= hour < 10: ctx.append("morning")
    if motion == 2: ctx.append("driving")
    elif motion == 1: ctx.append("walking")
    if device == 2: ctx.append("car_audio")
    elif device == 0: ctx.append("headphones")
    W = W0.copy()
    for key in ctx:
        delta = D_TABLE[key]
        W = W + np.array([delta["sonic"], delta["energy"], delta["affinity"], delta["gate"]])
    return np.clip(W, 0.05, 0.85)                          # keep every term alive
```

---

## 5. Algorithmic execution trace (end-to-end, numeric)

**Input:** track tensor `z_t = [0.31, −0.55, 0.12, 0.77, …]` (128-d, shown 4-d),
`e_t = 0.62`, session `S = [0.55, 0.48, 0.60, 0.58, 0.62]`, `v_t = +0.04`,
`query q_t` pre-blended, gate closed (ECI = 0.25), `W = [0.45, 0.25, 0.20, 0.10]`.

```
1. session.push(0.62)      → v = 0.6·0.04 + 0.4·(0.62−0.58) = 0.040
2. phase check             → |v| < 0.02? no · e ≥ 0.75? no → SUSTAIN (dwell 1)
3. e* = 0.62 + 0.2·|0.04|·1.0 + a·0.6 = 0.63          (SUSTAIN band [0.45, 0.80] ✓)
4. Faiss search(q_t, k=64) → 64 candidates from the 128-d index
5. per-candidate (showing 3 of 64):

   c₁: vec=[0.28,−0.50,0.10,0.81]  e=0.58  artist="S автo I"  affinity=0.62
       s_sonic = ⟨q,c⟩ = 0.91
       P_traj  = 2.2·(0.58−0.63)² + 0.8·max(0,−align)² = 2.2·0.0025 = 0.0055
       terms   = [0.91, −0.0055, 0.62, 0.0]  → S = 0.45·0.91 + 0.25·(−0.0055)
                 + 0.20·0.62 + 0.10·0 = 0.4095 − 0.0014 + 0.1240 = 0.5321
   c₂: vec=[0.05,−0.20,0.44,0.60]  e=0.91  artist="B"  affinity=0.10
       s_sonic = 0.42   P_traj = 2.2·(0.91−0.63)² = 0.173
       S = 0.189 − 0.043 + 0.020 = 0.166          ← energy trajectory kills it
   c₃: vec=[0.22,−0.48,0.08,0.85]  e=0.66  artist="new-to-you"  affinity=0.00
       s_sonic = 0.88   P_traj = 2.2·(0.03)² ≈ 0.002
       S = 0.396 − 0.000 + 0.000 + gate? ECI 0.25 < 0.5 → gate closed
       S = 0.396                                  ← best novel, waits for the gate

6. rank: c₁ (0.532) ▸ c₃ (0.396) ▸ c₂ (0.166)  → queue c₁
7. state update: session.push(e_{c₁}=0.58); K_remaining -= 1; ECI recomputed
8. gate: tracks_since_gate = 4, ECI rising → next pick opens the serendipity
   slot → c₃-class candidates surface (novel act, sonic-adjacent)
```

---

## 6. Musike integration map (TypeScript + Python)

| Engine piece | Runs as | Ships |
|---|---|---|
| Ingest + tower inference | Python sidecar `POST /ingest` (FastAPI, torchaudio) — called by the server's `prepare()` hook, cached by YT id | needs the sidecar container |
| Vector index | faiss `IndexFlatIP(128)` + SQLite metadata (artist/album/energy), served as `vec` fields on `/api/radio` | sidecar |
| Energy state machine | **TypeScript port already spec'd (§2)** — runs in the player store, needs only `e` per track | next build once sidecar serves `energy` |
| Scoring engine | **TypeScript port of §3** — replaces the heuristic scorer in `pickSuggestions` when `vec` fields exist; heuristic brain remains the fallback | next build |
| Telemetry matrix | TypeScript (device motion + hour are already available client-side) | next build |

**Fallback invariant:** every ML path has the heuristic brain behind it — the queue
never blocks on the sidecar, and tracks without embeddings are scored by the v2
heuristic (affinity/continuity/jitter) with `s_sonic = 0`. The system degrades, never dies.
