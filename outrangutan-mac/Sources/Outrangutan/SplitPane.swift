import AppKit
import SwiftUI

/// Two panels side by side (or one over the other) with a divider that
/// drags, remembered between launches. Built from plain SwiftUI: the Mac's
/// own split view, wrapped around these panels, sent the window into an
/// endless layout loop (the launch crash of Oct 8).
struct SplitPane<First: View, Second: View>: View {
    let axis: Axis
    /// The first panel's share of the room, 0 to 1.
    @Binding var share: Double
    /// The least each panel may have, in points.
    var firstMin: CGFloat = 300
    var secondMin: CGFloat = 300
    @ViewBuilder let first: () -> First
    @ViewBuilder let second: () -> Second
    @State private var dragStart: Double?

    var body: some View {
        GeometryReader { geo in
            let total = axis == .horizontal ? geo.size.width : geo.size.height
            let room = max(0, total - 1)
            let low = min(firstMin, room), high = max(low, room - secondMin)
            let firstSize = min(max(room * share, low), high)
            let secondSize = max(0, room - firstSize)
            Group {
                if axis == .horizontal {
                    HStack(spacing: 0) {
                        first().frame(width: firstSize)
                        divider(room: room)
                        second().frame(width: secondSize)
                    }
                } else {
                    VStack(spacing: 0) {
                        first().frame(height: firstSize)
                        divider(room: room)
                        second().frame(height: secondSize)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    private func divider(room: CGFloat) -> some View {
        Rectangle()
            .fill(Color.primary.opacity(0.12))
            .frame(width: axis == .horizontal ? 1 : nil, height: axis == .vertical ? 1 : nil)
            .overlay {
                // A wider, invisible grab area, with the resize cursor.
                Color.clear
                    .frame(width: axis == .horizontal ? 9 : nil, height: axis == .vertical ? 9 : nil)
                    .contentShape(Rectangle())
                    .onHover { inside in
                        if inside { (axis == .horizontal ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).push() } else { NSCursor.pop() }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { value in
                                if dragStart == nil { dragStart = share }
                                let moved = axis == .horizontal ? value.translation.width : value.translation.height
                                guard room > 0 else { return }
                                let low = min(firstMin, room) / room, high = max(low, (room - secondMin) / room)
                                share = min(max((dragStart ?? share) + Double(moved / room), low), high)
                            }
                            .onEnded { _ in dragStart = nil }
                    )
            }
    }
}
