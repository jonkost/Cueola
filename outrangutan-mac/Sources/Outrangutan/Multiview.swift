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
    private var endToken: NSObjectProtocol?

    init() {
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = false
    }

    /// Loads the standby cue. The same file again only refreshes its
    /// framing and name, so a slider drag in the Inspector does not reload.
    func show(_ cue: Cue?) {
        if let cue, let old = self.cue, cue.id == old.id, cue.path == old.path, cue.kind == old.kind,
           cue.trimIn == old.trimIn, cue.trimOut == old.trimOut {
            self.cue = cue
            caption = cue.name
            surface.picture.restyle(cue.kind.holds ? .s1 : .a, cue)
            return
        }
        stopRoll()
        self.cue = cue
        surface.clear()
        guard let cue else {
            player.replaceCurrentItem(with: nil)
            caption = "Nothing on standby"
            return
        }
        caption = cue.name
        switch cue.kind {
        case .video:
            player.replaceCurrentItem(with: AVPlayerItem(url: cue.url))
            player.seek(to: CMTime(seconds: cue.trimIn, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            surface.picture.showVideo(player, in: .a, cue: cue, opacity: 1)
        case .still:
            player.replaceCurrentItem(with: nil)
            surface.picture.showStill(NSImage(contentsOf: cue.url), in: .s1, cue: cue, opacity: 1)
        case .matte:
            player.replaceCurrentItem(with: nil)
            surface.picture.showStill(nil, in: .s1, cue: cue, opacity: 1)
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
        guard let item = player.currentItem else { return }
        rolling = true
        let start = CMTime(seconds: cue.trimIn, preferredTimescale: 600)
        let back: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in self?.player.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero) }
        }
        if let out = cue.trimOut, out > cue.trimIn {
            let at = NSValue(time: CMTime(seconds: out, preferredTimescale: 600))
            loopToken = player.addBoundaryTimeObserver(forTimes: [at], queue: .main, using: back)
        }
        // The end of the file also goes round: a trim out past the end, or
        // no trim out at all, must not leave the roll stuck on the last frame.
        player.actionAtItemEnd = .none
        endToken = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in back() }
        player.play()
    }

    private func stopRoll() {
        guard rolling else { return }
        rolling = false
        player.pause()
        player.actionAtItemEnd = .pause
        if let loopToken { player.removeTimeObserver(loopToken) }
        loopToken = nil
        if let endToken { NotificationCenter.default.removeObserver(endToken) }
        endToken = nil
        if let cue { player.seek(to: CMTime(seconds: cue.trimIn, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
    }

    /// Where the preview video is, in seconds, rounded to a tenth; for test mode.
    var seconds: Double {
        let t = player.currentTime().seconds
        return t.isFinite ? (t * 10).rounded() / 10 : 0
    }

    /// What the preview holds, for test mode.
    var describe: String {
        guard let cue else { return "empty" }
        let t = player.currentTime().seconds
        return "\(cue.name) (\(cue.kind)) \(surface.showing)\(cue.kind == .video ? String(format: " at %.1f s, %@", t.isFinite ? t : 0, rolling ? "rolling" : "parked") : "")"
    }
}

/// The preview picture: an output view, so a cue's fit, scale and position
/// look exactly as they will on air, plus a symbol for sound cues.
final class PreviewSurface: NSView {
    let picture = OutputView()
    private let symbol = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        picture.frame = bounds
        picture.autoresizingMask = [.width, .height]
        addSubview(picture)
        symbol.contentsGravity = .center
        symbol.isHidden = true
        symbol.actions = ["contents": NSNull(), "hidden": NSNull(), "bounds": NSNull(), "position": NSNull()]
        layer?.addSublayer(symbol)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        symbol.frame = bounds
        symbol.contentsScale = window?.backingScaleFactor ?? 2
    }

    /// What is showing, for test mode.
    var showing: String {
        if !symbol.isHidden { return "sound" }
        let slots = picture.visibleSlots
        if slots.isEmpty { return "nothing" }
        return slots.contains(.a) ? "video" : "picture"
    }

    func clear() { picture.black(); symbol.isHidden = true }

    func showSymbol(_ name: String) {
        let config = NSImage.SymbolConfiguration(pointSize: 96, weight: .regular)
        symbol.contents = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(config)?.cgImage(forProposedRect: nil, context: nil, hints: nil)
        symbol.isHidden = false
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
                    } corner: { EmptyView() }
                    box(title: "PREVIEW", name: preview.caption, tally: engine.standbyCue == nil ? nil : .green, unit: unit) {
                        PreviewBox(view: preview.surface)
                    } corner: { rollButton(unit) }
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
        // A closed window holds no file open and rolls nothing.
        .onDisappear { preview.show(nil) }
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
    private func box<Content: View, Corner: View>(title: String, name: String, tally: Color?, unit: CGFloat,
                                                  @ViewBuilder content: () -> Content, @ViewBuilder corner: () -> Corner) -> some View {
        VStack(spacing: unit * 0.4) {
            content()
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: unit * 0.5))
                .overlay(RoundedRectangle(cornerRadius: unit * 0.5).strokeBorder(tally ?? Color.white.opacity(0.15), lineWidth: tally == nil ? 1 : unit * 0.35))
                .overlay(alignment: .topTrailing) { corner() }
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
                .glassButton(tint: .green)
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
                TimelineView(.periodic(from: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970)), by: 1)) { context in
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
