import Capacitor
import UIKit
import WebKit

/// The app's web view: Capacitor's own, plus the bridges iOS needs that Android has in its Java code —
/// the lock screen (MusikePlayback), resolving a stream URL (MusikeYouTube), the audio session
/// (MusikeAudio) and the system appearance sync (MusikeAppearance).
final class MusikeWebViewController: CAPBridgeViewController {
    private let playback = MusikePlayback()
    private let youtube = MusikeYouTube()
    private let audio = MusikeAudio()
    private let appearance = MusikeAppearance()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Capacitor replaces the web view's userContentController after the configuration is built, so the handlers
        // are added here, once the web view exists.
        webView?.configuration.userContentController.add(playback, name: "musikeMedia")
        webView?.configuration.userContentController.add(youtube, name: "musikeResolve")
        webView?.configuration.userContentController.add(audio, name: "musikeAudio")
        webView?.configuration.userContentController.add(appearance, name: "musikeAppearance")
        playback.attach(webView)
        youtube.attach(webView)
        audio.attach(webView)
        appearance.attach(webView, in: self)
        // Swipe from the left edge goes back, like the Android back button: dialogs close, then pages.
        webView?.allowsBackForwardNavigationGestures = true
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        // The iPhone flipped Light/Dark (or Contrast changed): the appearance plugin re-syncs the
        // web view's background and pushes the change to JS while the app is open.
        if traitCollection.userInterfaceStyle != previousTraitCollection?.userInterfaceStyle {
            appearance.systemStyleChanged(traitCollection.userInterfaceStyle)
        }
    }
}
