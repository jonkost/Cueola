import Accelerate
import AVFoundation
import MediaToolbox
import OutrangutanCore

/// The loudest sample seen since the meter last looked, per side. Written
/// on the sound thread, read on the main thread.
final class PeakBox {
    private let lock = NSLock()
    private var left: Float = 0
    private var right: Float = 0

    func store(_ l: Float, _ r: Float) {
        lock.lock()
        left = max(left, l); right = max(right, r)
        lock.unlock()
    }

    /// The peaks since the last read, then starts over.
    func take() -> (Float, Float) {
        lock.lock(); defer { lock.unlock() }
        let out = (left, right)
        left = 0; right = 0
        return out
    }
}

/// What one listener carries: the meter box, and, when the cue plays
/// through the cue sound engine, the lane it feeds plus the scratch space
/// for turning the player's sound into the lane's 48 kHz stereo. All of it
/// is made before the sound starts, so the sound thread allocates nothing.
private final class TapContext {
    let box: PeakBox
    let lane: SoundLane?
    var frames = 0                          // most frames per call
    var left: UnsafeMutablePointer<Float>?  // downmixed sound, one call's worth
    var right: UnsafeMutablePointer<Float>?
    var converter: AVAudioConverter?        // only when the file is not 48 kHz
    var inBuffer: AVAudioPCMBuffer?
    var outBuffer: AVAudioPCMBuffer?

    init(box: PeakBox, lane: SoundLane?) {
        self.box = box
        self.lane = lane
    }

    func prepare(maxFrames: Int, format: AVAudioFormat) {
        guard lane != nil else { return }
        frames = maxFrames
        left = .allocate(capacity: maxFrames)
        right = .allocate(capacity: maxFrames)
        let rate = format.sampleRate
        if rate != SoundLane.format.sampleRate, rate > 0,
           let from = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2),
           let conv = AVAudioConverter(from: from, to: SoundLane.format) {
            converter = conv
            inBuffer = AVAudioPCMBuffer(pcmFormat: from, frameCapacity: AVAudioFrameCount(maxFrames))
            let outFrames = Int(Double(maxFrames) * SoundLane.format.sampleRate / rate) + 64
            outBuffer = AVAudioPCMBuffer(pcmFormat: SoundLane.format, frameCapacity: AVAudioFrameCount(outFrames))
        }
    }

    func unprepare() {
        left?.deallocate(); right?.deallocate()
        left = nil; right = nil
        converter = nil; inBuffer = nil; outBuffer = nil
    }

    /// Hands one call's sound to the lane, as 48 kHz stereo, stamped with
    /// the file frame (at the lane's rate) its first sample belongs to.
    func feed(_ buffers: UnsafeMutableAudioBufferListPointer, frames n: Int, interleaved: Bool, at frame: Int) {
        guard let lane, let left, let right, n > 0, n <= frames else { return }
        if interleaved, let first = buffers.first, let data = first.mData?.assumingMemoryBound(to: Float.self) {
            // One buffer with the channels side by side: pick out the first two.
            let stride = vDSP_Length(first.mNumberChannels)
            vDSP_mmov(data, left, 1, vDSP_Length(n), stride, 1)
            if first.mNumberChannels > 1 {
                vDSP_mmov(data.advanced(by: 1), right, 1, vDSP_Length(n), stride, 1)
            } else {
                right.update(from: left, count: n)
            }
        } else {
            var channels: [UnsafePointer<Float>] = []
            for b in buffers { if let d = b.mData?.assumingMemoryBound(to: Float.self) { channels.append(UnsafePointer(d)) } }
            Downmix.stereo(channels: channels, frames: n, left: left, right: right)
        }
        guard let converter, let inBuffer, let outBuffer else {
            lane.ring.push(left: left, right: right, frames: n, at: frame)
            return
        }
        inBuffer.floatChannelData?[0].update(from: left, count: n)
        inBuffer.floatChannelData?[1].update(from: right, count: n)
        inBuffer.frameLength = AVAudioFrameCount(n)
        outBuffer.frameLength = 0
        var given = false
        var error: NSError?
        converter.convert(to: outBuffer, error: &error) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return inBuffer
        }
        let out = Int(outBuffer.frameLength)
        if out > 0, let l = outBuffer.floatChannelData?[0], let r = outBuffer.floatChannelData?[1] {
            lane.ring.push(left: l, right: r, frames: out, at: frame)
        }
    }
}

/// Listens to a cue's sound as it plays, for the meter, without changing
/// it. It hangs a small listener on the player's sound path (Apple's audio
/// processing tap); the sound itself goes out exactly as before.
///
/// Given a lane, the same listener also hands the sound to the cue sound
/// engine, for playing on a chosen channel pair; the player itself is then
/// muted by the deck.
enum SoundTap {
    static func attach(to item: AVPlayerItem, box: PeakBox, lane: SoundLane? = nil) async {
        guard let track = try? await item.asset.loadTracks(withMediaType: .audio).first else { return }
        let context = TapContext(box: box, lane: lane)
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(context).toOpaque()),
            init: { _, clientInfo, storage in storage.pointee = clientInfo },
            finalize: { tap in
                Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
            },
            prepare: { tap, maxFrames, format in
                let context = Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                var asbd = format.pointee
                if let f = AVAudioFormat(streamDescription: &asbd) { context.prepare(maxFrames: Int(maxFrames), format: f) }
            },
            unprepare: { tap in
                Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().unprepare()
            },
            process: { tap, frames, _, buffers, framesOut, flagsOut in
                // The time range says where in the file this sound belongs.
                var range = CMTimeRange.invalid
                guard MTAudioProcessingTapGetSourceAudio(tap, frames, buffers, flagsOut, &range, framesOut) == noErr else { return }
                let context = Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                let list = UnsafeMutableAudioBufferListPointer(buffers)
                // The tap hands over 32-bit float sound, one buffer per side.
                // Two numbers, no arrays: nothing is allocated on the sound thread.
                var left: Float = -1, right: Float = -1
                for buffer in list {
                    guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                    var peak: Float = 0
                    vDSP_maxmgv(data, 1, &peak, vDSP_Length(Int(buffer.mDataByteSize) / MemoryLayout<Float>.size))
                    if left < 0 { left = peak } else if right < 0 { right = peak }
                }
                if left >= 0 { context.box.store(left, right >= 0 ? right : left) }
                if context.lane != nil {
                    let interleaved = list.count == 1 && (list.first?.mNumberChannels ?? 1) > 1
                    let start = range.start.isNumeric ? range.start.seconds : 0
                    context.feed(list, frames: Int(framesOut.pointee), interleaved: interleaved,
                                 at: Int((start * SoundLane.format.sampleRate).rounded(.down)))
                }
            })
        var tap: MTAudioProcessingTap?
        guard MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap) == noErr,
              let tap else {
            Unmanaged<TapContext>.fromOpaque(callbacks.clientInfo!).release()
            return
        }
        let params = AVMutableAudioMixInputParameters(track: track)
        params.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [params]
        await MainActor.run { item.audioMix = mix }
    }
}
