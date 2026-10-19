import AppKit
import AVFoundation

/// Small pictures for the cue list: a frame from each video (a second past
/// its trim in point) and a shrunk copy of each still. Made in the
/// background once, then kept.
///
/// A picture that cannot be made (a sound file named .mp4, a damaged
/// still, an in point past the end) is tried once, not on every redraw of
/// the list. A video's picture is made only once its in point has held
/// still for a moment, so dragging the In handle does not ask for a frame
/// at every second the handle crosses; the old picture stays up until the
/// new one is ready, and then goes.
final class Thumbnails: ObservableObject {
    static let shared = Thumbnails()
    @Published private(set) var images: [String: NSImage] = [:]
    private var making: Set<String> = []
    /// Keys whose picture could not be made. Cleared when a show is opened.
    private var failed: Set<String> = []
    /// The key each cue last asked for, and the key its picture was made from.
    private var wanted: [UUID: String] = [:]
    private var shown: [UUID: String] = [:]
    static let size = CGSize(width: 160, height: 90)
    /// How long a video's in point must hold still before its frame is read.
    static let settle: TimeInterval = 0.3
    /// How many times a file was opened to make a picture (test mode reads it).
    static var attempts = 0

    /// The picture for a cue, or nil while it is being made (or for sound).
    /// While a video's new frame is on its way, the cue's last picture.
    func image(for cue: Cue) -> NSImage? {
        guard cue.kind == .video || cue.kind == .still, cue.fileIsThere else { return nil }
        let key = Self.key(cue)
        wanted[cue.id] = key
        if let image = images[key] { return image }
        if !failed.contains(key) { make(cue, key: key) }
        if let old = shown[cue.id], let image = images[old] { return image }
        return nil
    }

    /// A new show: pictures that failed get another chance.
    func showReplaced() {
        failed = []
        wanted = [:]
        shown = [:]
    }

    static func key(_ cue: Cue) -> String {
        cue.kind == .video ? "\(cue.path)@\(Int(cue.trimIn))" : cue.path
    }

    private func make(_ cue: Cue, key: String) {
        guard !making.contains(key) else { return }
        making.insert(key)
        let url = cue.url, kind = cue.kind, at = cue.trimIn + 1, id = cue.id
        Task.detached(priority: .utility) { [weak self] in
            var image: NSImage?
            if kind == .still {
                await MainActor.run { Self.attempts += 1 }
                image = Self.shrunk(NSImage(contentsOf: url))
            } else {
                // Wait for the in point to hold still. If no cue wants this
                // frame any more (the handle moved on), skip it.
                try? await Task.sleep(nanoseconds: UInt64(Self.settle * 1_000_000_000))
                let stillWanted = await MainActor.run { [weak self] in self?.wanted.values.contains(key) ?? false }
                guard stillWanted else {
                    await MainActor.run { [weak self] in self?.making.remove(key) }
                    return
                }
                await MainActor.run { Self.attempts += 1 }
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
                guard let made else { self.failed.insert(key); return }
                self.images[key] = made
                // The cue's old picture goes, unless another cue still wants it.
                if let old = self.shown[id], old != key, !self.wanted.contains(where: { $0.key != id && $0.value == old }) {
                    self.images.removeValue(forKey: old)
                }
                self.shown[id] = key
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
