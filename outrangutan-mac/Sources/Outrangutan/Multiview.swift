import AppKit
import AVFoundation
import Combine
import OutrangutanCore
import SwiftUI

/// The Preview box of the Multiview: shows the standby cue before it goes
/// to air. A video sits on its first frame (its trim in point) and can
/// roll, silently, in a loop between its trim points. A still or a matte
/// shows as it is; a sound cue shows its name.
@MainActor
final class PreviewPlayer: ObservableObject {
    let surface = PreviewSurface()
    @Published private(set) var rolling = false
    @Published private(set) var caption = "Nothing on standby"
    private let player = AVPlayer()
    private var cue: Cue?
    private var loopToken: Any?

    init() {
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = false
        surface.video.player = player
    }

    /// Loads the standby cue. The same cue again is left as it is.
    func show(_ cue: Cue?) {
        if cue?.id == self.cue?.id && cue?.trimIn == self.cue?.trimIn && cue?.trimOut == self.cue?.trimOut
            && cue?.path == self.cue?.path && cue?.color == self.cue?.color { return }
        stopRoll()
        self.cue = cue
        guard let cue else {
            player.replaceCurrentItem(with: nil)
            surface.clear()
            caption = "Nothing on standby"
            return
        }
        caption = cue.name
        switch cue.kind {
        case .video:
            player.replaceCurrentItem(with: AVPlayerItem(url: cue.url))
            player.seek(to: CMTime(seconds: cue.trimIn, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            surface.showVideo()
        case .still:
            player.replaceCurrentItem(with: nil)
            surface.showImage(NSImage(contentsOf: cue.url))
        case .matte:
            player.replaceCurrentItem(with: nil)
            surface.showColor(Self.color(cue.color))
        case .audio:
            player.replaceCurrentItem(with: nil)
            surface.showSymbol("speaker.wave.2.fill")
        }
    }

    /// Rolls the video in the preview box, silent, round and round between
    /// its trim points; again to stop and go back to the first frame.
    func toggleRoll() {
        guard let cue, cue.kind == .video else { return }
        if rolling { stopRoll(); return }
        rolling = true
        let start = CMTime(seconds: cue.trimIn, preferredTimescale: 600)
        if let out = cue.trimOut, out > cue.trimIn {
            let at = NSValue(time: CMTime(seconds: out, preferredTimescale: 600))
            loopToken = player.addBoundaryTimeObserver(forTimes: [at], queue: .main) { [weak self] in
                self?.player.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero)
            }
        } else {
            player.actionAtItemEnd = .none
            NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: player.currentItem, queue: .main) { [weak self] _ in
                self?.player.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero)
            }
        }
        player.play()
    }

    private func stopRoll() {
        guard rolling else { return }
        rolling = false
        player.pause()
        if let loopToken { player.removeTimeObserver(loopToken) }
        loopToken = nil
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)
        if let cue { player.seek(to: CMTime(seconds: cue.trimIn, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
    }

    /// What the preview holds, for test mode.
    var describe: String {
        guard let cue else { return "empty" }
        let t = player.currentTime().seconds
        return "\(cue.name) (\(cue.kind)) \(surface.showing)\(cue.kind == .video ? String(format: " at %.1f s, %@", t.isFinite ? t : 0, rolling ? "rolling" : "parked") : "")"
    }

    static func color(_ hex: String) -> NSColor {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return .black }
        return NSColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

/// The preview picture: a video layer, an image layer and a color, one
/// showing at a time.
final class PreviewSurface: NSView {
    let video = AVPlayerLayer()
    private let image = CALayer()
    private let symbol = CALayer()
    private(set) var showing = "nothing"

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        video.videoGravity = .resizeAspect
        image.contentsGravity = .resizeAspect
        symbol.contentsGravity = .center
        for l in [video, image, symbol] {
            l.isHidden = true
            l.actions = ["contents": NSNull(), "hidden": NSNull(), "bounds": NSNull(), "position": NSNull(), "backgroundColor": NSNull()]
            layer?.addSublayer(l)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        for l in [video, image, symbol] { l.frame = bounds }
        symbol.contentsScale = window?.backingScaleFactor ?? 2
    }

    func clear() { hideAll(); layer?.backgroundColor = NSColor.black.cgColor; showing = "nothing" }
    func showVideo() { hideAll(); video.isHidden = false; showing = "video" }
    func showImage(_ img: NSImage?) {
        hideAll()
        image.contents = img.flatMap { $0.cgImage(forProposedRect: nil, context: nil, hints: nil) }
        image.isHidden = false
        showing = img == nil ? "missing image" : "image"
    }
    func showColor(_ color: NSColor) { hideAll(); layer?.backgroundColor = color.cgColor; showing = "color" }
    func showSymbol(_ name: String) {
        hideAll()
        let config = NSImage.SymbolConfiguration(pointSize: 96, weight: .regular)
        symbol.contents = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(config)?.cgImage(forProposedRect: nil, context: nil, hints: nil)
        symbol.isHidden = false
        showing = "sound"
    }
    private func hideAll() {
        layer?.backgroundColor = NSColor.black.cgColor
        for l in [video, image, symbol] { l.isHidden = true }
    }
}

struct PreviewBox: NSViewRepresentable {
    let view: PreviewSurface
    func makeNSView(context: Context) -> PreviewSurface { view }
    func updateNSView(_ nsView: PreviewSurface, context: Context) {}
}

/// The Multiview: a monitor-wall window for the director's screen.
/// Program on the left with a red tally while something is on air, the
/// standby cue on the right with a green tally, the count-out clock, and
/// the next cues. Full screen with the green button, on any screen.
struct MultiviewView: View {
    @ObservedObject var engine: Engine
    @ObservedObject var preview: PreviewPlayer

    var body: some View {
        GeometryReader { geo in
            let unit = max(8, geo.size.width / 100)
            VStack(spacing: unit) {
                HStack(spacing: unit) {
                    box(title: "PROGRAM", name: onAirName, tally: onAir ? .red : nil, unit: unit) {
                        ProgramPreview(view: engine.multiviewProgram)
                    }
                    box(title: "PREVIEW", name: preview.caption, tally: engine.standbyCue == nil ? nil : .green, unit: unit) {
                        PreviewBox(view: preview.surface)
                    }
                    .overlay(alignment: .topTrailing) { rollButton(unit) }
                }
                HStack(alignment: .top, spacing: unit) {
                    clock(unit)
                    nextCues(unit)
                }
                .frame(height: geo.size.height * 0.34)
            }
            .padding(unit)
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
        .onAppear { preview.show(engine.standbyCue) }
        .onChange(of: engine.standbyID) { _, _ in preview.show(engine.standbyCue) }
        .onChange(of: engine.cues) { _, _ in preview.show(engine.standbyCue) }
    }

    private var onAir: Bool { engine.pictureCue != nil || engine.soundCue != nil }

    private var onAirName: String {
        switch engine.status {
        case .pre: return "Pre-wait: \(engine.pendingCue?.name ?? "")"
        default:
            let names = [engine.pictureCue?.name, engine.soundCue?.name].compactMap { $0 }
            return names.isEmpty ? "Black" : names.joined(separator: " + ")
        }
    }

    @ViewBuilder
    private func box<Content: View>(title: String, name: String, tally: Color?, unit: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: unit * 0.4) {
            content()
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(RoundedRectangle(cornerRadius: unit * 0.5).stroke(tally ?? Color.white.opacity(0.15), lineWidth: tally == nil ? 1 : unit * 0.35))
                .clipShape(RoundedRectangle(cornerRadius: unit * 0.5))
            HStack(spacing: unit * 0.6) {
                Text(title)
                    .font(.system(size: unit * 1.6, weight: .bold))
                    .foregroundStyle(tally ?? .secondary)
                Text(name)
                    .font(.system(size: unit * 1.6, weight: .medium))
                    .lineLimit(1)
                    .foregroundStyle(.white)
                Spacer()
            }
        }
    }

    @ViewBuilder
    private func rollButton(_ unit: CGFloat) -> some View {
        if engine.standbyCue?.kind == .video {
            Button(preview.rolling ? "Stop" : "Roll") { preview.toggleRoll() }
                .font(.system(size: unit * 1.3, weight: .semibold))
                .buttonStyle(.bordered)
                .tint(.green)
                .padding(unit * 0.8)
        }
    }

    private func clock(_ unit: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: unit * 0.3) {
            Text(clockText)
                .font(.system(size: unit * 9, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(clockColor)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
            HStack(spacing: unit) {
                Text(engine.status.rawValue)
                    .font(.system(size: unit * 2, weight: .bold))
                    .foregroundStyle(clockColor)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(context.date, format: .dateTime.hour().minute().second())
                        .font(.system(size: unit * 2, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var clockText: String {
        if engine.status == .pre, let p = engine.preRemaining { return Timecode.dropFrame(p) }
        if let r = engine.remaining { return Timecode.dropFrame(r) }
        return "00:00:00;00"
    }

    private var clockColor: Color {
        switch engine.status {
        case .ready: return .secondary
        case .paused: return .yellow
        default: return Color(red: 1, green: 0.3, blue: 0.25)
        }
    }

    /// The standby cue and the three after it.
    private var upcoming: [Cue] {
        guard let i = engine.cues.firstIndex(where: { $0.id == engine.standbyID }) else { return Array(engine.cues.prefix(4)) }
        return Array(engine.cues[i..<min(engine.cues.count, i + 4)])
    }

    private func nextCues(_ unit: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: unit * 0.5) {
            Text("NEXT")
                .font(.system(size: unit * 1.6, weight: .bold))
                .foregroundStyle(.secondary)
            ForEach(Array(upcoming.enumerated()), id: \.element.id) { i, cue in
                HStack(spacing: unit * 0.6) {
                    Image(systemName: cue.kind.symbol)
                        .font(.system(size: unit * 1.5))
                        .foregroundStyle(i == 0 ? .green : .secondary)
                        .frame(width: unit * 2)
                    Text(cue.name)
                        .font(.system(size: unit * 1.7, weight: i == 0 ? .semibold : .regular))
                        .foregroundStyle(i == 0 ? .white : .secondary)
                        .lineLimit(1)
                    Spacer()
                    if let d = engine.durations[cue.id] ?? (cue.kind.holds && cue.duration > 0 ? cue.duration : nil) {
                        Text(Timecode.dropFrame(max(0, (cue.trimOut ?? d) - cue.trimIn)))
                            .font(.system(size: unit * 1.5))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if engine.cues.isEmpty {
                Text("No cues")
                    .font(.system(size: unit * 1.7))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: unit * 34, alignment: .leading)
    }
}

/// Window menu: opens the Multiview.
struct OpenMultiviewButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Multiview") { openWindow(id: "multiview") }
            .keyboardShortcut("m", modifiers: [.command, .shift])
    }
}
