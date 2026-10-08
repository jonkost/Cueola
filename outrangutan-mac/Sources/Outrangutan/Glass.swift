import SwiftUI

/// Apple's Liquid Glass, the material macOS 26 draws its own controls
/// with. The house guidelines ask for the glass material on every surface
/// that floats over content, so the show's buttons, the SFX pads and the
/// status capsules use it. On macOS 14 and 15 the same views draw the
/// plain look they had before.
extension View {
    /// A button in glass. Prominent ones (GO, All Stop) fill with their
    /// color; the rest are clear glass with a colored symbol.
    @ViewBuilder
    func glassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        if #available(macOS 26, *) {
            if prominent { self.buttonStyle(.glassProminent).tint(tint) } else { self.buttonStyle(.glass).tint(tint) }
        } else {
            if prominent { self.buttonStyle(.borderedProminent).tint(tint) } else { self.buttonStyle(.bordered).tint(tint) }
        }
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
