import Foundation

/// Clock text for the big count-out clock.
///
/// The house standard is 1080i at 29.97, so the clock counts real 29.97
/// frames and writes SMPTE drop-frame timecode, HH:MM:SS;FF. Drop-frame skips
/// frame numbers 00 and 01 at the top of every minute, except every tenth
/// minute, so the clock stays in step with the wall clock. The ';' is the
/// drop-frame mark. This matches the web Outrangutan clock exactly.
enum Timecode {
    static let fps = 29.97

    static func dropFrame(_ seconds: Double) -> String {
        var frames = Int((max(0, seconds) * fps + 1e-6).rounded(.down))
        let tenMinutes = frames / 17982
        var rest = frames % 17982
        if rest < 2 { rest += 2 }
        frames += 18 * tenMinutes + 2 * ((rest - 2) / 1798)
        let f = frames % 30
        let s = (frames / 30) % 60
        let m = (frames / 1800) % 60
        let h = (frames / 108000) % 24
        return String(format: "%02d:%02d:%02d;%02d", h, m, s, f)
    }

    /// Short running time for the cue list, like 1:05 or 1:02:03.
    static func short(_ seconds: Double) -> String {
        let total = Int(max(0, seconds).rounded(.down))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
