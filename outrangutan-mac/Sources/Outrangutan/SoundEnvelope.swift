import AVFoundation

/// The level of a sound file over time, read once in the background, so the
/// cue meter can show a clip's level without listening in on the player.
///
/// A listener on the player's own sound path (Apple's audio tap) made every
/// clip start late and rough: with it on from the first frame the picture
/// took a quarter second to move instead of a tenth, and put on after the
/// start it dropped frames for half a second. So the meter reads this map
/// at the playhead instead, times the fader. Fifty readings a second, each
/// side. (The cue sound engine's channel pairs still use the listener; they
/// need the sound itself.)
final class SoundEnvelope {
    static let perSecond = 50.0
    private let left: [Float]
    private let right: [Float]

    private init(left: [Float], right: [Float]) {
        self.left = left
        self.right = right
    }

    /// The loudest sample around a moment in the file, each side, 0 to 1.
    func level(at seconds: Double) -> (Float, Float) {
        guard seconds.isFinite else { return (0, 0) }
        let i = Int(seconds * Self.perSecond)
        guard i >= 0, i < left.count else { return (0, 0) }
        return (left[i], right[i])
    }

    /// Reads a file's sound at a low rate (the peaks survive). The first two
    /// channels are the sides; a mono file shows on both.
    static func read(_ url: URL) async -> SoundEnvelope? {
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
              let length = try? await asset.load(.duration), length.seconds > 0,
              let reader = try? AVAssetReader(asset: asset) else { return nil }
        let rate = 8000.0
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32,
                                       AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
                                       AVSampleRateKey: rate]
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        reader.add(out)
        guard reader.startReading() else { return nil }
        let perBucket = max(1, Int(rate / perSecond))
        let buckets = Int(length.seconds * perSecond) + 1
        var l = [Float](repeating: 0, count: buckets)
        var r = l
        var frame = 0
        while let sample = out.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
            let channels = Int(CMSampleBufferGetFormatDescription(sample).flatMap {
                CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee.mChannelsPerFrame
            } ?? 1)
            guard channels > 0 else { continue }
            // Copy the samples out: a block buffer can come in pieces.
            let count = CMBlockBufferGetDataLength(block) / MemoryLayout<Float>.size
            guard count > 0 else { continue }
            var floats = [Float](repeating: 0, count: count)
            let status = floats.withUnsafeMutableBytes {
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count * MemoryLayout<Float>.size, destination: $0.baseAddress!)
            }
            guard status == noErr else { continue }
            var i = 0
            while i + channels <= count {
                let b = min(buckets - 1, frame / perBucket)
                let a = abs(floats[i])
                let c = channels > 1 ? abs(floats[i + 1]) : a
                if a > l[b] { l[b] = a }
                if c > r[b] { r[b] = c }
                i += channels
                frame += 1
            }
        }
        return SoundEnvelope(left: l, right: r)
    }
}
