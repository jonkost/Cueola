import AppKit
import AVFoundation

/// Small pictures for the cue list: a frame from each video (a second past
/// its trim in point) and a shrunk copy of each still. Made in the
/// background once, then kept.
final class Thumbnails: ObservableObject {
    static let shared = Thumbnails()
    @Published private(set) var images: [String: NSImage] = [:]
    private var making: Set<String> = []
    static let size = CGSize(width: 160, height: 90)

    /// The picture for a cue, or nil while it is being made (or for sound).
    func image(for cue: Cue) -> NSImage? {
        guard cue.kind == .video || cue.kind == .still, cue.fileIsThere else { return nil }
        let key = Self.key(cue)
        if let image = images[key] { return image }
        make(cue, key: key)
        return nil
    }

    static func key(_ cue: Cue) -> String {
        cue.kind == .video ? "\(cue.path)@\(Int(cue.trimIn))" : cue.path
    }

    private func make(_ cue: Cue, key: String) {
        guard !making.contains(key) else { return }
        making.insert(key)
        let url = cue.url, kind = cue.kind, at = cue.trimIn + 1
        Task.detached(priority: .utility) { [weak self] in
            var image: NSImage?
            if kind == .still {
                image = Self.shrunk(NSImage(contentsOf: url))
            } else {
                let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
                gen.appliesPreferredTrackTransform = true
                gen.maximumSize = Self.size
                gen.requestedTimeToleranceBefore = CMTime(seconds: 1, preferredTimescale: 600)
                gen.requestedTimeToleranceAfter = CMTime(seconds: 1, preferredTimescale: 600)
                if let cg = try? await gen.image(at: CMTime(seconds: at, preferredTimescale: 600)).image {
                    image = NSImage(cgImage: cg, size: .zero)
                }
            }
            let made = image
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.making.remove(key)
                if let made { self.images[key] = made }
            }
        }
    }

    private static func shrunk(_ image: NSImage?) -> NSImage? {
        guard let image, image.size.width > 0 else { return nil }
        let scale = min(size.width / image.size.width, size.height / image.size.height, 1)
        let target = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        let small = NSImage(size: target)
        small.lockFocus()
        image.draw(in: NSRect(origin: .zero, size: target))
        small.unlockFocus()
        return small
    }
}
