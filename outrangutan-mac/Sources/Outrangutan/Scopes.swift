import AppKit
import CoreImage
import OutrangutanCore
import SwiftUI

/// The waveform and vectorscope for what is on the program picture. They
/// read the picture 15 times a second while they are showing, on a
/// background thread, so they never slow the show down.
final class Scopes: ObservableObject {
    @Published private(set) var waveform: CGImage?
    @Published private(set) var vectorscope: CGImage?

    private weak var engine: Engine?
    private var timer: Timer?
    private var busy = false
    private let queue = DispatchQueue(label: "outrangutan.scopes", qos: .userInitiated)
    private let context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.itur_709)!,
                                              .cacheIntermediates: false])
    static let width = 320, height = 180, vectorSize = 180

    init(engine: Engine) { self.engine = engine }

    /// Scopes run only while they are on screen.
    var isOn = false {
        didSet {
            guard isOn != oldValue else { return }
            engine?.wantsFrames = isOn
            timer?.invalidate()
            timer = nil
            if isOn {
                let t = Timer(timeInterval: 1.0 / 15, repeats: true) { [weak self] _ in self?.tick() }
                RunLoop.main.add(t, forMode: .common)
                timer = t
                tick()
            }
        }
    }

    /// Reads one picture now. Test mode calls this too.
    func tick(done: (() -> Void)? = nil) {
        guard !busy, let engine else { return }
        busy = true
        let frame = engine.programFrame()
        queue.async { [weak self] in
            guard let self else { return }
            let pixels = frame.map(self.render) ?? [UInt8](repeating: 0, count: Self.width * Self.height * 4)
            let wave = ScopeMath.waveform(rgba: pixels, width: Self.width, height: Self.height, columns: Self.width)
            let vec = ScopeMath.vectorscope(rgba: pixels, width: Self.width, height: Self.height, size: Self.vectorSize)
            let waveImage = Self.image(wave, width: Self.width, height: 256, flipped: true, reference: Double(Self.height) / 6)
            let vecImage = Self.image(vec, width: Self.vectorSize, height: Self.vectorSize, flipped: false,
                                      reference: Double(Self.width * Self.height) / 400)
            DispatchQueue.main.async {
                self.waveform = waveImage
                self.vectorscope = vecImage
                self.busy = false
                done?()
            }
        }
    }

    /// The picture, shrunk to the scope's size, as Rec. 709 RGBA bytes.
    private func render(_ image: CIImage) -> [UInt8] {
        let e = image.extent
        guard e.width > 0, e.height > 0, e.width.isFinite else { return [UInt8](repeating: 0, count: Self.width * Self.height * 4) }
        let scaled = image.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .transformed(by: CGAffineTransform(scaleX: CGFloat(Self.width) / e.width, y: CGFloat(Self.height) / e.height))
        var out = [UInt8](repeating: 0, count: Self.width * Self.height * 4)
        context.render(scaled, toBitmap: &out, rowBytes: Self.width * 4,
                       bounds: CGRect(x: 0, y: 0, width: Self.width, height: Self.height),
                       format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.itur_709))
        return out
    }

    /// Counts to a glowing green picture: more pixels, brighter trace.
    private static func image(_ counts: [UInt32], width: Int, height: Int, flipped: Bool, reference: Double) -> CGImage? {
        var px = [UInt8](repeating: 0, count: width * height * 4)
        let top = log2(1 + reference)
        for row in 0..<height {
            let srcRow = flipped ? height - 1 - row : row
            for x in 0..<width {
                let n = counts[srcRow * width + x]
                guard n > 0 else { continue }
                let v = min(1, 0.25 + 0.75 * log2(1 + Double(n)) / top)
                let i = (row * width + x) * 4
                px[i] = UInt8(v * 150); px[i + 1] = UInt8(v * 255); px[i + 2] = UInt8(v * 170); px[i + 3] = 255
            }
        }
        guard let provider = CGDataProvider(data: Data(px) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
}

/// The monitor strip under the transport: the program preview, the
/// waveform and the vectorscope.
struct MonitorStrip: View {
    @ObservedObject var engine: Engine
    @ObservedObject var scopes: Scopes
    @AppStorage("ui.scopes") private var showScopes = true
    /// Every box is this tall: the program and waveform at 16:9, the
    /// vectorscope square, side by side from the left with nothing floating.
    static let boxHeight: CGFloat = 148
    static let wide = boxHeight * 16 / 9

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                ProgramPreview(view: engine.monitor)
                    .frame(width: Self.wide, height: Self.boxHeight)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.35)))
                HStack(spacing: 6) {
                    Circle().fill(engine.pictureCue != nil ? Color.red : Color.secondary.opacity(0.5)).frame(width: 7, height: 7)
                    Text("PROGRAM").font(.caption2.weight(.bold)).foregroundStyle(.secondary).fixedSize()
                    if engine.outputs.count > 1 {
                        Picker("Preview", selection: $engine.monitorOutput) {
                            ForEach(engine.outputs) { Text($0.label).tag($0.id) }
                        }
                        .labelsHidden()
                        .controlSize(.mini)
                        .fixedSize()
                        .help("Which output the preview shows. It picks up from the next cue.")
                    }
                    Spacer()
                    LevelMeterView(meter: engine.cueMeter, label: "SOUND", width: 56)
                        .help("How loud the cues are: videos and sound cues, at their volume. Pads have their own meter.")
                    Toggle(isOn: $showScopes) { Image(systemName: "waveform.path.ecg") }
                        .toggleStyle(.button)
                        .controlSize(.mini)
                        .help(showScopes ? "Hide the scopes" : "Show the waveform and vectorscope")
                }
            }
            .frame(width: Self.wide)
            if showScopes {
                ScopePanel(title: "WAVEFORM", image: scopes.waveform, width: Self.wide, height: Self.boxHeight) { WaveformGrid() }
                ScopePanel(title: "VECTORSCOPE", image: scopes.vectorscope, width: Self.boxHeight, height: Self.boxHeight) { VectorGrid() }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(height: 180)
        .onAppear { scopes.isOn = showScopes }
        .onDisappear { scopes.isOn = false }
        .onChange(of: showScopes) { _, on in scopes.isOn = on }
    }
}

