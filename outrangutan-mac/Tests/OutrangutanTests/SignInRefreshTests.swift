import XCTest
import OutrangutanCore

/// Renewing a sign-in mid-show: only a dead sign-in may end it. A server
/// hiccup or a Wi-Fi sign-on page in place of the reply must not.
final class SignInRefreshTests: XCTestCase {
    func testNewPassesAreKept() {
        let body = Data("{\"id_token\":\"ID\",\"refresh_token\":\"RT\",\"expires_in\":\"3600\"}".utf8)
        XCTAssertEqual(SignInRefresh.verdict(status: 200, body: body), .renewed(id: "ID", refresh: "RT", seconds: 3600))
    }

    func testADeadSignInIsOver() {
        let body = Data("{\"error\":{\"code\":400,\"message\":\"TOKEN_EXPIRED\",\"status\":\"INVALID_ARGUMENT\"}}".utf8)
        XCTAssertEqual(SignInRefresh.verdict(status: 400, body: body), .over("TOKEN_EXPIRED"))
        let off = Data("{\"error\":{\"code\":400,\"message\":\"USER_DISABLED: turned off\"}}".utf8)
        XCTAssertEqual(SignInRefresh.verdict(status: 400, body: off), .over("USER_DISABLED: turned off"))
    }

    func testAServerHiccupIsNotTheEndOfTheSignIn() {
        // A 503 from the sign-in server.
        let busy = Data("{\"error\":{\"code\":503,\"message\":\"Backend Error\",\"status\":\"UNAVAILABLE\"}}".utf8)
        XCTAssertEqual(SignInRefresh.verdict(status: 503, body: busy), .hiccup("Backend Error"))
        // A campus Wi-Fi sign-on page, handed back as 200 with no JSON at all.
        let portal = Data("<html><body>Welcome to campus Wi-Fi. Sign in to continue.</body></html>".utf8)
        XCTAssertEqual(SignInRefresh.verdict(status: 200, body: portal), .hiccup("error 200"))
        // Asked to slow down.
        XCTAssertEqual(SignInRefresh.verdict(status: 429, body: Data()), .hiccup("error 429"))
    }
}
