import Foundation
import OutrangutanCore

/// The Cueola cloud project. These are the same public settings the web app
/// ships in index.html. They name the project; they are not passwords.
enum CloudConfig {
    static let apiKey = "AIzaSyCr5ZuIB1kjPRxdDd2X2-FnFef-r1ZUFIA"
    static let projectId = "cueola"
    static let functionsBase = "https://us-central1-cueola.cloudfunctions.net"
    static let adminEmailDomain = "admins.cueola.app"
    static var documentsBase: String {
        "https://firestore.googleapis.com/v1/projects/\(projectId)/databases/(default)/documents"
    }
}

/// A problem talking to the cloud, in words a student can act on.
struct CloudError: LocalizedError {
    var message: String
    var permission = false
    var notFound = false
    var errorDescription: String? { message }
}

/// What the show link needs from the cloud. The real one talks to Firestore;
/// test mode swaps in a pretend one that lives in memory. Everything runs
/// on the main thread, taking turns, so a sign-in renewal and a read can
/// never trip over each other. Waiting on the network never blocks it.
@MainActor
protocol ShowRecordStore: AnyObject {
    /// The show's `outrangutan` and `fixRequests` parts.
    func read(code: String) async throws -> [String: Any]
    /// Writes only the named fields. Everything else in the record stays.
    func write(code: String, _ updates: [[String]: Any]) async throws
}

/// Signs in and reads and writes the show's shared record over plain web
/// requests. Nothing is saved to disk: the sign-in lasts until the app quits.
@MainActor
final class CloudClient: ShowRecordStore {
    private var idToken: String?
    private var refreshToken: String?
    private var expiresAt = Date.distantPast
    private let http: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 4
        http = URLSession(configuration: config)
    }

    var isSignedIn: Bool { refreshToken != nil }

    // MARK: Signing in

    /// A student: username and 4 digit PIN. The PIN is checked on the server
    /// (signInWithPin), which hands back a one-time pass we trade for a sign-in.
    func signInStudent(username: String, pin: String) async throws {
        let body: [String: Any] = ["data": ["username": username, "pin": pin]]
        let reply = try await postJSON(URL(string: CloudConfig.functionsBase + "/signInWithPin")!, body)
        if let err = reply["error"] as? [String: Any] {
            throw CloudError(message: (err["message"] as? String) ?? "That username or PIN is not right.")
        }
        guard let token = (reply["result"] as? [String: Any])?["token"] as? String else {
            throw CloudError(message: "The sign-in server did not answer. Try again.")
        }
        try await exchange(identity("accounts:signInWithCustomToken"), ["token": token, "returnSecureToken": true])
    }

    /// An instructor: username and password, the same as the web front door.
    func signInInstructor(username: String, password: String) async throws {
        let email = username + "@" + CloudConfig.adminEmailDomain
        try await exchange(identity("accounts:signInWithPassword"),
                           ["email": email, "password": password, "returnSecureToken": true])
    }

    func signOut() {
        idToken = nil
        refreshToken = nil
        expiresAt = .distantPast
    }

    // MARK: The show's shared record

    func read(code: String) async throws -> [String: Any] {
        var parts = URLComponents(string: CloudConfig.documentsBase + "/sessions/" + code)!
        parts.queryItems = [URLQueryItem(name: "mask.fieldPaths", value: "outrangutan"),
                            URLQueryItem(name: "mask.fieldPaths", value: "fixRequests")]
        var request = URLRequest(url: parts.url!)
        request.setValue("Bearer " + (try await freshToken()), forHTTPHeaderField: "Authorization")
        let doc = try await send(request, code: code)
        return FirestoreValue.decodeFields(doc["fields"])
    }

    func write(code: String, _ updates: [[String]: Any]) async throws {
        var parts = URLComponents(string: CloudConfig.documentsBase + "/sessions/" + code)!
        parts.queryItems = updates.keys.map { URLQueryItem(name: "updateMask.fieldPaths", value: FirestoreValue.fieldPath($0)) }
            + [URLQueryItem(name: "currentDocument.exists", value: "true")]
        var request = URLRequest(url: parts.url!)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + (try await freshToken()), forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: FirestoreValue.patchBody(updates))
        _ = try await send(request, code: code)
    }

    // MARK: Inside

    private func identity(_ method: String) -> URL {
        URL(string: "https://identitytoolkit.googleapis.com/v1/\(method)?key=\(CloudConfig.apiKey)")!
    }

    private func exchange(_ url: URL, _ body: [String: Any]) async throws {
        let reply = try await postJSON(url, body)
        if let err = reply["error"] as? [String: Any] {
            throw CloudError(message: Self.plainSignInError(err["message"] as? String ?? ""))
        }
        guard let id = reply["idToken"] as? String, let refresh = reply["refreshToken"] as? String else {
            throw CloudError(message: "Sign-in did not finish. Try again.")
        }
        keep(id: id, refresh: refresh, expiresIn: reply["expiresIn"])
    }

    /// Sign-ins last an hour. This renews one a few minutes before it runs out.
    private func freshToken() async throws -> String {
        if let idToken, expiresAt.timeIntervalSinceNow > 300 { return idToken }
        guard let refreshToken else { throw CloudError(message: "Sign in first.", permission: true) }
        var request = URLRequest(url: URL(string: "https://securetoken.googleapis.com/v1/token?key=\(CloudConfig.apiKey)")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let token = refreshToken.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? refreshToken
        request.httpBody = "grant_type=refresh_token&refresh_token=\(token)".data(using: .utf8)
        let (data, _) = try await http.data(for: request)
        let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let id = reply["id_token"] as? String, let refresh = reply["refresh_token"] as? String else {
            signOut()
            throw CloudError(message: "The sign-in ran out. Sign in again.", permission: true)
        }
        keep(id: id, refresh: refresh, expiresIn: reply["expires_in"])
        return id
    }

    private func keep(id: String, refresh: String, expiresIn: Any?) {
        idToken = id
        refreshToken = refresh
        let seconds = Double(Wire.string(expiresIn) ?? "") ?? 3600
        expiresAt = Date().addingTimeInterval(seconds)
    }

    private func postJSON(_ url: URL, _ body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (data, _) = try await http.data(for: request)
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        } catch {
            throw CloudError(message: "Can't reach the internet. Check the Wi-Fi.")
        }
    }

    private func send(_ request: URLRequest, code: String) async throws -> [String: Any] {
        let data: Data, response: URLResponse
        do {
            (data, response) = try await http.data(for: request)
        } catch {
            throw CloudError(message: "Can't reach the internet. Check the Wi-Fi.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        switch status {
        case 200..<300: return json
        case 401, 403: throw CloudError(message: "This sign-in can't open show \(code).", permission: true)
        case 404: throw CloudError(message: "There is no show with code \(code).", notFound: true)
        default:
            let detail = ((json["error"] as? [String: Any])?["message"] as? String) ?? "error \(status)"
            throw CloudError(message: "The cloud said: \(detail)")
        }
    }

    static func plainSignInError(_ code: String) -> String {
        if code.hasPrefix("TOO_MANY_ATTEMPTS") { return "Too many tries. Wait a few minutes and try again." }
        if code.hasPrefix("USER_DISABLED") { return "This account is turned off." }
        if code.hasPrefix("INVALID") || code.hasPrefix("EMAIL_NOT_FOUND") { return "That username or password is not right." }
        return "Sign-in did not work (\(code))."
    }
}
