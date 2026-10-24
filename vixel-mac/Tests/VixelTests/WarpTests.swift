import Testing
import VixelCore

/// The warp lands each corner exactly where it was dragged, and it is true
/// perspective, not two triangles.
struct WarpTests {
    /// A wall seen from the left on the classroom projector (1920 × 1200):
    /// the far edge is shorter.
    let wall = [Point2(212, 140), Point2(1690, 310), Point2(1655, 960), Point2(180, 1105)]

    @Test func everyCornerLandsWhereItWasDragged() throws {
        let warp = try #require(Homography(from: Quad.unit, to: wall))
        for (from, to) in zip(Quad.unit, wall) {
            let p = try #require(warp.apply(from))
            #expect(p.distance(to: to) < 1e-9)
        }
    }

    @Test func cornersLandOnManyShapes() throws {
        // Shapes from small to the size of a big output, squares to slivers.
        var seed: UInt64 = 7
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 11) / Double(1 << 53)
        }
        var checked = 0
        for _ in 0..<500 {
            let w = 100 + next() * 3740, h = 100 + next() * 2060
            let shape = [
                Point2(next() * w * 0.4, next() * h * 0.4),
                Point2(w * 0.6 + next() * w * 0.4, next() * h * 0.4),
                Point2(w * 0.6 + next() * w * 0.4, h * 0.6 + next() * h * 0.4),
                Point2(next() * w * 0.4, h * 0.6 + next() * h * 0.4),
            ]
            let warp = try #require(Homography(from: Quad.unit, to: shape))
            for (from, to) in zip(Quad.unit, shape) {
                let p = try #require(warp.apply(from))
                #expect(p.distance(to: to) < 1e-6)
            }
            checked += 1
        }
        #expect(checked == 500)
    }

    @Test func theMiddleLandsWhereTheDiagonalsCross() throws {
        // True perspective puts the middle of the picture where the shape's
        // diagonals cross. Two triangles, or a plain stretch, put it at the
        // average of the corners instead, which is somewhere else.
        let warp = try #require(Homography(from: Quad.unit, to: wall))
        let middle = try #require(warp.apply(Point2(0.5, 0.5)))
        let crossing = try #require(Quad.diagonalCrossing(wall))
        #expect(middle.distance(to: crossing) < 1e-9)

        let average = wall.reduce(Point2(0, 0), +) * 0.25
        #expect(middle.distance(to: average) > 5, "this wall is tilted enough that the two differ")
    }

    @Test func straightLinesStayStraight() throws {
        // Points along a straight line across the picture stay on one
        // straight line on the wall. Two triangles would bend this line
        // where it crosses the diagonal they split the shape along.
        let warp = try #require(Homography(from: Quad.unit, to: wall))
        let line = (0...10).map { Double($0) / 10 }.compactMap { warp.apply(Point2($0, 0.3)) }
        #expect(line.count == 11)
        for p in line.dropFirst().dropLast() {
            // How far p sits off the line through the two ends, in pixels.
            let (a, b) = (line.first!, line.last!)
            let off = abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / a.distance(to: b)
            #expect(off < 1e-6)
        }
    }

    @Test func undoingTheWarpGoesBack() throws {
        let warp = try #require(Homography(from: Quad.unit, to: wall))
        let back = try #require(warp.inverted)
        for p in [Point2(0.1, 0.2), Point2(0.5, 0.5), Point2(0.93, 0.71), Point2(0, 1)] {
            let there = try #require(warp.apply(p))
            let again = try #require(back.apply(there))
            #expect(again.distance(to: p) < 1e-9)
        }
        let whole = back.after(warp)
        for p in [Point2(0.25, 0.75), Point2(0.6, 0.1)] {
            #expect(try #require(whole.apply(p)).distance(to: p) < 1e-9)
        }
    }

    @Test func partOfThePictureToTheWall() throws {
        // The input can be part of the picture (a later step uses this): the
        // warp takes those four points to the four corners on the wall.
        let input = [Point2(0.5, 0), Point2(1, 0), Point2(1, 0.5), Point2(0.5, 0.5)]
        let warp = try #require(Homography(from: input, to: wall))
        for (from, to) in zip(input, wall) {
            #expect(try #require(warp.apply(from)).distance(to: to) < 1e-9)
        }
    }

    @Test func aFlatShapeHasNoWarp() {
        // Three corners on one line, or two on top of each other.
        #expect(Homography(from: Quad.unit, to: [Point2(0, 0), Point2(5, 5), Point2(10, 10), Point2(0, 10)]) == nil)
        #expect(Homography(from: Quad.unit, to: [Point2(0, 0), Point2(0, 0), Point2(10, 10), Point2(0, 10)]) == nil)
    }

    @Test func foldedShapesAreSpotted() {
        #expect(Quad.isConvex(wall))
        #expect(Quad.isConvex(Quad.unit))
        // The bottom corners swapped: the shape crosses itself.
        #expect(!Quad.isConvex([Point2(0, 0), Point2(1, 0), Point2(0, 1), Point2(1, 1)]))
        // One corner pushed inside the others.
        #expect(!Quad.isConvex([Point2(0, 0), Point2(1, 0), Point2(0.3, 0.3), Point2(0, 1)]))
    }

    @Test func insideTheShape() {
        #expect(Quad.contains(wall, Point2(900, 600)))
        #expect(!Quad.contains(wall, Point2(100, 600)))
        #expect(!Quad.contains(wall, Point2(1800, 600)))
    }

    @Test func gridCellsStayAboutSquare() {
        #expect(Quad.gridCells(width: 1600, height: 900) == (8, 5))
        #expect(Quad.gridCells(width: 900, height: 1600) == (5, 8))
        #expect(Quad.gridCells(width: 1000, height: 1000) == (8, 8))
        #expect(Quad.gridCells(width: 2000, height: 50) == (8, 2))
    }

    @Test func warpUsesTheOutputsRealPixels() throws {
        // The same surface on a 1920 × 1200 projector and a 1920 × 1080 one:
        // the corners land at the same fraction of each, in that screen's
        // own pixels.
        var setup = Setup()
        let id = setup.addSurface()
        let surface = try #require(setup.surface(id))
        for (w, h) in [(1920.0, 1200.0), (1920.0, 1080.0)] {
            let warp = try #require(setup.warp(surface, width: w, height: h))
            let shape = try #require(setup.outputShape(surface))
            for (from, to) in zip(Quad.unit, shape) {
                let p = try #require(warp.apply(from))
                #expect(p.distance(to: Point2(to.x * w, to.y * h)) < 1e-9)
            }
        }
    }
}
