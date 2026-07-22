import Foundation
import CoreAudio
import AudioToolbox

/// CoreAudio AUHAL engine: captures the mic from the interface's input, feeds it
/// to two independently gated stereo buses, channel-mapped onto physical outputs
/// 1-2 (bus A) and 3-4 (bus B). Gating uses a short linear ramp so press/release
/// never clicks.
final class AudioEngine {

    struct DeviceInfo {
        let id: AudioDeviceID
        let name: String
        let inputChannels: Int
        let outputChannels: Int
        let sampleRate: Double
    }

    enum EngineError: Error, CustomStringConvertible {
        case deviceNotFound(String)
        case notEnoughOutputs(found: Int)
        case noInputs
        case osStatus(String, OSStatus)

        var description: String {
            switch self {
            case .deviceNotFound(let name):
                return "No audio device matching \"\(name)\" was found. Use --list-devices to see what's connected."
            case .notEnoughOutputs(let found):
                return "Device exposes only \(found) output channel(s); this utility needs 4 discrete outputs (pairs 1-2 and 3-4). Check the UR44 is in CC mode. (Milestone 0 failed, stop and reassess.)"
            case .noInputs:
                return "Device exposes no input channels."
            case .osStatus(let what, let status):
                return "\(what) failed (OSStatus \(status))"
            }
        }
    }

    private let state: ControlState
    private let micChannel: Int          // 0-based input channel to use
    private let rampSeconds: Double
    private var unit: AudioUnit?
    private var inputABL: UnsafeMutableAudioBufferListPointer?
    private var inputABLRaw: UnsafeMutablePointer<AudioBufferList>?
    private var maxFrames: UInt32 = 4096
    private var inputChannelCount: Int = 0

    // Render-thread gain state (only touched on the render thread).
    private var gainA: Float = 0
    private var gainB: Float = 0
    private var rampStep: Float = 0.0025   // recomputed from sample rate at start

    private(set) var device: DeviceInfo?

    init(state: ControlState, micChannel: Int, rampMilliseconds: Double) {
        self.state = state
        self.micChannel = micChannel
        self.rampSeconds = rampMilliseconds / 1000.0
    }

    // MARK: - Device discovery

