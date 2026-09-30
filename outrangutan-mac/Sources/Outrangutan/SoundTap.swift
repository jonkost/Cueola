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
    var feedInput: AVAudioConverterInputBlock?
    var given = false                       // the converter has had this call's sound
    var inputRate: Double = 0
    /// On the resampled path the stamps run on their own count, because the
    /// converter's output does not land on the input chunk's exact frame.
    var nextInStamp: Int?                   // where the next input chunk should start
    var outStamp = 0                        // the file frame of the next output frame
    /// A chunk landing this far from where the last ended is a seek.
    static let seekTolerance = 12000

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
        inputRate = rate
        nextInStamp = nil
        if rate != SoundLane.format.sampleRate, rate > 0,
           let from = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2),
           let conv = AVAudioConverter(from: from, to: SoundLane.format) {
            converter = conv
            let input = AVAudioPCMBuffer(pcmFormat: from, frameCapacity: AVAudioFrameCount(maxFrames))
            inBuffer = input
            let outFrames = Int(Double(maxFrames) * SoundLane.format.sampleRate / rate) + 64
            outBuffer = AVAudioPCMBuffer(pcmFormat: SoundLane.format, frameCapacity: AVAudioFrameCount(outFrames))
            // Made once here, not on every call on the sound thread.
            feedInput = { [unowned self] _, status in
                if self.given { status.pointee = .noDataNow; return nil }
                self.given = true
                status.pointee = .haveData
                return input
            }
        }
    }

    func unprepare() {
        left?.deallocate(); right?.deallocate()
        left = nil; right = nil
        converter = nil; inBuffer = nil; outBuffer = nil; feedInput = nil
    }

    /// Hands one call's sound to the lane, as 48 kHz stereo, stamped with
    /// the file frame (at the lane's rate) its first sample belongs to.
    func feed(_ buffers: UnsafeMutableAudioBufferListPointer, frames n: Int, interleaved: Bool, at frame: Int) {
        guard let lane, let left, let right, n > 0, n <= frames, buffers.count > 0,
              let first = buffers[0].mData?.assumingMemoryBound(to: Float.self) else { return }
        if interleaved {
            // One buffer with the channels side by side: pick out the first two.
            let stride = vDSP_Length(buffers[0].mNumberChannels)
            vDSP_mmov(first, left, 1, vDSP_Length(n), stride, 1)
            if buffers[0].mNumberChannels > 1 {
                vDSP_mmov(first.advanced(by: 1), right, 1, vDSP_Length(n), stride, 1)
            } else {
                right.update(from: left, count: n)
            }
        } else {
            let second = buffers.count > 1 ? buffers[1].mData?.assumingMemoryBound(to: Float.self) : nil
            Downmix.stereo(first: first, second: second, frames: n, left: left, right: right)
        }
        guard let converter, let inBuffer, let outBuffer, let feedInput else {
            lane.ring.push(left: left, right: right, frames: n, at: frame)
            return
        }
        // A jump in the input stamps is a seek: the converter starts fresh
        // and the output count starts at the new place.
        if let expected = nextInStamp, abs(frame - expected) <= Self.seekTolerance {
            // Carry on counting.
        } else {
            converter.reset()
            outStamp = frame
        }
        nextInStamp = frame + Int((Double(n) * SoundLane.format.sampleRate / inputRate).rounded())
        inBuffer.floatChannelData?[0].update(from: left, count: n)
        inBuffer.floatChannelData?[1].update(from: right, count: n)
        inBuffer.frameLength = AVAudioFrameCount(n)
        outBuffer.frameLength = 0
        given = false
        var error: NSError?
        converter.convert(to: outBuffer, error: &error, withInputFrom: feedInput)
        let out = Int(outBuffer.frameLength)
        if out > 0, let l = outBuffer.floatChannelData?[0], let r = outBuffer.floatChannelData?[1] {
            lane.ring.push(left: l, right: r, frames: out, at: outStamp)
            outStamp += out
        }
    }
}

/// Listens to a cue's sound as it plays, for the meter, without changing
/// it. It hangs a small listener on the player's sound path (Apple's audio
/// processing tap); the sound itself goes out exactly as before.
///
/// Given a lane, the same listener also hands the sound to the cue sound
/// engine, for playing on a chosen channel pair; the player's own sound is
/// then turned down to nothing by the deck.
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
                    let interleaved = list.count == 1 && list[0].mNumberChannels > 1
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
