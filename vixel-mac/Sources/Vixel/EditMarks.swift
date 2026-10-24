import SwiftUI
import UniformTypeIdentifiers
import VixelCore

/// The marks drawn over the picture while editing: each surface's outline,
/// its name, and a handle on every corner.
///
/// The output shows them only while Edit is on, so the wall is clean for
/// the show. The preview in the control window shows them too, and there
/// the handles can be dragged.
struct EditMarks: View {
    @ObservedObject var stage: Stage
    let role: MapRole
    /// The corner being dragged, and where it started.
    @State private var drag: (id: String, start: Point2)?

    private var interactive: Bool { role == .preview }
    /// Bigger on the wall, so the handles are easy to see from the booth.
    private var handleSize: CGFloat { role == .output ? 34 : 14 }
    private var nameSize: CGFloat { role == .output ? 22 : 11 }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                if interactive {
                    // Clicking the picture picks the surface under the pointer.
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(coordinateSpace: .local) { at in
                            stage.selectedSurface = stage.surface(at: Point2(at.x / size.width, at.y / size.height))?.id
                        }
                }
                outlines(size)
                if stage.editing {
                    names(size)
                    handles(size)
                }
            }
            .dropDestination(for: URL.self) { urls, at in
                guard interactive, let url = urls.first(where: isVideo) else { return false }
                let target = stage.surface(at: Point2(at.x / size.width, at.y / size.height)) ?? stage.selected
                guard let id = target?.id else { return false }
                stage.setVideo(url, for: id)
                stage.selectedSurface = id
                return true
            }
        }
        .allowsHitTesting(interactive)
    }

    // MARK: Outlines

    private func outlines(_ size: CGSize) -> some View {
        Canvas { context, _ in
            for surface in stage.setup.surfaces {
                let picked = surface.id == stage.selectedSurface
                // Out of Edit, the wall shows nothing and the preview shows
                // only which surface is picked.
                guard stage.editing || (interactive && picked) else { continue }
                guard let shape = stage.setup.outputShape(surface), shape.count >= 3 else { continue }
                var path = Path()
                path.addLines(shape.map { point($0, size) })
                path.closeSubpath()
                let width: CGFloat = role == .output ? 3 : 1.5
                // Dark under light, so the line shows on any picture.
                context.stroke(path, with: .color(.black.opacity(0.6)), lineWidth: width + 2)
                let folded = shape.count == 4 && !Quad.isConvex(shape)
                let color: Color = folded ? .orange : (picked ? .accentColor : .white)
                context.stroke(path, with: .color(color), lineWidth: width)
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: Names

    private func names(_ size: CGSize) -> some View {
        ForEach(stage.setup.surfaces) { surface in
            if let shape = stage.setup.outputShape(surface) {
                let middle = Quad.diagonalCrossing(shape) ?? shape.reduce(Point2(0, 0), +) * (1 / Double(shape.count))
                Text(surface.name)
                    .font(.system(size: nameSize, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, nameSize * 0.5)
                    .padding(.vertical, nameSize * 0.2)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: nameSize * 0.35, style: .continuous))
                    .fixedSize()
                    .position(point(middle, size))
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: Handles

    private func handles(_ size: CGSize) -> some View {
        // Each corner once, even if two surfaces share it later.
        let used = Set(stage.setup.surfaces.flatMap(\.output))
        let corners = stage.setup.corners.filter { used.contains($0.id) }
        return ForEach(corners) { corner in
            Handle(size: handleSize, picked: corner.id == stage.selectedCorner,
                   onPickedSurface: stage.selected?.output.contains(corner.id) ?? false)
                .position(point(corner.point, size))
                .gesture(dragCorner(corner, in: size), including: interactive ? .all : .none)
        }
    }

    private func dragCorner(_ corner: Corner, in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if drag?.id != corner.id {
                    drag = (corner.id, corner.point)
                    stage.selectedCorner = corner.id
                    if !(stage.selected?.output.contains(corner.id) ?? false) {
                        stage.selectedSurface = stage.setup.surfaces.last { $0.output.contains(corner.id) }?.id
                        stage.selectedCorner = corner.id
                    }
                }
                guard let start = drag?.start else { return }
                stage.moveCorner(corner.id, to: Point2(start.x + value.translation.width / size.width,
                                                      start.y + value.translation.height / size.height))
            }
            .onEnded { _ in drag = nil }
    }

    private func point(_ p: Point2, _ size: CGSize) -> CGPoint {
        CGPoint(x: p.x * size.width, y: p.y * size.height)
    }

    private func isVideo(_ url: URL) -> Bool {
        (UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie)) ?? false
    }
}

/// A corner handle: a ring with a dot at the exact point. The picked corner
/// fills with the accent color.
private struct Handle: View {
    let size: CGFloat
    let picked: Bool
    let onPickedSurface: Bool

    var body: some View {
        let ring = max(1.5, size / 9)
        ZStack {
            Circle()
                .fill(picked ? Color.accentColor.opacity(0.85) : Color.black.opacity(0.35))
            Circle()
                .strokeBorder(Color.black.opacity(0.6), lineWidth: ring + 2)
            Circle()
                .strokeBorder(picked || onPickedSurface ? Color.accentColor : Color.white, lineWidth: ring)
                .padding(1)
            Circle()
                .fill(Color.white)
                .frame(width: max(3, size / 6), height: max(3, size / 6))
                .overlay(Circle().stroke(Color.black.opacity(0.6), lineWidth: 1))
        }
        .frame(width: size, height: size)
        .contentShape(Circle().inset(by: -6))
    }
}
