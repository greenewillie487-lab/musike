import UIKit
import WebKit

/// The iOS side of appearance: syncs the iPhone's Light/Dark mode with the web view,
/// and keeps the status bar and the web view's background honest in every mode.
///
/// The web app talks to it over the `musikeAppearance` message handler (web/src/lib/theme.ts)
/// and it talks back with `window.__musikeAppearanceChange(dark)` — the same push pattern
/// MusikePlayback uses, so the theme code on the web stays framework-free.
///
/// Appearance modes (from the web):
/// - "system": the web view inherits the iPhone's interface style; the background follows
///   it with a dynamic UIColor, and system changes are pushed to JS live.
/// - "light" / "dark": the web view's interface style is overridden so the status bar,
///   rubber-banding and form controls match the user's manual choice.
///
/// Honest scope note: the entire Musike interface is web content in a WKWebView — there are
/// no native UIKit views in the UI stack, so Apple's native Liquid Glass APIs (.glassEffect,
/// UIGlassEffect) have no surface to attach to here. The glass the user sees is the web
/// implementation (docs: web/src/styles.css). This plugin does the part that genuinely
/// requires native code: system appearance detection, live change events, and
/// status-bar/background synchronization.
final class MusikeAppearance: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    /// The last mode the web asked for ("system" | "light" | "dark"). "system" is the default.
    private var mode = "system"

    /// Called once the web view exists, so trait observations and background updates have somewhere to go.
    func attach(_ webView: WKWebView?, in viewController: UIViewController?) {
        self.webView = webView
        self.viewController = viewController
        apply(mode: mode)
    }

    // MARK: - JS → native (window.webkit.messageHandlers.musikeAppearance.postMessage)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "musikeAppearance",
              let body = message.body as? [String: Any],
              let mode = body["mode"] as? String else { return }
        apply(mode: mode)
    }

    // MARK: - Mode application

    private func apply(mode: String) {
        self.mode = mode
        guard let webView else { return }
        switch mode {
        case "light":
            webView.overrideUserInterfaceStyle = .light
            webView.backgroundColor = UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1) // #F2F2F7
        case "dark":
            webView.overrideUserInterfaceStyle = .dark
            webView.backgroundColor = UIColor(red: 0.0, green: 0.0, blue: 0.0, alpha: 1) // #000000
        default:
            // System: inherit the iPhone's style; the background tracks it via a dynamic color.
            webView.overrideUserInterfaceStyle = .unspecified
            webView.backgroundColor = UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.0, green: 0.0, blue: 0.0, alpha: 1)
                    : UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1)
            }
        }
        pushToWeb()
        viewController?.setNeedsStatusBarAppearanceUpdate()
    }

    /// Called by the web view controller when the system interface style changes.
    func systemStyleChanged(_ style: UIUserInterfaceStyle) {
        apply(mode: mode)
    }

    // MARK: - native → JS

    private func pushToWeb() {
        let dark = (webView?.overrideUserInterfaceStyle == .dark)
            || (webView?.overrideUserInterfaceStyle == .unspecified
                && webView?.traitCollection.userInterfaceStyle == .dark)
        webView?.evaluateJavaScript(
            "window.__musikeAppearanceChange && window.__musikeAppearanceChange(\(dark ? "true" : "false"))"
        ) { _, _ in } // fire and forget: a dropped push is healed by the next trait change
    }
}