/// The monitor view from the engine, placed in SwiftUI.
struct ProgramPreview: NSViewRepresentable {
    let view: OutputView
    func makeNSView(context: Context) -> OutputView { view }
    func updateNSView(_ nsView: OutputView, context: Context) {}
}

struct ScopePanel<Grid: View>: View {
    let title: String
    let image: CGImage?
    let width: CGFloat
    let height: CGFloat
    @ViewBuilder var grid: Grid

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack {
                Color.black
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.medium)
                }
                grid
            }
            .frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.35)))
            Text(title).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
        }
    }
}

/// Lines at 0, 25, 50, 75 and 100 percent brightness.
struct WaveformGrid: View {
    var body: some View {
        GeometryReader { g in
            ForEach([0, 25, 50, 75, 100], id: \.self) { pct in
                let y = g.size.height * (1 - CGFloat(pct) / 100)
                Path { p in p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: g.size.width, y: y)) }
                    .stroke(Color.white.opacity(pct == 0 || pct == 100 ? 0.35 : 0.15), lineWidth: 1)
                Text("\(pct)").font(.system(size: 8, weight: .medium)).monospacedDigit()
                    .foregroundStyle(.white.opacity(0.5))
                    .position(x: 10, y: min(g.size.height - 6, max(6, y - 6)))
            }
        }
        .allowsHitTesting(false)
    }
}

/// The color wheel's circle, cross, and a box for each color bar.
struct VectorGrid: View {
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            let c = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            Circle().stroke(Color.white.opacity(0.2), lineWidth: 1).frame(width: s * 0.9, height: s * 0.9).position(c)
            Path { p in
                p.move(to: CGPoint(x: c.x - s / 2, y: c.y)); p.addLine(to: CGPoint(x: c.x + s / 2, y: c.y))
                p.move(to: CGPoint(x: c.x, y: c.y - s / 2)); p.addLine(to: CGPoint(x: c.x, y: c.y + s / 2))
            }
            .stroke(Color.white.opacity(0.12), lineWidth: 1)
            ForEach(ScopeMath.barTargets, id: \.name) { t in
                let p = ScopeMath.point(t.r, t.g, t.b, size: 1000)
                let at = CGPoint(x: c.x - s / 2 + s * CGFloat(p.x) / 1000, y: c.y - s / 2 + s * CGFloat(p.y) / 1000)
                Rectangle().stroke(Color(red: t.r / 191, green: t.g / 191, blue: t.b / 191).opacity(0.8), lineWidth: 1)
                    .frame(width: 9, height: 9).position(at)
                Text(t.name).font(.system(size: 7, weight: .bold)).foregroundStyle(.white.opacity(0.55))
                    .position(x: at.x, y: at.y + 11)
            }
        }
        .allowsHitTesting(false)
    }
}
