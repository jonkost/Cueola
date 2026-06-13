# Apple HIG Foundation Notes for Cueola

Reviewed against Apple's live Human Interface Guidelines on 2026-06-13. These
notes are a design brief, not an app implementation.

## Product direction

Cueola should adopt the HIG as a behavior and hierarchy system, not as a surface
skin. Familiar controls, readable type, semantic color, adaptable layout, and
accessible feedback come first. Glass, gradients, and animation are secondary.

## Layout and hierarchy

- Keep content and controls visually distinct. Navigation and controls belong on
  a functional layer above the content layer.
- Group related items with spacing, alignment, separators, or restrained
  materials. Give essential information room and progressively disclose detail.
- Design for resizing, orientation, localization, long text, and large text from
  the start. Respect platform safe areas and avoid edge-crowded controls.
- Preserve a stable reading order. Use leading and trailing concepts so layouts
  can mirror correctly for right-to-left languages.
- Start with the full layout and collapse only when it no longer fits. Prefer
  removing tertiary detail before destabilizing primary navigation.

## Materials and Liquid Glass

- Liquid Glass is for the control and navigation layer, such as toolbars,
  sidebars, tab bars, and transient interactive controls.
- Do not use Liquid Glass as the general content background. Use standard
  materials or solid semantic surfaces inside the content layer.
- Use glass sparingly. Prefer the regular variant where text or complex content
  needs reliable contrast. Clear glass is suitable only over rich media with a
  verified dimming and contrast strategy.
- Treat reduce-transparency and increased-contrast behavior as requirements, not
  optional refinements.

## Typography

- Use the platform system font. SF Pro is the system face on iOS, iPadOS, macOS,
  tvOS, and visionOS; SF Compact is the watchOS system face.
- Do not embed Apple system font files in the app. On the web, use a system font
  stack and allow Apple devices to select San Francisco themselves.
- Prefer Regular, Medium, Semibold, and Bold for interface text. Avoid light
  weights at small sizes.
- HIG defaults are 17 pt on iOS/iPadOS, 13 pt on macOS, 29 pt on tvOS, 17 pt on
  visionOS, and 16 pt on watchOS. Minimums vary by platform and are recorded in
  `reference.json`.
- Build hierarchy with semantic text styles. Layouts must survive at least 200%
  text enlargement where practical, with minimal truncation and a stable content
  hierarchy.
- Match symbol weight to adjacent text and scale meaningful icons with text.

## Symbols and interface icons

- Prefer a familiar SF Symbol over inventing a new glyph when it expresses the
  action accurately.
- Keep icon sets consistent in weight, detail, perspective, and optical size.
  Geometric centering is not always optical centering.
- Use outline variants for common toolbar and list contexts. Use fill variants to
  add emphasis or communicate selection, not merely as decoration.
- Start with monochrome for controls. Use hierarchical, palette, multicolor, or
  gradient rendering only when the extra layers improve meaning and legibility.
- Treat symbols as meaningful content: icon-only controls need an accessible
  name; decorative symbols should be hidden from assistive technology.
- Availability varies by operating system. A future native client needs fallbacks
  for symbols introduced after its minimum OS.
- Directional and reading-related symbols may need automatic right-to-left
  variants. Logos, checkmarks, clocks, and other universal or real-world marks
  generally should not be mirrored.
- Never use SF Symbols, or confusingly similar images, in app icons, logos, or
  trademark uses.

## Color and contrast

- Name colors by role, such as label, secondary label, background, elevated
  surface, separator, accent, success, warning, and destructive.
- Every custom role needs light, dark, and increased-contrast behavior. Do not
  reuse one color to mean both interactive and noninteractive content.
- Do not communicate status with color alone. Pair color with shape, text, or a
  symbol.
- Use WCAG AA as the initial measurable floor: 4.5:1 for normal text and 3:1 for
  large or bold text. Test icons and controls as foreground content too.
- Test in bright and dim environments, on multiple displays, and with system
  contrast settings enabled.

## Accessibility and interaction

- Target 44x44 pt controls on touch platforms when possible. The HIG minimum is
  28x28 pt on iOS/iPadOS/watchOS and 20x20 pt on macOS.
- Leave enough separation between controls to prevent accidental activation.
- Every gesture-only action needs an obvious control alternative.
- Support keyboard navigation, visible focus, VoiceOver labels, logical reading
  order, and text alternatives for meaningful media.
- Avoid timed dismissal for important content. Give people direct playback and
  animation controls.
- Respect Reduce Motion by removing repetitive, peripheral, depth, blur, zoom,
  and large-axis movement. Prefer restrained fades where motion is not essential.

## Cueola review gates

Before a future HIG-aligned component is merged, verify:

- semantic tokens rather than hard-coded presentation values
- light, dark, increased contrast, and reduced transparency
- keyboard-only and screen-reader operation
- 200% text sizing without lost primary actions
- minimum target size and control spacing
- reduced-motion behavior
- right-to-left layout and directional symbol behavior
- a text label or accessibility name for every meaningful icon
- symbol availability and a fallback strategy

## Official sources

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [SF Symbols guidance](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)
- [Interface icons](https://developer.apple.com/design/human-interface-guidelines/icons)
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left)
- [SF Symbols downloads](https://developer.apple.com/sf-symbols/)
- [Fonts for Apple platforms](https://developer.apple.com/fonts/)
