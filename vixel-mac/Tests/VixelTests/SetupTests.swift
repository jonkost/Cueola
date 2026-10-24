import Foundation
import Testing
import VixelCore

/// A saved setup reads back the same, and the changes Vixel makes to it
/// follow the rules.
struct SetupTests {
    func sample() -> Setup {
        var setup = Setup(outputScreen: "VPL-FHZ55")
        let a = setup.addSurface()
        let b = setup.addSurface()
        setup.rename(a, to: "Flat left")
        setup.moveCorner(setup.surface(a)!.output[1], to: Point2(0.61, 0.27))
        setup.setContent(a, SurfaceContent(kind: .video, video: "/Users/jon/Movies/Loop.mov"))
        setup.setContent(b, SurfaceContent(kind: .color, color: "#FF8800"))
        return setup
    }

    @Test func aSavedSetupReadsBackTheSame() throws {
        let setup = sample()
        let back = try SetupFile.decode(try SetupFile.encode(setup))
        #expect(back == setup)
    }

    @Test func aSavedFileOnDiskReadsBackTheSame() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("vixel-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("setup.json")
        let setup = sample()
        try SetupFile.write(setup, to: url)
        #expect(SetupFile.read(from: url) == setup)
    }

    @Test func theFileIsReadableAndHasItsVersion() throws {
        let text = String(decoding: try SetupFile.encode(sample()), as: UTF8.self)
        #expect(text.contains("\"version\" : 1"))
        #expect(text.contains("\"name\" : \"Flat left\""))
        #expect(text.contains("\"outputScreen\" : \"VPL-FHZ55\""))
        #expect(text.contains("/Users/jon/Movies/Loop.mov"), "paths are written plainly, without escaped slashes")
        #expect(text.contains("\n"), "one thing per line")
    }

    @Test func anOlderOrShorterFileStillReads() throws {
        // No version and no content: the version is 1 and the surface shows
        // the grid. A kind this Vixel does not know shows the grid too.
        let json = """
        {"corners":[{"id":"c1","x":0.1,"y":0.1},{"id":"c2","x":0.9,"y":0.1},
                    {"id":"c3","x":0.9,"y":0.9},{"id":"c4","x":0.1,"y":0.9}],
         "surfaces":[{"id":"s1","name":"Wall","output":["c1","c2","c3","c4"]},
                     {"id":"s2","name":"Box","output":["c1","c2","c3","c4"],"content":{"kind":"sparkles"}}],
         "somethingNew": true}
        """
        let setup = try SetupFile.decode(Data(json.utf8))
        #expect(setup.version == 1)
        #expect(setup.surfaces.count == 2)
        #expect(setup.surfaces[0].content.kind == .grid)
        #expect(setup.surfaces[0].input == Quad.unit)
        #expect(setup.surfaces[1].content.kind == .grid)
        #expect(setup.outputScreen == nil)
    }

