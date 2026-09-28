import Foundation
import OutrangutanCore
import QuartzCore

/// Runs every fade in the app from one steady 60-a-second clock. Each fade
/// has a name, so starting a new fade with the same name replaces the old one.
final class Fader {
    private struct Fade {
        var from: Double
        var to: Double
        var start: CFTimeInterval
        var seconds: Double
        var curve: FadeCurve
        var apply: (Double) -> Void
        var done: (() -> Void)?
    }

    private var fades: [String: Fade] = [:]
    private var timer: Timer?

    func run(_ name: String, from: Double, to: Double, seconds: Double, curve: FadeCurve = .linear,
             apply: @escaping (Double) -> Void, done: (() -> Void)? = nil) {
        fades[name] = nil
        guard seconds > 0 else {
            apply(to)
            done?()
            return
        }
        apply(from)
        fades[name] = Fade(from: from, to: to, start: CACurrentMediaTime(), seconds: seconds, curve: curve, apply: apply, done: done)
        startClock()
    }

    func cancel(_ name: String) { fades[name] = nil }

    func cancelAll() { fades.removeAll() }

    func isRunning(_ name: String) -> Bool { fades[name] != nil }

    private func startClock() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        let now = CACurrentMediaTime()
        var finished: [() -> Void] = []
        for (name, f) in fades {
            let k = (now - f.start) / f.seconds
            if k >= 1 {
                f.apply(f.to)
                fades[name] = nil
                if let done = f.done { finished.append(done) }
            } else {
                f.apply(f.from + (f.to - f.from) * f.curve.shape(k))
            }
        }
        // Run the "done" steps after the loop: they may start new fades.
        finished.forEach { $0() }
        if fades.isEmpty {
            timer?.invalidate()
            timer = nil
        }
    }
}
