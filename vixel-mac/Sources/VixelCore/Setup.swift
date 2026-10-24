import Foundation

/// One corner on the output. Corners have their own ids, and a surface
/// lists the ids of its corners. Later, two surfaces that meet will simply
/// list the same corner, so dragging it moves both edges together.
public struct Corner: Codable, Equatable, Identifiable {
    public var id: String
    /// 0 at the left edge of the output, 1 at the right edge.
    public var x: Double
    /// 0 at the top of the output, 1 at the bottom.
    public var y: Double

    public init(id: String, x: Double, y: Double) {
        self.id = id
        self.x = x
        self.y = y
    }

    public var point: Point2 { Point2(x, y) }
}

/// What a surface shows: a test pattern or a video.
public struct SurfaceContent: Codable, Equatable {
    public enum Kind: String, Codable, CaseIterable {
        case grid, crosshair, bars, color, video
    }

    public var kind: Kind
    /// The solid color, as #RRGGBB.
    public var color: String
    /// The video file, by its path on this Mac.
    public var video: String?

    public init(kind: Kind = .grid, color: String = "#FFFFFF", video: String? = nil) {
        self.kind = kind
        self.color = color
        self.video = video
    }

    // A kind this Vixel does not know (from a later one) reads as the grid.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decode(Kind.self, forKey: .kind)) ?? .grid
        color = (try? c.decode(String.self, forKey: .color)) ?? "#FFFFFF"
        video = try? c.decodeIfPresent(String.self, forKey: .video)
    }
}

/// A shape on the wall that gets its own picture.
///
/// It keeps two shapes. `output` is where it lands on the wall: the ids of
/// its corners, in order top left, top right, bottom right, bottom left.
/// `input` is which part of the picture it shows, as fractions of the
/// picture in the same order. For now the input is always the whole
/// picture; groups (a later step) change only the input.
public struct Surface: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var output: [String]
    public var input: [Point2]
    public var content: SurfaceContent

    public init(id: String, name: String, output: [String], input: [Point2] = Quad.unit, content: SurfaceContent = SurfaceContent()) {
        self.id = id
        self.name = name
        self.output = output
        self.input = input
        self.content = content
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "Surface"
        output = (try? c.decode([String].self, forKey: .output)) ?? []
        input = (try? c.decode([Point2].self, forKey: .input)) ?? Quad.unit
        content = (try? c.decode(SurfaceContent.self, forKey: .content)) ?? SurfaceContent()
    }
}

/// Everything Vixel remembers: the corners, the surfaces, and the screen
/// picked for the output. Saved as JSON with a version number, so later
/// steps can add to it.
public struct Setup: Codable, Equatable {
    /// The version this Vixel writes.
    public static let currentVersion = 1

    public var version: Int
    public var corners: [Corner]
    /// In drawing order: a later surface draws over an earlier one.
    public var surfaces: [Surface]
    /// The screen picked for the output, by its name. Nil until one is picked.
    public var outputScreen: String?

    public init(corners: [Corner] = [], surfaces: [Surface] = [], outputScreen: String? = nil) {
        self.version = Self.currentVersion
        self.corners = corners
        self.surfaces = surfaces
        self.outputScreen = outputScreen
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        corners = (try? c.decode([Corner].self, forKey: .corners)) ?? []
        surfaces = (try? c.decode([Surface].self, forKey: .surfaces)) ?? []
        outputScreen = try? c.decodeIfPresent(String.self, forKey: .outputScreen)
    }

    // MARK: Looking things up

    public func corner(_ id: String) -> Corner? { corners.first { $0.id == id } }

    public func surface(_ id: String) -> Surface? { surfaces.first { $0.id == id } }

    /// Where a surface lands, as points on the output (0 to 1). Nil if one of
    /// its corners is missing.
    public func outputShape(_ surface: Surface) -> [Point2]? {
        let points = surface.output.compactMap { corner($0)?.point }
        return points.count == surface.output.count && !points.isEmpty ? points : nil
    }

    /// The warp from the surface's own square (0 to 1 each way, top left
    /// first) to where it lands on an output this many pixels across. Nil
    /// while the shape is flat.
    public func warp(_ surface: Surface, width: Double, height: Double) -> Homography? {
        guard let shape = outputShape(surface), shape.count == 4 else { return nil }
        return Homography(from: Quad.unit, to: shape.map { Point2($0.x * width, $0.y * height) })
    }

    // MARK: Changing things

    /// Adds a surface in the middle of the output, a little down and right
    /// of the one before so they never sit exactly on top of each other.
    /// It shows the grid. Returns its id.
    @discardableResult
    public mutating func addSurface() -> String {
        let step = Double(surfaces.count % 5) * 0.04
        let (left, top, right, bottom) = (0.3 + step, 0.3 + step, 0.7 + step, 0.7 + step)
        var made: [String] = []
        for spot in [Point2(left, top), Point2(right, top), Point2(right, bottom), Point2(left, bottom)] {
            let id = newID("c", taken: corners.map(\.id))
            corners.append(Corner(id: id, x: spot.x, y: spot.y))
            made.append(id)
        }
        let id = newID("s", taken: surfaces.map(\.id))
        surfaces.append(Surface(id: id, name: nextName(), output: made))
        return id
    }

    /// Deletes a surface. Its corners go too, unless another surface uses them.
    public mutating func deleteSurface(_ id: String) {
        guard let gone = surface(id) else { return }
        surfaces.removeAll { $0.id == id }
        let stillUsed = Set(surfaces.flatMap(\.output))
        corners.removeAll { gone.output.contains($0.id) && !stillUsed.contains($0.id) }
    }

    /// Gives a surface a new name. A blank name keeps the old one.
    public mutating func rename(_ id: String, to name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, let i = surfaces.firstIndex(where: { $0.id == id }) else { return }
        surfaces[i].name = clean
    }

    /// Moves a corner, kept on the output (0 to 1 each way).
    public mutating func moveCorner(_ id: String, to p: Point2) {
        guard let i = corners.firstIndex(where: { $0.id == id }) else { return }
        corners[i].x = min(1, max(0, p.x))
        corners[i].y = min(1, max(0, p.y))
    }

    /// Moves a corner by whole pixels on an output this many pixels across.
    /// The arrow keys use this: 1 pixel, or 10 with Shift.
    public mutating func nudgeCorner(_ id: String, dx: Double, dy: Double, width: Double, height: Double) {
        guard let c = corner(id), width > 0, height > 0 else { return }
        moveCorner(id, to: Point2(c.x + dx / width, c.y + dy / height))
    }

    public mutating func setContent(_ id: String, _ content: SurfaceContent) {
        guard let i = surfaces.firstIndex(where: { $0.id == id }) else { return }
        surfaces[i].content = content
    }

    /// "Surface 1", "Surface 2" and so on: the lowest number not in use.
    public func nextName() -> String {
        let names = Set(surfaces.map(\.name))
        var n = 1
        while names.contains("Surface \(n)") { n += 1 }
        return "Surface \(n)"
    }

    /// A short id that reads well in the saved file: c1, c2, s1.
    private func newID(_ prefix: String, taken: [String]) -> String {
        let used = taken.compactMap { $0.hasPrefix(prefix) ? Int($0.dropFirst(prefix.count)) : nil }
        return "\(prefix)\((used.max() ?? 0) + 1)"
    }
}
