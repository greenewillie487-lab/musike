import Capacitor
import UIKit

/// A properly structured Capacitor plugin exposing a NATIVE Liquid Glass mini-player.
///
/// On iOS 26+ the bar carries a genuine `UIGlassEffect` (Apple's Liquid Glass material,
/// verified against developer.apple.com/documentation/uikit/uiglasseffect — iOS 26.0+,
/// inherits UIVisualEffect, init(style:), isInteractive, tintColor). On iOS 15–25 the
/// same bar falls back to the system chrome blur material — native, just not Liquid Glass.
/// The source is gated with #if compiler(>=6.2) so older Xcode versions build cleanly.
///
/// JS API (web/src/lib/glass-native.ts, registerPlugin("GlassPlayer")):
///   enable()  → shows the native bar, tells the web to hide its own mini-player
///   disable() → removes the native bar
///   setTrack({ title, artist, artwork, duration }) → updates bar content
///   setPlaying({ playing, progress }) → syncs the icon and progress hairline
///
/// Playback commands from the bar go back out through the web's own action channel
/// (__musikeMediaAction), so there is exactly one playback brain.
@objc(GlassPlayerPlugin)
public class GlassPlayerPlugin: CAPPlugin {
    private var bar: GlassMiniBarView?
    private var progressTimer: Timer?

    @objc func enable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView, let parent = webView.superview else {
                call.reject("web view not ready")
                return
            }
            if self.bar == nil {
                let bar = GlassMiniBarView(frame: .zero)
                bar.isHidden = true
                self.bar = bar
                bar.onPlayPause = { self.command("toggle") }
                bar.onNext = { self.command("next") }
            }
            guard let bar = self.bar else { return }
            bar.layoutIn(parent: parent)
            self.applyGlass(to: bar)
            bar.isHidden = false
            parent.bringSubviewToFront(bar)
            self.startProgressSync()
            call.resolve()
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.progressTimer?.invalidate()
            self.progressTimer = nil
            self.bar?.isHidden = true
            call.resolve()
        }
    }

    @objc func setTrack(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist") ?? ""
        let artwork = call.getString("artwork").flatMap(URL.init(string:))
        let duration = Float(call.getFloat("duration") ?? 0)
        DispatchQueue.main.async {
            self.bar?.update(title: title, artist: artist, artworkURL: artwork, progress: 0, playing: false)
            self.bar?.setDuration(duration)
            call.resolve()
        }
    }

    @objc func setPlaying(_ call: CAPPluginCall) {
        let playing = call.getBool("playing") ?? false
        let progress = Float(call.getFloat("progress") ?? 0)
        DispatchQueue.main.async {
            self.bar?.setPlayingIcon(playing)
            self.bar?.setProgress(progress)
            call.resolve()
        }
    }

    /// Genuine Liquid Glass on iOS 26+ (compiler-gated: the UIGlassEffect symbol only
    /// exists in the iOS 26 SDK). Older toolchains/iOS versions keep the system blur.
    private func applyGlass(to bar: GlassMiniBarView) {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = true
            let container = UIGlassContainerEffect()
            _ = container // the container variant applies when multiple glass elements coexist
            bar.replaceEffect(visualEffect: glass)
            return
        }
        #endif
        bar.replaceEffect(visualEffect: nil) // keep the system chrome blur fallback
    }

    /// Playback commands route through the web's single action channel.
    private func command(_ action: String) {
        DispatchQueue.main.async {
            self.bridge?.webView?.evaluateJavaScript(
                "window.__musikeMediaAction && window.__musikeMediaAction('\(action)')"
            ) { _, _ in }
        }
    }

    /// A 1-second progress sync so the hairline tracks real playback.
    private func startProgressSync() {
        progressTimer?.invalidate()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                self?.bridge?.webView?.evaluateJavaScript(
                    "window.__musikeProgress && window.__musikeProgress()"
                ) { result, _ in
                    guard let value = result as? NSNumber else { return }
                    self?.bar?.setProgress(value.floatValue)
                }
            }
        }
    }
}
