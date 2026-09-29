import XCTest
@testable import OutrangutanCore

final class ShowArchiveTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("ogshow-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    func testChecksumMatchesTheStandard() {
        var crc = CRC32()
        crc.update(Data("123456789".utf8))
        XCTAssertEqual(crc.value, 0xCBF4_3926)
    }

    func testWritesAndReadsBack() throws {
        let media = folder.appendingPathComponent("clip.bin")
        // Bigger than one slice, so the copy runs in pieces.
        var bytes = Data(count: ShowArchive.slice + 1234)
        for i in stride(from: 0, to: bytes.count, by: 997) { bytes[i] = UInt8(i % 251) }
        try bytes.write(to: media)

        let zip = folder.appendingPathComponent("show.ogshow")
        let w = try ShowArchive.Writer(url: zip)
        try w.add(name: "show.json", data: Data(#"{"kind":"outrangutan-show"}"#.utf8))
        try w.add(name: "media/m_1", file: media)
        try w.finish()

        let r = try ShowArchive.Reader(url: zip)
        XCTAssertEqual(Set(r.names), ["show.json", "media/m_1"])
        XCTAssertEqual(String(decoding: try r.data("show.json"), as: UTF8.self), #"{"kind":"outrangutan-show"}"#)
        let out = folder.appendingPathComponent("out.bin")
        try r.extract("media/m_1", to: out)
        XCTAssertEqual(try Data(contentsOf: out), bytes)
    }

    /// The Mac's own zip tool checks every checksum, so the file opens anywhere.
    func testTheMacsZipToolAgrees() throws {
        let zip = folder.appendingPathComponent("show.ogshow")
        let w = try ShowArchive.Writer(url: zip)
        try w.add(name: "show.json", data: Data("{}".utf8))
        try w.add(name: "media/a", data: Data(repeating: 7, count: 5000))
        try w.finish()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        p.arguments = ["-tq", zip.path]
        p.standardOutput = FileHandle.nullDevice
        try p.run(); p.waitUntilExit()
        XCTAssertEqual(p.terminationStatus, 0)
    }

    func testRefusesSomethingThatIsNotAZip() throws {
        let bad = folder.appendingPathComponent("bad.ogshow")
        try Data("{\"kind\":\"outrangutan-show\"}".utf8).write(to: bad)
        XCTAssertThrowsError(try ShowArchive.Reader(url: bad))
    }
}