    static func allDevices() -> [DeviceInfo] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { describe(deviceID: $0) }
    }

    static func describe(deviceID: AudioDeviceID) -> DeviceInfo? {
        guard let name = stringProperty(deviceID, kAudioObjectPropertyName) else { return nil }
        let inCh = channelCount(deviceID, scope: kAudioObjectPropertyScopeInput)
        let outCh = channelCount(deviceID, scope: kAudioObjectPropertyScopeOutput)
        var rate: Double = 0
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<Double>.size)
        _ = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &rate)
        return DeviceInfo(id: deviceID, name: name, inputChannels: inCh, outputChannels: outCh, sampleRate: rate)
    }

    private static func stringProperty(_ deviceID: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var cfName: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &cfName) { ptr -> OSStatus in
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, ptr)
        }
        guard status == noErr, let cf = cfName?.takeRetainedValue() else { return nil }
        return cf as String
    }

    private static func channelCount(_ deviceID: AudioDeviceID, scope: AudioObjectPropertyScope) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let ablRaw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { ablRaw.deallocate() }
        let ablPtr = ablRaw.assumingMemoryBound(to: AudioBufferList.self)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, ablPtr) == noErr else { return 0 }
        let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
        return abl.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    // MARK: - Lifecycle

    func start(deviceNameSubstring: String, preferredSampleRate: Double) throws {
        let match = AudioEngine.allDevices().first {
            $0.name.range(of: deviceNameSubstring, options: .caseInsensitive) != nil
                && $0.outputChannels > 0 && $0.inputChannels > 0
        }
        guard var dev = match else { throw EngineError.deviceNotFound(deviceNameSubstring) }
        guard dev.outputChannels >= 4 else { throw EngineError.notEnoughOutputs(found: dev.outputChannels) }
        guard dev.inputChannels > micChannel else { throw EngineError.noInputs }

        // Try to pin the device's nominal rate; fall back to whatever it reports.
        var wantedRate = preferredSampleRate
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        _ = AudioObjectSetPropertyData(dev.id, &address, 0, nil, UInt32(MemoryLayout<Double>.size), &wantedRate)
        if let refreshed = AudioEngine.describe(deviceID: dev.id) { dev = refreshed }
        let rate = dev.sampleRate > 0 ? dev.sampleRate : preferredSampleRate
        device = dev
        inputChannelCount = dev.inputChannels
        rampStep = Float(1.0 / (rampSeconds * rate))

        // AUHAL bound to the UR44, NOT the default output. Element 0 = output, 1 = input.
        var desc = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_HALOutput,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0, componentFlagsMask: 0)
        guard let comp = AudioComponentFindNext(nil, &desc) else {
            throw EngineError.osStatus("AudioComponentFindNext", -1)
        }
        var maybeUnit: AudioUnit?
        try check(AudioComponentInstanceNew(comp, &maybeUnit), "AudioComponentInstanceNew")
        guard let au = maybeUnit else { throw EngineError.osStatus("AudioComponentInstanceNew", -1) }
        unit = au

        var enable: UInt32 = 1
        try check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO,
                                       kAudioUnitScope_Input, 1, &enable, 4), "EnableIO input")
        try check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO,
                                       kAudioUnitScope_Output, 0, &enable, 4), "EnableIO output")

        var deviceID = dev.id
        try check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice,
                                       kAudioUnitScope_Global, 0, &deviceID, UInt32(MemoryLayout<AudioDeviceID>.size)),
                  "Set current device")

        // Client formats: Float32, non-interleaved.
        // Output side: 4 client channels (A = 0/1, B = 2/3).
        var outFormat = nonInterleavedFloatFormat(rate: rate, channels: 4)
        try check(AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat,
                                       kAudioUnitScope_Input, 0, &outFormat,
                                       UInt32(MemoryLayout<AudioStreamBasicDescription>.size)),
                  "Set output client format")
        // Input side: all device input channels, so any mic input is selectable.
        var inFormat = nonInterleavedFloatFormat(rate: rate, channels: UInt32(dev.inputChannels))
        try check(AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat,
                                       kAudioUnitScope_Output, 1, &inFormat,
                                       UInt32(MemoryLayout<AudioStreamBasicDescription>.size)),
                  "Set input client format")

        // Channel map: client 0-3 → physical outputs 1-4, nothing else driven.
        var channelMap = [Int32](repeating: -1, count: dev.outputChannels)
        for i in 0..<4 { channelMap[i] = Int32(i) }
        try check(AudioUnitSetProperty(au, kAudioOutputUnitProperty_ChannelMap,
                                       kAudioUnitScope_Input, 0, &channelMap,
                                       UInt32(channelMap.count * MemoryLayout<Int32>.size)),
                  "Set channel map")

        var frames: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        if AudioUnitGetProperty(au, kAudioUnitProperty_MaximumFramesPerSlice,
                                kAudioUnitScope_Global, 0, &frames, &size) == noErr, frames > 0 {
            maxFrames = frames
        }
        allocateInputBuffers(channels: dev.inputChannels, frames: Int(maxFrames))

        var callback = AURenderCallbackStruct(
            inputProc: renderCallback,
            inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        try check(AudioUnitSetProperty(au, kAudioUnitProperty_SetRenderCallback,
                                       kAudioUnitScope_Input, 0, &callback,
                                       UInt32(MemoryLayout<AURenderCallbackStruct>.size)),
                  "Set render callback")

        try check(AudioUnitInitialize(au), "AudioUnitInitialize")
        try check(AudioOutputUnitStart(au), "AudioOutputUnitStart")
    }

    func stop() {
        if let au = unit {
            AudioOutputUnitStop(au)
            AudioUnitUninitialize(au)
            AudioComponentInstanceDispose(au)
            unit = nil
        }
        freeInputBuffers()
    }

    // MARK: - Render path

    private func allocateInputBuffers(channels: Int, frames: Int) {
        freeInputBuffers()
        let raw = AudioBufferList.allocate(maximumBuffers: channels)
        for i in 0..<channels {
            let bytes = frames * MemoryLayout<Float>.size
            raw[i] = AudioBuffer(
                mNumberChannels: 1,
                mDataByteSize: UInt32(bytes),
                mData: UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: MemoryLayout<Float>.alignment))
        }
        inputABL = raw
        inputABLRaw = raw.unsafeMutablePointer
    }

    private func freeInputBuffers() {
        if let abl = inputABL {
            for buffer in abl { buffer.mData?.deallocate() }
            free(abl.unsafeMutablePointer)
        }
        inputABL = nil
        inputABLRaw = nil
    }

    fileprivate func render(_ ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                            _ inTimeStamp: UnsafePointer<AudioTimeStamp>,
                            _ inNumberFrames: UInt32,
                            _ ioData: UnsafeMutablePointer<AudioBufferList>?) -> OSStatus {
        guard let au = unit, let ioData = ioData, let ablRaw = inputABLRaw, let abl = inputABL else {
            return noErr
        }
        let frames = Int(inNumberFrames)

        // Reset input buffer sizes (AudioUnitRender may have shrunk them last cycle).
        for i in 0..<abl.count {
            abl[i].mDataByteSize = UInt32(frames * MemoryLayout<Float>.size)
        }
        var flags = ioActionFlags.pointee
        let pullStatus = AudioUnitRender(au, &flags, inTimeStamp, 1, inNumberFrames, ablRaw)

        let out = UnsafeMutableAudioBufferListPointer(ioData)
        // Silence everything first so a failed input pull outputs silence, not garbage.
        for buffer in out {
            if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
        }
        guard pullStatus == noErr else { return noErr }

        let micIdx = min(micChannel, abl.count - 1)
        guard let micRaw = abl[micIdx].mData else { return noErr }
        let mic = micRaw.assumingMemoryBound(to: Float.self)

        let targetA: Float = state.talkA ? 1 : 0
        let targetB: Float = state.talkB ? 1 : 0
        var gA = gainA
        var gB = gainB
        let step = rampStep

        // Non-interleaved: buffer 0/1 = pair A (outs 1-2), buffer 2/3 = pair B (outs 3-4).
        let a0 = out.count > 0 ? out[0].mData?.assumingMemoryBound(to: Float.self) : nil
        let a1 = out.count > 1 ? out[1].mData?.assumingMemoryBound(to: Float.self) : nil
        let b0 = out.count > 2 ? out[2].mData?.assumingMemoryBound(to: Float.self) : nil
        let b1 = out.count > 3 ? out[3].mData?.assumingMemoryBound(to: Float.self) : nil

        for frame in 0..<frames {
            if gA < targetA { gA = min(gA + step, 1) } else if gA > targetA { gA = max(gA - step, 0) }
            if gB < targetB { gB = min(gB + step, 1) } else if gB > targetB { gB = max(gB - step, 0) }
            let sample = mic[frame]
            if gA > 0 {
                let s = sample * gA
                a0?[frame] = s
                a1?[frame] = s
            }
            if gB > 0 {
                let s = sample * gB
                b0?[frame] = s
                b1?[frame] = s
            }
        }
        gainA = gA
        gainB = gB
        return noErr
    }

    // MARK: - Helpers

    private func nonInterleavedFloatFormat(rate: Double, channels: UInt32) -> AudioStreamBasicDescription {
        AudioStreamBasicDescription(
            mSampleRate: rate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved,
            mBytesPerPacket: 4,
            mFramesPerPacket: 1,
            mBytesPerFrame: 4,
            mChannelsPerFrame: channels,
            mBitsPerChannel: 32,
            mReserved: 0)
    }

    private func check(_ status: OSStatus, _ what: String) throws {
        guard status == noErr else { throw EngineError.osStatus(what, status) }
    }
}

private func renderCallback(inRefCon: UnsafeMutableRawPointer,
                            ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                            inTimeStamp: UnsafePointer<AudioTimeStamp>,
                            inBusNumber: UInt32,
                            inNumberFrames: UInt32,
                            ioData: UnsafeMutablePointer<AudioBufferList>?) -> OSStatus {
    let engine = Unmanaged<AudioEngine>.fromOpaque(inRefCon).takeUnretainedValue()
    return engine.render(ioActionFlags, inTimeStamp, inNumberFrames, ioData)
}
