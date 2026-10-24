import AVFoundation
import CoreVideo
import Metal

/// One video file, playing on a loop with no sound, handing its newest
/// frame to the graphics card. Every surface that shows the same file
/// shares one of these, so they stay in step.
final class VideoSource {
    let path: String
    private let player: AVPlayer
    private let output: AVPlayerItemVideoOutput
    private var cache: CVMetalTextureCache?
    /// The frame on screen now. Kept until a newer one arrives, so a frame
    /// is never empty between two video frames.
    private var current: CVMetalTexture?
    private var looper: NSObjectProtocol?

    init?(path: String, device: MTLDevice) {
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        self.path = path
        let item = AVPlayerItem(url: URL(fileURLWithPath: path))
        output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ])
        item.add(output)
        player = AVPlayer(playerItem: item)
        player.isMuted = true                       // no sound for now
        player.actionAtItemEnd = .none
        player.preventsDisplaySleepDuringVideoPlayback = true
        CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
        // At the end, back to the start: it loops.
        looper = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak player] _ in
            player?.seek(to: .zero)
            player?.play()
        }
        player.play()
    }

    deinit {
        if let looper { NotificationCenter.default.removeObserver(looper) }
        player.pause()
    }

    /// The newest frame due by `hostTime` (the Mac's clock), or the last
    /// one if nothing newer has come in.
    func texture(at hostTime: CFTimeInterval) -> MTLTexture? {
        let time = output.itemTime(forHostTime: hostTime)
        if output.hasNewPixelBuffer(forItemTime: time),
           let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil),
           let cache {
            var texture: CVMetalTexture?
            CVMetalTextureCacheCreateTextureFromImage(nil, cache, buffer, nil, .bgra8Unorm,
                                                      CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer), 0, &texture)
            if texture != nil { current = texture }
        }
        return current.flatMap(CVMetalTextureGetTexture)
    }

    /// True once the first frame has come in; for test mode.
    var hasFrame: Bool { current != nil }
}

/// The videos in use, one player per file.
final class VideoLibrary {
    private var sources: [String: VideoSource] = [:]

    /// The player for a file, started the first time it is asked for. Nil
    /// if the file is missing.
    func source(_ path: String) -> VideoSource? {
        if let s = sources[path] { return s }
        guard let device = MapRenderer.shared?.device, let s = VideoSource(path: path, device: device) else { return nil }
        sources[path] = s
        return s
    }

    /// Stops the players no surface uses any more.
    func keep(only paths: Set<String>) {
        for path in sources.keys where !paths.contains(path) { sources[path] = nil }
    }
}
