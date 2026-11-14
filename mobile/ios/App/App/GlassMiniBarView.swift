import UIKit

/// The native glass mini-player bar. A real UIKit surface: genuine `UIGlassEffect`
/// on iOS 26+, the system blur material (`UIVisualEffectView`) on older iOS, and a
/// plain translucent fallback when effects are unavailable or reduced.
///
/// Playback commands go through the web's own action channel (`__musikeMediaAction`),
/// the same one Android's plugin and the lock-screen commands use — one playback brain.
final class GlassMiniBarView: UIView {
    private let effectView = UIVisualEffectView()
    private let artworkView = UIImageView()
    private let titleLabel = UILabel()
    private let artistLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let nextButton = UIButton(type: .system)
    private let progressView = UIView()
    private var progressLeading: NSLayoutConstraint?
    private var glassApplied = false
    private var duration: Float = 0

    var onPlayPause: (() -> Void)?
    var onNext: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func setup() {
        layer.cornerRadius = 16
        clipsToBounds = true
        // The system blur material underlies the glass on iOS < 26; on 26+ the
        // plugin replaces this with a genuine UIGlassEffect-backed view.
        effectView.effect = UIBlurEffect(style: .systemChromeMaterial)
        addSubview(effectView)

        artworkView.contentMode = .scaleAspectFill
        artworkView.clipsToBounds = true
        artworkView.layer.cornerRadius = 8
        artworkView.layer.cornerCurve = .continuous
        artworkView.backgroundColor = UIColor.tertiarySystemFill
        addSubview(artworkView)

        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        titleLabel.textColor = .label
        titleLabel.lineBreakMode = .byTruncatingTail
        addSubview(titleLabel)

        artistLabel.font = .systemFont(ofSize: 12, weight: .regular)
        artistLabel.textColor = .secondaryLabel
        artistLabel.lineBreakMode = .byTruncatingTail
        addSubview(artistLabel)

        let config = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        playButton.setImage(UIImage(systemName: "play.fill", withConfiguration: config), for: .normal)
        playButton.tintColor = .label
        playButton.addTarget(self, action: #selector(playPauseTapped), for: .touchUpInside)
        addSubview(playButton)

        let nextConfig = UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)
        nextButton.setImage(UIImage(systemName: "forward.fill", withConfiguration: nextConfig), for: .normal)
        nextButton.tintColor = .label
        nextButton.addTarget(self, action: #selector(nextTapped), for: .touchUpInside)
        addSubview(nextButton)

        progressView.backgroundColor = .separator
        progressView.layer.cornerRadius = 1
        addSubview(progressView)

        // Constraints are finalized by the plugin once the bar knows its superview.
    }

    func layoutIn(parent: UIView) {
        parent.addSubview(self)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            leadingAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            trailingAnchor.constraint(equalTo: parent.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            heightAnchor.constraint(equalToConstant: 64),
        ])
        effectView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
            effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
            effectView.topAnchor.constraint(equalTo: topAnchor),
            effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        artworkView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            artworkView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            artworkView.centerYAnchor.constraint(equalTo: centerYAnchor),
            artworkView.widthAnchor.constraint(equalToConstant: 44),
            artworkView.heightAnchor.constraint(equalToConstant: 44),
        ])
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        artistLabel.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            titleLabel.leadingAnchor.constraint(equalTo: artworkView.trailingAnchor, constant: 12),
            titleLabel.topAnchor.constraint(equalTo: centerYAnchor, constant: -16),
            artistLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            artistLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: playButton.leadingAnchor, constant: -12),
            artistLabel.trailingAnchor.constraint(lessThanOrEqualTo: playButton.leadingAnchor, constant: -12),
        ])
        playButton.translatesAutoresizingMaskIntoConstraints = false
        nextButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            nextButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            nextButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            playButton.trailingAnchor.constraint(equalTo: nextButton.leadingAnchor, constant: -8),
            playButton.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressLeading = progressView.leadingAnchor.constraint(equalTo: leadingAnchor)
        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: topAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 2),
        ])
    }

    func update(title: String, artist: String, artworkURL: URL?, progress: Float, playing: Bool) {
        titleLabel.text = title
        artistLabel.text = artist
        if let url = artworkURL {
            // Artwork comes from the same URL the web view uses — loaded off the main queue.
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let data, let image = UIImage(data: data) else { return }
                DispatchQueue.main.async { self?.artworkView.image = image }
            }.resume()
        }
        setProgress(progress)
        setPlayingIcon(playing)
    }

    func setProgress(_ progress: Float) {
        // Recompute the hairline width directly — no constraint juggling, no Float/CGFloat trap.
        let clamped = CGFloat(max(0, min(1, progress)))
        progressView.frame = CGRect(x: 0, y: 0, width: bounds.width * clamped, height: 2)
    }

    func setDuration(_ duration: Float) {
        // Stored for the progress sync's denominator via the plugin.
        self.duration = duration
    }

    /// Swap the underlying material: genuine UIGlassEffect on iOS 26+, system blur below.
    func replaceEffect(visualEffect: UIVisualEffect?) {
        effectView.effect = visualEffect ?? UIBlurEffect(style: .systemChromeMaterial)
        glassApplied = visualEffect != nil
    }

    func setPlayingIcon(_ playing: Bool) {
        let config = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        playButton.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: config), for: .normal)
    }

    @objc private func playPauseTapped() { onPlayPause?() }
    @objc private func nextTapped() { onNext?() }
}
