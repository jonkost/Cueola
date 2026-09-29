import AppKit
import AVFoundation
import SwiftUI

/// The pictures behind the trim bar: a strip of frames for a video and the
/// sound's wave, read in the background once per file and kept.
final class MediaStrips: ObservableObject {
    static let shared = MediaStrips()
    static let buckets = 240
    static let frameCount = 8

    @Published private(set) var waves: [String: [Float]] = [:]
    @Published private(set) var frames: [String: [NSImage]] = [:]
    private var making: Set<String> = []

    func wave(_ url: URL) -> [Float]? {
        if let w = waves[url.path] { return w }
        start(url)
        return nil
    }

    func strip(_ url: URL) -> [NSImage]? {
        if let f = frames[url.path] { return f }
        start(url)
        return nil
    }

    private func start(_ url: URL) {
        let key = url.path
        guard !making.contains(key) else { return }
        making.insert(key)
        Task.detached(priority: .utility) { [weak self] in
            let asset = AVURLAsset(url: url)
            let wave = await Self.readWave(asset)
            let pictures = await Self.readFrames(asset)
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.waves[key] = wave ?? []
                self.frames[key] = pictures
                self.making.remove(key)
            }
        }
    }

    /// The loudest sample in each of `buckets` equal slices of the sound.
    private static func readWave(_ asset: AVURLAsset) async -> [Float]? {
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
              let length = try? await asset.load(.duration), length.seconds > 0,
              let reader = try? AVAssetReader(asset: asset) else { return nil }
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32,
                                       AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
                                       AVNumberOfChannelsKey: 1, AVSampleRateKey: 8000]
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        reader.add(out)
        guard reader.startReading() else { return nil }
        let total = max(1, Int(length.seconds * 8000))
        var peaks = [Float](repeating: 0, count: buckets)
        var index = 0
        while let sample = out.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
            var size = 0
            var pointer: UnsafeMutablePointer<Int8>?
            guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &size, dataPointerOut: &pointer) == noErr,
                  let raw = pointer else { continue }
            raw.withMemoryRebound(to: Float.self, capacity: size / 4) { floats in
                for i in 0..<(size / 4) {
                    let b = min(buckets - 1, index * buckets / total)
                    peaks[b] = max(peaks[b], abs(floats[i]))
                    index += 1
                }
            }
        }
        let top = max(peaks.max() ?? 1, 0.0001)
        return peaks.map { $0 / top }
    }

    private static func readFrames(_ asset: AVURLAsset) async -> [NSImage] {
        guard (try? await asset.loadTracks(withMediaType: .video).first) != nil,
              let length = try? await asset.load(.duration), length.seconds > 0 else { return [] }
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 120, height: 68)
        gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
        var images: [NSImage] = []
        for i in 0..<frameCount {
            let t = CMTime(seconds: length.seconds * (Double(i) + 0.5) / Double(frameCount), preferredTimescale: 600)
            if let cg = try? await gen.image(at: t).image { images.append(NSImage(cgImage: cg, size: .zero)) }
        }
        return images
    }
}

/// The trim bar: the whole clip, with In and Out handles to drag. The parts
/// that will not play are dimmed.
struct TrimBar: View {
    let url: URL
    let length: Double            // seconds, the whole file
    @Binding var trimIn: Double
    @Binding var trimOut: Double? // nil plays to the end
    @ObservedObject private var strips = MediaStrips.shared

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let inX = x(trimIn, w), outX = x(trimOut ?? length, w)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 5).fill(Color.black.opacity(0.5))
                if let frames = strips.strip(url), !frames.isEmpty {
                    HStack(spacing: 0) {
                        ForEach(frames.indices, id: \.self) { i in
                            Image(nsImage: frames[i]).resizable().aspectRatio(contentMode: .fill)
                                .frame(width: w / CGFloat(frames.count), height: h).clipped()
                        }
                    }
                    .opacity(0.8)
                }
                if let wave = strips.wave(url), !wave.isEmpty {
                    // Over a video's frames the wave keeps to a band along
                    // the bottom; a sound alone gets the whole height.
                    let overPicture = !(strips.strip(url) ?? []).isEmpty
                    let mid = overPicture ? h * 0.8 : h / 2, reach = overPicture ? h * 0.16 : h * 0.42
                    if overPicture {
                        Rectangle().fill(Color.black.opacity(0.45)).frame(width: w, height: h * 0.4).offset(y: h * 0.6)
                    }
                    Path { p in
                        for (i, v) in wave.enumerated() {
                            let px = w * CGFloat(i) / CGFloat(wave.count)
                            let half = max(0.5, CGFloat(v) * reach)
                            p.move(to: CGPoint(x: px, y: mid - half))
                            p.addLine(to: CGPoint(x: px, y: mid + half))
                        }
                    }
                    .stroke(Color.cyan.opacity(0.9), lineWidth: max(1, w / CGFloat(wave.count) * 0.7))
                }
                // Dim what is trimmed away.
                Rectangle().fill(Color.black.opacity(0.6)).frame(width: max(0, inX), height: h)
                Rectangle().fill(Color.black.opacity(0.6)).frame(width: max(0, w - outX), height: h).offset(x: outX)
                RoundedRectangle(cornerRadius: 3).strokeBorder(Color.yellow, lineWidth: 2)
                    .frame(width: max(4, outX - inX), height: h).offset(x: inX)
                handle(at: inX, h: h, maxX: w).gesture(drag(w) { trimIn = min(max(0, $0), (trimOut ?? length) - 0.1) })
                    .help("Drag the start")
                handle(at: outX, h: h, maxX: w).gesture(drag(w) { v in
                    let t = max(v, trimIn + 0.1)
                    trimOut = t >= length - 0.05 ? nil : t
                })
                .help("Drag the end")
            }
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .coordinateSpace(name: "trim")
        }
        .frame(height: 56)
        .accessibilityElement()
        .accessibilityLabel("Trim: plays from \(Int(trimIn)) to \(Int(trimOut ?? length)) seconds")
    }

    private func x(_ t: Double, _ w: CGFloat) -> CGFloat {
        length > 0 ? CGFloat(min(max(0, t), length) / length) * w : 0
    }

    private func handle(at x: CGFloat, h: CGFloat, maxX: CGFloat) -> some View {
        Capsule().fill(Color.yellow)
            .frame(width: 8, height: h * 0.6)
            .overlay(Capsule().strokeBorder(Color.black.opacity(0.4), lineWidth: 1))
            .contentShape(Rectangle().inset(by: -8))
            .offset(x: min(max(0, x - 4), maxX - 8), y: h * 0.2)
    }

    private func drag(_ w: CGFloat, _ set: @escaping (Double) -> Void) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named("trim"))
            .onChanged { v in set(Double(v.location.x / max(1, w)) * length) }
    }
}
