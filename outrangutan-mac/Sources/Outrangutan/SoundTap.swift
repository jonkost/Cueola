import Accelerate
import AVFoundation
import MediaToolbox

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

/// Listens to a cue's sound as it plays, for the meter, without changing
/// it. It hangs a small listener on the player's sound path (Apple's audio
/// processing tap); the sound itself goes out exactly as before.
enum SoundTap {
    static func attach(to item: AVPlayerItem, box: PeakBox) async {
        guard let track = try? await item.asset.loadTracks(withMediaType: .audio).first else { return }
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(box).toOpaque()),
            init: { _, clientInfo, storage in storage.pointee = clientInfo },
            finalize: { tap in
                Unmanaged<PeakBox>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
            },
            prepare: nil,
            unprepare: nil,
            process: { tap, frames, _, buffers, framesOut, flagsOut in
                guard MTAudioProcessingTapGetSourceAudio(tap, frames, buffers, flagsOut, nil, framesOut) == noErr else { return }
                let box = Unmanaged<PeakBox>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                // The tap hands over 32-bit float sound, one buffer per side.
                var peaks: [Float] = []
                for buffer in UnsafeMutableAudioBufferListPointer(buffers) {
                    guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                    var peak: Float = 0
                    vDSP_maxmgv(data, 1, &peak, vDSP_Length(Int(buffer.mDataByteSize) / MemoryLayout<Float>.size))
                    peaks.append(peak)
                }
                if let l = peaks.first { box.store(l, peaks.count > 1 ? peaks[1] : l) }
            })
        var tap: MTAudioProcessingTap?
        guard MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap) == noErr,
              let tap else {
            Unmanaged<PeakBox>.fromOpaque(callbacks.clientInfo!).release()
            return
        }
        let params = AVMutableAudioMixInputParameters(track: track)
        params.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [params]
        await MainActor.run { item.audioMix = mix }
    }
}
