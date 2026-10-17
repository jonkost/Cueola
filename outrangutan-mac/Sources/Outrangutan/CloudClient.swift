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
    /// The cloud asked everyone to write less often for a moment.
    var busy = false
    /// The cloud does not take this kind of request at all. Asking again
    /// the same way will not help.
    var refused = false
    var errorDescription: String? { message }
}

/// Keys this app adds to a copy of the show record, beside the cloud's own.
enum ShowRecordKeys {
    /// When the cloud wrote this copy ("2026-10-16T18:24:19.123456Z"), so
    /// two copies that cross on the way here can be put in order.
    static let updateTime = "_updateTime"
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
    /// Keeps a line open and hands over every message the cloud sends
    /// about the show, until the cloud closes the line. A store with no
    /// live line throws a refusal at once.
    func listen(code: String, onMessage: @escaping @MainActor ([String: Any]) -> Void) async throws
}

/// Signs in and reads and writes the show's shared record over plain web
/// requests. Nothing is saved to disk: the sign-in lasts until the app quits.
@MainActor
final class CloudClient: ShowRecordStore {
    private var idToken: String?
    private var refreshToken: String?
    private var expiresAt = Date.distantPast
    /// The renewal on its way, while one is.
    private var renewing: Task<String, Error>?
    /// Sign-ins and writes: eight seconds is plenty for one small request.
    private let http: URLSession
    /// Reads: a read that hangs must not hold the next one up for long.
    private let quick: URLSession
    /// The live line: it sits idle between changes, so only a long silence
    /// means it died.
    private let stream: URLSession

    init() {
        func session(timeout: Double) -> URLSession {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = timeout
            config.waitsForConnectivity = false
            config.httpMaximumConnectionsPerHost = 4
            return URLSession(configuration: config)
        }
        http = session(timeout: 8)
        quick = session(timeout: 4)
        stream = session(timeout: 150)
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
        let doc = try await send(request, code: code, on: quick)
        var fields = FirestoreValue.decodeFields(doc["fields"])
        if let when = doc["updateTime"] as? String { fields[ShowRecordKeys.updateTime] = when }
        return fields
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
        _ = try await send(request, code: code, on: http)
    }

    /// Asks the cloud to send the show's playback parts every time they
    /// change, and hands each message over as it arrives. Returns when the
    /// cloud closes the line (it does now and then, on purpose); throws when
    /// the line fails or the cloud will not open one.
    func listen(code: String, onMessage: @escaping @MainActor ([String: Any]) -> Void) async throws {
        var request = URLRequest(url: URL(string: CloudConfig.documentsBase + ":listen")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + (try await freshToken()), forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject:
            ListenRequest.body(project: CloudConfig.projectId, code: code, fields: ["outrangutan", "fixRequests"]))
        let bytes: URLSession.AsyncBytes, response: URLResponse
        do {
            (bytes, response) = try await stream.bytes(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw CloudError(message: "Can't reach the internet. Check the Wi-Fi.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        var parser = ListenStreamParser()
        guard (200..<300).contains(status) else {
            // A refusal comes as one short message in the same array shape.
            var problem = "error \(status)"
            for try await b in bytes {
                if let m = parser.feed(b) { problem = ListenRequest.problem(in: m) ?? problem; break }
            }
            throw Self.listenError(ListenRequest.failure(code: status, status: nil), problem, code: code)
        }
        for try await b in bytes {
            guard let message = parser.feed(b) else { continue }
            // The cloud can say no after the line is open: HTTP 200, then one
            // error element. That no counts the same as one in the status line.
            if let f = ListenRequest.failure(in: message) { throw Self.listenError(f.kind, f.message, code: code) }
            onMessage(message)
        }
    }

    private static func listenError(_ kind: ListenRequest.Failure, _ problem: String, code: String) -> CloudError {
        switch kind {
        case .permission: return CloudError(message: "This sign-in can't open show \(code).", permission: true)
        case .notFound: return CloudError(message: "There is no show with code \(code).", notFound: true)
        case .busy: return CloudError(message: "The cloud is busy.", busy: true)
        case .refused: return CloudError(message: "The cloud said: \(problem)", refused: true)
        case .other: return CloudError(message: "The cloud said: \(problem)")
        }
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
        keep(id: id, refresh: refresh, seconds: Double(Wire.string(reply["expiresIn"]) ?? "") ?? 3600)
    }

    /// Sign-ins last an hour. This renews one a few minutes before it runs out.
    /// A read, a write and the live line can all ask at the same moment:
    /// they share one renewal instead of each sending its own.
    private func freshToken() async throws -> String {
        if let idToken, expiresAt.timeIntervalSinceNow > 300 { return idToken }
        guard refreshToken != nil else { throw CloudError(message: "Sign in first.", permission: true) }
        if let renewing { return try await renewing.value }
        let task = Task { try await self.renew() }
        renewing = task
        defer { renewing = nil }
        return try await task.value
    }

    /// Only a sign-in the server says is finished (it ran out, the account
    /// is off) ends here. A server hiccup, a 503, or a Wi-Fi sign-on page in
    /// place of the reply is not the end of the sign-in: the old pass is
    /// used while it has time left, and the next request tries again.
    private func renew() async throws -> String {
        guard let refreshToken else { throw CloudError(message: "Sign in first.", permission: true) }
        var request = URLRequest(url: URL(string: "https://securetoken.googleapis.com/v1/token?key=\(CloudConfig.apiKey)")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let token = refreshToken.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? refreshToken
        request.httpBody = "grant_type=refresh_token&refresh_token=\(token)".data(using: .utf8)
        let data: Data, response: URLResponse
        do {
            (data, response) = try await http.data(for: request)
        } catch {
            return try stillGood(or: "Can't reach the internet. Check the Wi-Fi.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch SignInRefresh.verdict(status: status, body: data) {
        case .renewed(let id, let refresh, let seconds):
            keep(id: id, refresh: refresh, seconds: seconds)
            return id
        case .over:
            signOut()
            throw CloudError(message: "The sign-in ran out. Sign in again.", permission: true)
        case .hiccup(let why):
            return try stillGood(or: "The sign-in could not be renewed (\(why)). Trying again.")
        }
    }

    /// The pass still in hand while it has time left; otherwise the problem.
    private func stillGood(or problem: String) throws -> String {
        if let idToken, expiresAt.timeIntervalSinceNow > 0 { return idToken }
        throw CloudError(message: problem)
    }

    private func keep(id: String, refresh: String, seconds: Double) {
        idToken = id
        refreshToken = refresh
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

    private func send(_ request: URLRequest, code: String, on session: URLSession) async throws -> [String: Any] {
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw CloudError(message: "Can't reach the internet. Check the Wi-Fi.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        switch status {
        case 200..<300: return json
        case 401, 403: throw CloudError(message: "This sign-in can't open show \(code).", permission: true)
        case 404: throw CloudError(message: "There is no show with code \(code).", notFound: true)
        case 429:
            // "This database has exceeded their maximum bandwidth for
            // writes": the show record is one document everyone writes to,
            // and the cloud slows it down past about one write a second.
            throw CloudError(message: "The cloud is busy. Writing less often for a moment.", busy: true)
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
