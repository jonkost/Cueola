import SwiftUI

// The same push buttons as Outrangutan for Mac (its Glass.swift), so the
// suite's Mac apps match.

extension View {
    /// A push button drawn to Apple's macOS 27 kit. The default one fills
    /// with its color; the rest are plain glass.
    func actionButton(prominent: Bool = false) -> some View {
        buttonStyle(ActionStyle(prominent: prominent))
    }

    /// Every action button inside is at least this wide, so a row of
    /// related buttons comes out one size.
    func buttonWidth(_ width: CGFloat) -> some View {
        environment(\.buttonWidth, width)
    }
}

/// Every action button in the app, drawn to Apple's macOS 27 kit: 22
/// points tall, corners lightly rounded (radius 6, never the Mac's
/// capsule), no outline. The default one fills with its color, a
/// destructive one goes red, the rest are plain glass.
struct ActionStyle: ButtonStyle {
    var prominent = false
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
            .foregroundStyle(prominent ? Color.white : (destructive ? Color.red : Color.primary))
            .contentShape(shape)
            .modifier(ButtonSurface(prominent: prominent, destructive: destructive, shape: shape))
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

private struct ButtonSurface: ViewModifier {
    let prominent: Bool
    let destructive: Bool
    let shape: RoundedRectangle

    func body(content: Content) -> some View {
        if prominent {
            content.background(Color.accentColor, in: shape)
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

private struct ButtonWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    var buttonWidth: CGFloat? {
        get { self[ButtonWidthKey.self] }
        set { self[ButtonWidthKey.self] = newValue }
    }
}