    @Test func aBrokenFileReadsAsNothing() {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("vixel-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("setup.json")
        try? Data("{ not json".utf8).write(to: url)
        #expect(SetupFile.read(from: url) == nil)
        #expect(SetupFile.read(from: folder.appendingPathComponent("missing.json")) == nil)
    }

    @Test func aNewSurfaceHasFourCornersOfItsOwn() throws {
        var setup = Setup()
        let a = setup.addSurface()
        let b = setup.addSurface()
        let sa = try #require(setup.surface(a)), sb = try #require(setup.surface(b))
        #expect(sa.name == "Surface 1")
        #expect(sb.name == "Surface 2")
        #expect(sa.output.count == 4 && sb.output.count == 4)
        #expect(Set(sa.output).isDisjoint(with: sb.output))
        #expect(setup.corners.count == 8)
        #expect(Set(setup.corners.map(\.id)).count == 8, "every corner has its own id")
        #expect(sa.input == Quad.unit, "the input is the whole picture")
        #expect(sa.content.kind == .grid)
        // The second one sits a little down and right, not on top.
        #expect(setup.outputShape(sa) != setup.outputShape(sb))
        #expect(Quad.isConvex(try #require(setup.outputShape(sa))))
    }

    @Test func namesFillTheGapsAndBlankNamesAreRefused() throws {
        var setup = Setup()
        let a = setup.addSurface(), b = setup.addSurface()
        setup.deleteSurface(a)
        let c = setup.addSurface()
        #expect(setup.surface(c)?.name == "Surface 1")
        setup.rename(b, to: "   ")
        #expect(setup.surface(b)?.name == "Surface 2")
        setup.rename(b, to: "  Stage right flat ")
        #expect(setup.surface(b)?.name == "Stage right flat")
    }

    @Test func deletingASurfaceKeepsCornersAnotherOneUses() throws {
        // Two surfaces sharing an edge (the way a later step will join
        // them): deleting one keeps the shared corners for the other.
        var setup = Setup()
        let a = setup.addSurface(), b = setup.addSurface()
        var sb = try #require(setup.surface(b))
        let sa = try #require(setup.surface(a))
        sb.output[0] = sa.output[1]
        sb.output[3] = sa.output[2]
        setup.surfaces[1] = sb
        setup.deleteSurface(a)
        let left = Set(setup.corners.map(\.id))
        #expect(left.contains(sa.output[1]) && left.contains(sa.output[2]))
        #expect(!left.contains(sa.output[0]) && !left.contains(sa.output[3]))
        #expect(setup.outputShape(try #require(setup.surface(b))) != nil)
    }

    @Test func movingASharedCornerMovesBothSurfaces() throws {
        var setup = Setup()
        let a = setup.addSurface(), b = setup.addSurface()
        let shared = try #require(setup.surface(a)).output[1]
        setup.surfaces[1].output[0] = shared
        setup.moveCorner(shared, to: Point2(0.5, 0.2))
        #expect(setup.outputShape(try #require(setup.surface(a)))?[1] == Point2(0.5, 0.2))
        #expect(setup.outputShape(try #require(setup.surface(b)))?[0] == Point2(0.5, 0.2))
    }

    @Test func arrowKeysMoveOnePixelOrTen() throws {
        var setup = Setup()
        let sid = setup.addSurface()
        let id = try #require(setup.surface(sid)).output[0]
        let start = try #require(setup.corner(id))
        setup.nudgeCorner(id, dx: 1, dy: 0, width: 1920, height: 1200)
        var now = try #require(setup.corner(id))
        #expect(abs((now.x - start.x) * 1920 - 1) < 1e-9)
        #expect(now.y == start.y)
        setup.nudgeCorner(id, dx: 0, dy: -10, width: 1920, height: 1200)
        now = try #require(setup.corner(id))
        #expect(abs((now.y - start.y) * 1200 + 10) < 1e-9)
    }

    @Test func cornersStayOnTheOutput() throws {
        var setup = Setup()
        let sid = setup.addSurface()
        let id = try #require(setup.surface(sid)).output[0]
        setup.moveCorner(id, to: Point2(-0.4, 1.7))
        #expect(setup.corner(id) == Corner(id: id, x: 0, y: 1))
        setup.nudgeCorner(id, dx: -10, dy: 10, width: 1920, height: 1080)
        #expect(setup.corner(id) == Corner(id: id, x: 0, y: 1))
    }

    @Test func everyTermHasItsWords() {
        #expect(Terms.all.count == 6)
        #expect(Set(Terms.all.map(\.id)).count == Terms.all.count)
        for term in Terms.all {
            #expect(!term.word.isEmpty && !term.means.isEmpty && !term.inShow.isEmpty, "\(term.id)")
            // House rule: no long dashes in anything a student reads.
            #expect(!(term.means + term.inShow).contains("\u{2014}") && !(term.means + term.inShow).contains("\u{2013}"), "\(term.id)")
        }
        #expect(Terms.surface.inShow.contains("keystone"))
        #expect(Terms.surface.inShow.contains("AI enhancement") && Terms.surface.inShow.contains("dynamic contrast"))
    }
}
