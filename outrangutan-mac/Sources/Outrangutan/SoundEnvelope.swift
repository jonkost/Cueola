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
    /// The stretch of the file the map covers, in seconds; `end` is
    /// infinite when it was read to the end of the file.
    let start: Double
    let end: Double

    private init(left: [Float], right: [Float], start: Double, end: Double) {
        self.left = left
        self.right = right
        self.start = start
        self.end = end
    }

    /// True when the map covers a cue's trim (`to` nil means to the end).
    func covers(from: Double, to: Double?) -> Bool {
        from >= start - 0.001 && (to ?? .infinity) <= end + 0.001
    }

    /// The loudest sample around a moment in the file, each side, 0 to 1.
    func level(at seconds: Double) -> (Float, Float) {
        guard seconds.isFinite else { return (0, 0) }
        let i = Int((seconds - start) * Self.perSecond)
        guard i >= 0, i < left.count else { return (0, 0) }
        return (left[i], right[i])
    }

    /// Reads a file's sound at a low rate (the peaks survive), only between
    /// `from` and `to` seconds (`to` nil reads to the end). The first two
    /// channels are the sides; a mono file shows on both. Each reading is
    /// placed by its time in the file, so a trimmed map still lines up.
    static func read(_ url: URL, from: Double = 0, to: Double? = nil) async -> SoundEnvelope? {
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
        let start = max(0, min(from, length.seconds))
        let stop = min(to ?? length.seconds, length.seconds)
        guard stop > start else { return nil }
        reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600),
                                       end: CMTime(seconds: stop, preferredTimescale: 600))
        guard reader.startReading() else { return nil }
        let perBucket = max(1, Int(rate / perSecond))
        let buckets = Int((stop - start) * perSecond) + 1
        var l = [Float](repeating: 0, count: buckets)
        var r = l
        var frame = 0
        while let sample = out.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
            // Where this chunk sits in the file: the reader may begin a
            // little before `start`, on a packet boundary.
            let at = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            if at.isFinite { frame = Int(((at - start) * rate).rounded()) }
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
                defer { i += channels; frame += 1 }
                guard frame >= 0 else { continue }     // before `start`
                let b = min(buckets - 1, frame / perBucket)
                let a = abs(floats[i])
                let c = channels > 1 ? abs(floats[i + 1]) : a
                if a > l[b] { l[b] = a }
                if c > r[b] { r[b] = c }
            }
        }
        // Read to the end of the file: the map covers any trim out point.
        return SoundEnvelope(left: l, right: r, start: start, end: stop >= length.seconds ? .infinity : stop)
    }
}
