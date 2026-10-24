import Foundation

/// A point on a flat plane: on the output, or on the picture.
public struct Point2: Codable, Equatable, Hashable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    public static func + (a: Point2, b: Point2) -> Point2 { Point2(a.x + b.x, a.y + b.y) }
    public static func - (a: Point2, b: Point2) -> Point2 { Point2(a.x - b.x, a.y - b.y) }
    public static func * (a: Point2, s: Double) -> Point2 { Point2(a.x * s, a.y * s) }

    public func distance(to other: Point2) -> Double { hypot(x - other.x, y - other.y) }
}

/// A true perspective warp (a homography): it takes any four corners to any
/// other four, the way a flat picture looks on a wall seen at an angle.
/// Straight lines stay straight everywhere, and the middle of the picture
/// lands where the shape's diagonals cross.
///
/// Two triangles are not enough for this. They stretch each half on its
/// own, so lines in the picture bend where the halves meet.
///
/// The nine numbers are read row by row:
///
///     x' = (m0 x + m1 y + m2) / (m6 x + m7 y + m8)
///     y' = (m3 x + m4 y + m5) / (m6 x + m7 y + m8)
public struct Homography: Equatable {
    public var m: [Double]

    public init(_ m: [Double]) {
        precondition(m.count == 9, "a homography has nine numbers")
        self.m = m
    }

    public static let identity = Homography([1, 0, 0, 0, 1, 0, 0, 0, 1])

    /// The warp that takes each of the four `from` corners to the matching
    /// `to` corner. Nil when either shape is flat (three corners on one
    /// line), because no warp can do that.
    public init?(from src: [Point2], to dst: [Point2]) {
        guard src.count == 4, dst.count == 4,
              !Quad.hasThreeInALine(src), !Quad.hasThreeInALine(dst) else { return nil }
        // Eight unknowns (m8 is 1), two lines per corner:
        //   m0 x + m1 y + m2 - m6 x u - m7 y u = u
        //   m3 x + m4 y + m5 - m6 x v - m7 y v = v
        var a = [[Double]]()
        var b = [Double]()
        for i in 0..<4 {
            let (x, y, u, v) = (src[i].x, src[i].y, dst[i].x, dst[i].y)
            a.append([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.append(u)
            a.append([0, 0, 0, x, y, 1, -x * v, -y * v]); b.append(v)
        }
        guard let h = Self.solve(a, b) else { return nil }
        self.m = h + [1]
        // Check the answer lands every corner where it should.
        let scale = max(1, dst.map { max(abs($0.x), abs($0.y)) }.max() ?? 1)
        for i in 0..<4 {
            guard let p = apply(src[i]), p.distance(to: dst[i]) <= 1e-7 * scale else { return nil }
        }
    }

    /// Where a point goes. Nil if it goes off to infinity, which only
    /// happens for points far outside the shape.
    public func apply(_ p: Point2) -> Point2? {
        let w = m[6] * p.x + m[7] * p.y + m[8]
        guard abs(w) > 1e-12 else { return nil }
        return Point2((m[0] * p.x + m[1] * p.y + m[2]) / w, (m[3] * p.x + m[4] * p.y + m[5]) / w)
    }

    /// The warp that undoes this one. Nil if this one is flat.
    public var inverted: Homography? {
        let (a, b, c, d, e, f, g, h, i) = (m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8])
        let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
        guard abs(det) > 1e-15 else { return nil }
        let inv = [
            (e * i - f * h), -(b * i - c * h), (b * f - c * e),
            -(d * i - f * g), (a * i - c * g), -(a * f - c * d),
            (d * h - e * g), -(a * h - b * g), (a * e - b * d),
        ].map { $0 / det }
        return Homography(inv)
    }

    /// Doing `first`, then this one.
    public func after(_ first: Homography) -> Homography {
        var out = [Double](repeating: 0, count: 9)
        for r in 0..<3 {
            for c in 0..<3 {
                out[r * 3 + c] = (0..<3).reduce(0) { $0 + m[r * 3 + $1] * first.m[$1 * 3 + c] }
            }
        }
        return Homography(out)
    }

    /// Solves a x = b by elimination, picking the largest number in each
    /// column first so rounding stays small. Nil if there is no one answer.
    private static func solve(_ a: [[Double]], _ b: [Double]) -> [Double]? {
        let n = b.count
        var rows = (0..<n).map { a[$0] + [b[$0]] }
        for col in 0..<n {
            guard let pivot = (col..<n).max(by: { abs(rows[$0][col]) < abs(rows[$1][col]) }),
                  abs(rows[pivot][col]) > 1e-12 else { return nil }
            rows.swapAt(col, pivot)
            for r in 0..<n where r != col {
                let k = rows[r][col] / rows[col][col]
                if k == 0 { continue }
                for c in col...n { rows[r][c] -= k * rows[col][c] }
            }
        }
        return (0..<n).map { rows[$0][n] / rows[$0][$0] }
    }
}

/// Four-cornered shapes, corners in order: top left, top right, bottom
/// right, bottom left.
public enum Quad {
    /// The whole picture, or the whole output: 0 to 1 each way.
    public static let unit = [Point2(0, 0), Point2(1, 0), Point2(1, 1), Point2(0, 1)]

