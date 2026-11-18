import AVFoundation
import Capacitor
import WebKit

/// Plays audio natively, so the music doesn't go through the web view's media stack.
///
/// WKWebView hands media to a separate process that YouTube cuts off after a few hundred kilobytes: the element
/// just pauses, with no error, about fifteen seconds in. AVPlayer uses the app's own network stack instead, which
/// reads the same URL from beginning to end. The web app drives it through the `musikeAudio` handler and gets
/// `window.__musikeAudioEvent(...)` back, so the player code doesn't have to know the difference.
///
/// The queue flows without dead air: while a song plays, the web sends `preload` with the NEXT track's URL and
/// this side builds and primes a second player for it (muted, buffers filled). When the song ends and the web
/// loads that URL, the primed player is adopted as-is — the next song starts from an already-buffered pipeline
/// instead of a fresh network dance.
final class MusikeAudio: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    /// Durations as YouTube reported them, by stream URL. AVPlayer often guesses twice the real length for these
    /// audio-only streams, which would show a seven-minute song as fourteen.
    private static var knownDurations: [String: Double] = [:]
    private var player: AVPlayer?
    private var item: AVPlayerItem?
    private var knownDuration: Double?
    private var currentLink = ""
    private var muted = false
    /// Where a load that hasn't reached `readyToPlay` yet should start (set at adoption, honored when ready).
    private var pendingStart: Double = 0
    /// Set once the real end was reported, so a padded stream doesn't end a second time.
    private var ended = false
    private var ticker: Any?
    private var statusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var stallTimer: Timer?
    // The pre-rolled next track (see the class comment).
    private var nextLink: String?
    private var nextPlayer: AVPlayer?
    private var nextItem: AVPlayerItem?
    private var nextStatusObservation: NSKeyValueObservation?

    func attach(_ webView: WKWebView?) {
        self.webView = webView
    }

    static func remember(url: String, duration: Double) {
        guard duration > 0 else { return }
        knownDurations[url] = duration
        if knownDurations.count > 40 { knownDurations.removeAll() }
    }

    // MARK: - What the web app sends

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "musikeAudio",
              let body = message.body as? [String: Any],
              let command = body["cmd"] as? String
        else { return }

        switch command {
        case "load":
            load(body["url"] as? String ?? "", startAt: body["startAt"] as? Double ?? 0)
        case "preload":
            preload(body["url"] as? String ?? "")
        case "duration":
            rememberDuration(body["value"] as? Double ?? 0)
        case "play":
            play()
        case "pause":
            player?.pause()
        case "seek":
            seek(body["to"] as? Double ?? 0)
        case "volume":
            player?.volume = Float(body["value"] as? Double ?? 1)
        case "muted":
            muted = body["value"] as? Bool ?? false
            player?.isMuted = muted
        default:
            break
        }
    }

    // MARK: - Playback

    private func load(_ link: String, startAt: Double) {
        // The primed next track is this URL: adopt it and the song starts instantly.
        if link == nextLink, let nextPlayer, let nextItem {
            adoptPrimed(nextPlayer, nextItem, url: link, startAt: startAt)
            return
        }
        clearNext()
        buildPlayer(for: link, startAt: startAt)
    }

    /// Builds a fresh player for a stream URL — the path when there was no primed match.
    private func buildPlayer(for link: String, startAt: Double) {
        tearDown()
        guard let url = URL(string: link), !link.isEmpty else {
            emit("error", ["message": "No stream"])
            return
        }
        currentLink = link
        pendingStart = startAt
        let asset = AVURLAsset(url: url, options: [
            "AVURLAssetHTTPHeaderFieldsKey": [
                "User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            ],
        ])
        let newItem = AVPlayerItem(asset: asset)
        knownDuration = Self.knownDurations[link]
        // Keep a visible amount ahead of the playhead, so the buffered part of the progress bar means something.
        newItem.preferredForwardBufferDuration = 30
        ended = false
        let newPlayer = AVPlayer(playerItem: newItem)
        newPlayer.automaticallyWaitsToMinimizeStalling = true
        newPlayer.volume = player?.volume ?? 1
        player = newPlayer
        item = newItem

        statusObservation = nil
        attachReadyObservation(newItem)
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: newItem, queue: .main
        ) { [weak self] _ in
            self?.emit("ended")
        }
        watchStalls(on: newPlayer)
        startTicker()
    }

    /// The standard item observation: report `ready` (and honor a pending start position) or the failure.
    private func attachReadyObservation(_ newItem: AVPlayerItem) {
        statusObservation = newItem.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard let self else { return }
            switch item.status {
            case .readyToPlay:
                let seconds = CMTimeGetSeconds(item.duration)
                self.emit("ready", ["duration": self.duration(from: seconds)])
                if self.pendingStart > 0 {
                    self.seek(self.pendingStart)
                    self.pendingStart = 0
                }
            case .failed:
                self.emit("error", ["message": item.error?.localizedDescription ?? "Playback failed"])
            default:
                break
            }
        }
    }

    /// Moves a primed player into the current slot: no rebuild, the buffers stay, the music continues.
    private func adoptPrimed(_ primedPlayer: AVPlayer, _ primedItem: AVPlayerItem, url: String, startAt: Double) {
        tearDown()
        primedPlayer.volume = player?.volume ?? primedPlayer.volume // volume may have changed since the prime
        player = primedPlayer
        item = primedItem
        currentLink = url
        pendingStart = startAt
        knownDuration = Self.knownDurations[url]
        ended = false
        primedPlayer.isMuted = muted
        // The preload's own observation is retired; the standard ready/failed handling takes over.
        nextStatusObservation = nil
        nextPlayer = nil
        nextItem = nil
        nextLink = nil
        if primedItem.status == .readyToPlay {
            emit("ready", ["duration": duration(from: CMTimeGetSeconds(primedItem.duration))])
            if pendingStart > 0 {
                seek(pendingStart)
                pendingStart = 0
            }
        } else {
            attachReadyObservation(primedItem) // still resolving: the ready event lands here
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: primedItem, queue: .main
        ) { [weak self] _ in
            self?.emit("ended")
        }
        watchStalls(on: primedPlayer)
        startTicker()
    }

    /// Builds and primes the NEXT track's player while the current song plays: muted, a moment of
    /// playback to open the pipeline, then parked. A dead link cleans itself up quietly.
    private func preload(_ link: String) {
        guard !link.isEmpty, link != currentLink, link != nextLink, let url = URL(string: link) else { return }
        clearNext()
        let asset = AVURLAsset(url: url, options: [
            "AVURLAssetHTTPHeaderFieldsKey": [
                "User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            ],
        ])
        let newItem = AVPlayerItem(asset: asset)
        newItem.preferredForwardBufferDuration = 30
        let newPlayer = AVPlayer(playerItem: newItem)
        newPlayer.automaticallyWaitsToMinimizeStalling = true
        newPlayer.volume = player?.volume ?? 1
        newPlayer.isMuted = true
        newPlayer.play()
        newPlayer.pause()
        newPlayer.seek(to: CMTime.zero)
        nextLink = link
        nextItem = newItem
        nextPlayer = newPlayer
        nextStatusObservation = newItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard let self else { return }
            if item.status == .failed { self.clearNext() } // the handoff must not surface a dead preloaded link
        }
    }

    /// The web tells the player how long the track really is (YouTube Music metadata). Some streams carry
    /// silence past the song; with the real length known, the song ends where the song ends.
    private func rememberDuration(_ d: Double) {
        guard d > 0 else { return }
        knownDuration = d
        Self.remember(url: currentLink, duration: d)
    }

    private func duration(from measured: Double) -> Double {
        if let knownDuration { return knownDuration }
        return measured.isFinite ? measured : 0
    }

    private func play() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
        player?.play()
        emit("playing")
    }

    private func seek(_ to: Double) {
        guard let player else { return }
        player.seek(
            to: CMTime(seconds: max(0, to), preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        ) { [weak self] finished in
            guard finished else { return }
            // AVPlayer reports the old position until the seek lands; the web side waits for this.
            self?.emit("seeked", ["position": to])
        }
    }

    private func bufferedEnd() -> Double {
        guard let range = item?.loadedTimeRanges.last?.timeRangeValue else { return 0 }
        return CMTimeGetSeconds(CMTimeAdd(range.start, range.duration))
    }

    // MARK: - Stalls

    /// A stream that stops moving while the UI says "playing" is a silent stall: after ten seconds of
    /// `waitingToPlayAtSpecifiedRate`, tell the web (it maps to "loading" and its watchdog takes over).
    private func watchStalls(on newPlayer: AVPlayer) {
        timeControlObservation = newPlayer.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            guard let self else { return }
            switch player.timeControlStatus {
            case .waitingToPlayAtSpecifiedRate:
                self.startStallTimer()
            case .playing, .paused:
                self.stopStallTimer()
            @unknown default:
                break
            }
        }
    }

    private func startStallTimer() {
        guard stallTimer == nil else { return }
        stallTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            self?.stallTimer = nil
            self?.emit("waiting")
        }
    }

    private func stopStallTimer() {
        stallTimer?.invalidate()
        stallTimer = nil
    }

    // MARK: - Position

    private func startTicker() {
        guard let player else { return }
        ticker = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            guard let self, let item = self.item else { return }
            let position = CMTimeGetSeconds(time)
            self.emit("time", [
                "position": position,
                "duration": self.duration(from: CMTimeGetSeconds(item.duration)),
                "buffered": self.bufferedEnd(),
            ])
            // These audio streams carry silence past the song, and AVPlayer only calls it finished at the very end
            // of the file. The track really ends where YouTube says it does.
            if let known = self.knownDuration, !self.ended, position >= known - 0.5 {
                self.ended = true
                self.player?.pause()
                self.emit("ended")
            }
        }
    }

    // MARK: - Teardown

    private func tearDown() {
        if let ticker { player?.removeTimeObserver(ticker) }
        ticker = nil
        statusObservation = nil
        timeControlObservation = nil
        stopStallTimer()
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player?.pause()
        player = nil
        item = nil
    }

    private func clearNext() {
        nextStatusObservation = nil
        nextPlayer?.pause()
        nextPlayer = nil
        nextItem = nil
        nextLink = nil
    }

    private func emit(_ event: String, _ payload: [String: Any] = [:]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let js = "window.__musikeAudioEvent && window.__musikeAudioEvent('\(event)', \(json))"
        if Thread.isMainThread {
            webView?.evaluateJavaScript(js)
        } else {
            DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(js) }
        }
    }
}
