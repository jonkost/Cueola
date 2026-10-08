import SwiftUI

/// Apple's Liquid Glass, the material macOS 26 draws its own controls
/// with. The house guidelines ask for the glass material on every surface
/// that floats over content, so the show's buttons, the SFX pads and the
/// status capsules use it. On macOS 14 and 15 the same views draw the
/// plain look they had before.
extension View {
    /// A button in glass. Prominent ones (GO, All Stop) fill with their
    /// color; the rest are clear glass with a colored symbol.
    func glassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        buttonStyle(ActionStyle(prominent: prominent, tint: tint))
    }

    /// A surface in glass, tinted or clear: a pad tile, a bank pill, a
    /// status capsule. `interactive` makes it answer to the pointer, for
    /// things that are pressed.
    @ViewBuilder
    func glassSurface<S: Shape>(tint: Color? = nil, interactive: Bool = false, in shape: S) -> some View {
        if #available(macOS 26, *) {
            self.glassEffect(Self.glass(tint: tint, interactive: interactive), in: shape)
        } else {
            self.background((tint ?? Color.secondary).opacity(tint == nil ? 0.12 : 0.35), in: shape)
        }
    }

    @available(macOS 26, *)
    private static func glass(tint: Color?, interactive: Bool) -> Glass {
        var g = Glass.regular
        if let tint { g = g.tint(tint) }
        if interactive { g = g.interactive() }
        return g
    }
}

/// Groups glass views that sit near each other, so the system can blend
/// and morph them as one. Plain grouping on older Macs.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: () -> Content

    var body: some View {
        if #available(macOS 26, *) {
            GlassEffectContainer(spacing: spacing) { content() }
        } else {
            content()
        }
    }
}

/// Every action button in the app: a rounded rectangle (radius 8, the
/// big five use 12), never the Mac's capsule, so all of them share one
/// shape. Prominent ones fill with their color; the rest are clear glass
/// with a hairline. The text takes the tint when there is one.
struct ActionStyle: ButtonStyle {
    var prominent = false
    var tint: Color? = nil
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        configuration.label
            .font(.body.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .foregroundStyle(prominent ? Color.white : (tint ?? Color.primary))
            .contentShape(shape)
            .modifier(TransportSurface(color: tint ?? .accentColor, prominent: prominent, shape: shape))
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// The show's big buttons: a rounded rectangle at the house control
/// radius (12), not the Mac's capsule, in glass. GO and All Stop fill
/// with their color; the others are clear glass with a colored symbol.
struct TransportStyle: ButtonStyle {
    let color: Color
    let prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        configuration.label
            .frame(maxWidth: .infinity, minHeight: 64)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .contentShape(shape)
            .modifier(TransportSurface(color: color, prominent: prominent, shape: shape))
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

private struct TransportSurface: ViewModifier {
    let color: Color
    let prominent: Bool
    let shape: RoundedRectangle

    func body(content: Content) -> some View {
        if prominent {
            // GO and All Stop are solid color, always, active window or not:
            // a show button must never look gray.
            content.background(color, in: shape)
        } else if #available(macOS 26, *) {
            content
                .glassEffect(.regular.interactive(), in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.12)))
        } else {
            content
                .background(Color.secondary.opacity(0.14), in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.12)))
        }
    }
}
