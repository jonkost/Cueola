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

/// Every action button in the app, drawn to Apple's macOS 27 kit: 22
/// points tall, corners lightly rounded (radius 6, never the Mac's
/// capsule), no outline. The default one fills with its color, a
/// destructive one goes red, the rest are plain glass. The text takes
/// the tint when there is one.
struct ActionStyle: ButtonStyle {
    var prominent = false
    var tint: Color? = nil
    @Environment(\.isEnabled) private var enabled
    @Environment(\.buttonWidth) private var width

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        let destructive = configuration.role == .destructive
        configuration.label
            .font(.body)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minWidth: width, minHeight: 22)
            .foregroundStyle(prominent ? Color.white : (destructive ? Color.red : (tint ?? Color.primary)))
            .contentShape(shape)
            .modifier(TransportSurface(color: tint ?? .accentColor, prominent: prominent, destructive: destructive, shape: shape))
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// Buttons that belong together are the same size (the house rule, and
/// the Mac's): a row of buttons is told one width and every button in it
/// takes it, however short its word.
private struct ButtonWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    var buttonWidth: CGFloat? {
        get { self[ButtonWidthKey.self] }
        set { self[ButtonWidthKey.self] = newValue }
    }
}

extension View {
    /// Every action button inside is at least this wide, so a row of
    /// related buttons comes out one size.
    func buttonWidth(_ width: CGFloat) -> some View {
        environment(\.buttonWidth, width)
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
    var destructive = false
    let shape: RoundedRectangle

    func body(content: Content) -> some View {
        if prominent {
            // GO and All Stop are solid color, always, active window or not:
            // a show button must never look gray.
            content.background(color, in: shape)
        } else if destructive {
            // Apple's kit: a red-tinted fill under red text.
            content.background(Color.red.opacity(0.18), in: shape)
        } else if #available(macOS 26, *) {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.background(Color.secondary.opacity(0.16), in: shape)
        }
    }
}
