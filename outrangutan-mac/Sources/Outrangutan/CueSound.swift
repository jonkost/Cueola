import AVFoundation
import OutrangutanCore
import QuartzCore

/// One cue player's line into the cue sound engine: the ring its sound
/// arrives through, the node that reads the ring, and its own volume.
final class SoundLane {
    /// What the ring holds: 48 kHz stereo, 32-bit float.
    static let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    let ring: SoundRing
    /// The player's clock, noted by the deck; says which frames are due.
    let clock: SoundClock
    let node: AVAudioSourceNode
    let gain = AVAudioMixerNode()

    init() {
        let ring = SoundRing()
        let clock = SoundClock(rate: Self.format.sampleRate)
        self.ring = ring
        self.clock = clock
        node = AVAudioSourceNode(format: Self.format) { _, _, frameCount, abl -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(abl)
            guard buffers.count >= 2,
                  let l = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                  let r = buffers[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            // Play what is due by the end of this call.
            let due = clock.dueFrame(host: CACurrentMediaTime()) + Int(frameCount)
            ring.pop(left: l, right: r, frames: Int(frameCount), due: due)
            return noErr
        }
    }
}

/// Plays cue sound on any channel pair of an audio interface.
///
/// A cue's player cannot pick channels on its own: it always plays on a
/// device's first two. So when a pair other than 1 and 2 is picked, the
/// player's own sound is turned all the way down and its sound is handed
/// over, through a lane, to this engine, which places it on the chosen
/// pair the same way the pads' engine does. Each chunk carries where in
/// the file it belongs, and the engine plays only what the player's clock
/// says is due, so the sound keeps step with the picture (within about a
/// frame in the test), holds through a pause, and stops with the player.
///
/// With pair 1 and 2 picked the engine is off and cues play straight from
/// their players, with no delay at all.
final class CueSoundEngine {
    /// One lane per player: video A and B, sound A and B.
    let lanes: [SoundLane]
    /// True while a pair other than 1 and 2 is picked.
    private(set) var isOn = false
    /// Where cue sound is going, in words, for Settings and Show Check.
    private(set) var note = ""
    private let audio = AVAudioEngine()

    init(laneCount: Int = 4) {
        lanes = (0..<laneCount).map { _ in SoundLane() }
        // Every lane is wired before the engine ever runs, so nothing is
        // added to a running engine (that leaves nodes half connected).
        for lane in lanes {
            audio.attach(lane.node)
            audio.attach(lane.gain)
            audio.connect(lane.node, to: lane.gain, format: SoundLane.format)
            audio.connect(lane.gain, to: audio.mainMixerNode, fromBus: 0,
                          toBus: audio.mainMixerNode.nextAvailableInputBus, format: SoundLane.format)
        }
        // Test mode never makes a sound. The lanes still carry it.
        if TestSnapshot.isOn { audio.mainMixerNode.outputVolume = 0 }
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
            guard let self, self.isOn else { return }
            self.start()
        }
    }

    /// Sends cue sound to a device on a chosen pair (0 is channels 1 and 2,
    /// 2 is 3 and 4, and so on). Pair 1 and 2 switches the engine off:
    /// cues then play straight from their players. Cues already playing
    /// keep the path they started on.
    func setOutput(device uid: String?, firstChannel: Int) {
        audio.stop()
        lanes.forEach { $0.ring.flush(); $0.clock.stop() }
        guard firstChannel > 0 else {
            isOn = false
            note = ""
            return
        }
        isOn = true
        if let unit = audio.outputNode.audioUnit, let dev = AudioDevices.device(uid: uid) ?? AudioDevices.defaultOutput() {
            var id = dev.objectID
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                 &id, UInt32(MemoryLayout<AudioDeviceID>.size))
            let total = dev.channels
            var map = [Int32](repeating: -1, count: total)
            if total >= 2 {
                let first = min(max(0, firstChannel), total - 2)
                map[first] = 0
                map[first + 1] = 1
            } else if total == 1 {
                map[0] = 0
            }
            let size = UInt32(map.count * MemoryLayout<Int32>.size)
            if AudioUnitSetProperty(unit, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Output, 0, &map, size) != noErr {
                AudioUnitSetProperty(unit, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Global, 0, &map, size)
            }
            note = "\(dev.name), channels \(map.firstIndex(of: 0).map { "\($0 + 1) and \($0 + 2)" } ?? "1")"
        }
        let rate = audio.outputNode.outputFormat(forBus: 0).sampleRate
        if rate > 0, let stereo = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) {
            audio.connect(audio.mainMixerNode, to: audio.outputNode, format: stereo)
        }
        start()
    }

    private func start() {
        guard isOn, !audio.isRunning else { return }
        do { try audio.start() } catch { note = "the sound engine would not start: \(error.localizedDescription)" }
    }
}
