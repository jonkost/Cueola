import Foundation

/// The shape of a fade, the same three the web Outrangutan offers.
/// - linear: even all the way.
/// - s: eases in and out, the smoothest to the eye.
/// - log: slow at first, then fast, which sounds even to the ear on a
///   fade up.
public enum FadeCurve: String, Codable, CaseIterable {
    case linear, s, log

    public var label: String {
        switch self {
        case .linear: return "Straight"
        case .s: return "Smooth (S)"
        case .log: return "Slow start"
        }
    }

    /// How far along a fade is (0 to 1) for how much of its time has passed
    /// (0 to 1). Matches curveK in outrangutan.js.
    public func shape(_ k: Double) -> Double {
        let t = min(1, max(0, k))
        switch self {
        case .linear: return t
        case .s: return t * t * (3 - 2 * t)
        case .log: return pow(t, 2.2)
        }
    }
}
