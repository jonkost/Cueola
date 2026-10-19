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
    /// Called when the sound hardware moved cue sound on its own (the
    /// interface pulled or plugged back in), with a line for the show log
    /// and whether the engine is still running. Off the lane path when it
    /// is not: cues then play from their players.
    var onHardwareChange: ((String, Bool) -> Void)?
    private let audio = AVAudioEngine()
    /// Where Settings sent cue sound, so a hardware change can put it back.
    private var route: (uid: String?, firstChannel: Int)?
    /// The device cue sound is pinned to right now (0 for none).
    private var pinnedID: AudioDeviceID = 0
    private var deviceWatch: AudioObjectPropertyListenerBlock = { _, _ in }
    private var deviceCheck: DispatchWorkItem?
    private static var devicesAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                                                   mScope: kAudioObjectPropertyScopeGlobal,
                                                                   mElement: kAudioObjectPropertyElementMain)

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
        // When the sound hardware changes (the interface pulled, a sample
        // rate changed), the engine stops. Put cue sound back where
        // Settings sent it, or on the Mac's default output meanwhile.
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
            self?.soundHardwareChanged()
        }
        // When the Mac's list of sound devices changes (the interface
        // plugged back in, with a new id), cue sound goes back to it.
        deviceWatch = { [weak self] _, _ in DispatchQueue.main.async { self?.devicesChangedSoon() } }
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &CueSoundEngine.devicesAddress, .main, deviceWatch)
    }

    deinit {
        AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &CueSoundEngine.devicesAddress, .main, deviceWatch)
    }

    /// The sound hardware changed under the engine. Cue sound goes back to
    /// the device Settings picked, or to the Mac's default output while
    /// that device is away; the show log says where it went. A cue on air
    /// keeps going: its deck notes the lane's clock again on the next tick.
    func soundHardwareChanged() {
        guard isOn, let route else { return }
        setOutput(device: route.uid, firstChannel: route.firstChannel)
        guard isOn else { return }
        onHardwareChange?("The sound hardware changed: cue sound now plays on \(note)", true)
    }

    /// The list of sound devices changed. A moment later (a device just
    /// plugged in is still waking up), if the device Settings picked is
    /// here under a new id, cue sound goes back to it. Any other change
    /// (a headset pairing) leaves cue sound alone.
    private func devicesChangedSoon() {
        deviceCheck?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let route = self.route, route.firstChannel > 0, let uid = route.uid,
                  let dev = AudioDevices.device(uid: uid), dev.objectID != self.pinnedID else { return }
            self.setOutput(device: uid, firstChannel: route.firstChannel)
            guard self.isOn else { return }
            self.onHardwareChange?("\(dev.name) is back: cue sound plays on \(self.note)", true)
        }
        deviceCheck = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    /// Sends cue sound to a device on a chosen pair (0 is channels 1 and 2,
    /// 2 is 3 and 4, and so on). Pair 1 and 2 switches the engine off:
    /// cues then play straight from their players. Cues already playing
    /// keep the path they started on.
    func setOutput(device uid: String?, firstChannel: Int) {
        route = (uid, firstChannel)
        audio.stop()
        lanes.forEach { $0.ring.flush(); $0.clock.stop() }
        pinnedID = 0
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
            pinnedID = dev.objectID
            let total = dev.channels
            var map = [Int32](repeating: -1, count: total)
            // A pair this device does not have goes to channels 1 and 2,
            // never on top of another pair (the pads do the same).
            let wanted = max(0, firstChannel)
            let missing = total >= 2 && wanted + 2 > total
            if total >= 2 {
                let first = missing ? 0 : wanted
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
                + (missing ? " (\(wanted + 1) and \(wanted + 2) are not on this device)" : "")
        }
        let rate = audio.outputNode.outputFormat(forBus: 0).sampleRate
        if rate > 0, let stereo = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) {
            audio.connect(audio.mainMixerNode, to: audio.outputNode, format: stereo)
        }
        start()
    }

    /// Starts the engine. When it will not start, the engine switches
    /// itself off so cues play from their players (on the Mac's output, at
    /// their level) instead of into a lane nobody is listening to.
    private func start() {
        guard isOn, !audio.isRunning else { return }
        do { try audio.start() } catch {
            isOn = false
            pinnedID = 0
            note = "the sound engine would not start: \(error.localizedDescription)"
            onHardwareChange?("Cue sound: \(note). Cues play from their players until the device comes back or is picked again", false)
        }
    }
}
