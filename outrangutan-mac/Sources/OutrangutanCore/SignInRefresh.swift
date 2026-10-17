import Foundation

/// What the sign-in server's answer to a renewal means.
///
/// A sign-in lasts an hour, and the app renews it a few minutes before it
/// runs out. The answer is new passes, or a reason the old sign-in is
/// finished for good, or nothing useful at all: a busy server, a campus
/// Wi-Fi sign-on page in place of the reply, a reply that never came. Only
/// the second kind ends the sign-in. The third is a hiccup; the show goes
/// on and the next try may well work.
public enum SignInRefresh {
    public enum Verdict: Equatable {
        /// New passes, and how many seconds they last.
        case renewed(id: String, refresh: String, seconds: Double)
        /// This sign-in is over for good. Only signing in again helps.
        case over(String)
        /// The server did not answer properly. The sign-in still stands.
        case hiccup(String)
    }

    /// The reasons the server gives when the sign-in itself is dead.
    static let fatal = ["TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN", "USER_DISABLED", "USER_NOT_FOUND"]

    public static func verdict(status: Int, body: Data) -> Verdict {
        let reply = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        if let id = reply["id_token"] as? String, let refresh = reply["refresh_token"] as? String {
            let seconds = Double(Wire.string(reply["expires_in"]) ?? "") ?? 3600
            return .renewed(id: id, refresh: refresh, seconds: seconds)
        }
        let reason = ((reply["error"] as? [String: Any])?["message"] as? String) ?? ""
        if fatal.contains(where: { reason.hasPrefix($0) }) { return .over(reason) }
        return .hiccup(reason.isEmpty ? "error \(status)" : reason)
    }
}