    /// Twice the area of the triangle a b c, plus or minus by which way it
    /// turns.
    static func turn(_ a: Point2, _ b: Point2, _ c: Point2) -> Double {
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    }

    /// True when some three of the four corners sit on one line (or two sit
    /// on top of each other): the shape has gone flat.
    public static func hasThreeInALine(_ q: [Point2]) -> Bool {
        guard q.count == 4 else { return true }
        let size = max(1e-12, q.map { $0.distance(to: q[0]) }.max() ?? 0)
        for skip in 0..<4 {
            let t = (0..<4).filter { $0 != skip }.map { q[$0] }
            if abs(turn(t[0], t[1], t[2])) <= 1e-9 * size * size { return true }
        }
        return false
    }

    /// True when the shape bulges outward at every corner. A corner dragged
    /// inside the others, or across them, folds the picture over itself.
    public static func isConvex(_ q: [Point2]) -> Bool {
        guard q.count >= 3, !hasThreeInALine(q) else { return false }
        let turns = (0..<q.count).map { turn(q[$0], q[($0 + 1) % q.count], q[($0 + 2) % q.count]) }
        return turns.allSatisfy { $0 > 0 } || turns.allSatisfy { $0 < 0 }
    }

    /// True when the point is inside the shape (any number of corners).
    public static func contains(_ q: [Point2], _ p: Point2) -> Bool {
        var inside = false
        var j = q.count - 1
        for i in 0..<q.count {
            let (a, b) = (q[i], q[j])
            if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside.toggle()
            }
            j = i
        }
        return inside
    }

    /// Where the two diagonals cross. With true perspective, the middle of
    /// the picture lands here.
    public static func diagonalCrossing(_ q: [Point2]) -> Point2? {
        guard q.count == 4 else { return nil }
        let (p, r) = (q[0], q[2] - q[0])
        let (s, t) = (q[1], q[3] - q[1])
        let d = r.x * t.y - r.y * t.x
        guard abs(d) > 1e-12 else { return nil }
        let k = ((s.x - p.x) * t.y - (s.y - p.y) * t.x) / d
        return p + r * k
    }

    /// About how wide and tall the shape is: the average of its top and
    /// bottom edges, and of its left and right edges.
    public static func size(_ q: [Point2]) -> (width: Double, height: Double) {
        guard q.count == 4 else { return (0, 0) }
        let w = (q[0].distance(to: q[1]) + q[3].distance(to: q[2])) / 2
        let h = (q[0].distance(to: q[3]) + q[1].distance(to: q[2])) / 2
        return (w, h)
    }

    /// How many columns and rows the grid pattern gets on a shape this size
    /// (in pixels): `long` cells along the longer side, and as many along
    /// the shorter side as keeps the cells about square. Never fewer than 2.
    public static func gridCells(width: Double, height: Double, long: Int = 8) -> (columns: Int, rows: Int) {
        guard width > 0, height > 0 else { return (long, long) }
        let short = max(2, Int((Double(long) * min(width, height) / max(width, height)).rounded()))
        return width >= height ? (long, short) : (short, long)
    }
}
