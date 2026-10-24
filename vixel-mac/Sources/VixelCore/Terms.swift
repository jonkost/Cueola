/// The words Vixel explains behind its ⓘ icons. Each one is a plain
/// sentence saying what it is, then why it matters in a real show.
///
/// A feature is not finished until its words are written here. The tests
/// check that every term has both parts.
public struct Term: Identifiable, Equatable {
    public let id: String
    /// The word itself, as it shows at the top of the ⓘ.
    public let word: String
    /// What it is, in one plain sentence.
    public let means: String
    /// Why it matters in a real show.
    public let inShow: String
}

public enum Terms {
    public static let output = Term(
        id: "output",
        word: "Output",
        means: "The screen Vixel sends its picture to, usually the projector.",
        inShow: "Pick the projector here. The picture fills it edge to edge, while this window stays on your own screen so you can run things without the audience seeing."
    )

    public static let surface = Term(
        id: "surface",
        word: "Surface",
        means: "A shape on the wall that gets its own picture, like a flat, a screen or the front of a box.",
        inShow: "Give each thing you want to light its own surface, so its picture fits that thing exactly. Turn off the projector's own keystone and its auto picture modes (AI enhancement, dynamic contrast). Vixel does the warping, and the projector should show exactly what Vixel sends."
    )

    public static let corner = Term(
        id: "corner",
        word: "Corner",
        means: "A point you drag to pin one corner of a surface to the real corner on the wall.",
        inShow: "Put each corner on the real edge of the object and the picture fits it. For the last bit, click a corner and use the arrow keys: 1 pixel at a time, or 10 with Shift."
    )

    public static let testPattern = Term(
        id: "testPattern",
        word: "Test pattern",
        means: "A picture made for lining things up: a grid, a crosshair, color bars or a solid color.",
        inShow: "Straight lines show at once when a surface is crooked, and color bars show when the projector is changing the colors. Line everything up on a pattern before the show, then switch to the real picture."
    )

    public static let keystone = Term(
        id: "keystone",
        word: "Keystone",
        means: "A projector setting that squares up the picture when the projector is tilted.",
        inShow: "Turn it off on the projector and let Vixel do the warping. The projector's keystone squeezes the whole picture, makes it softer, and moves every surface you lined up."
    )

    public static let perspective = Term(
        id: "perspective",
        word: "Perspective",
        means: "How a flat picture looks on a surface seen at an angle: the far side gets smaller.",
        inShow: "Vixel warps every picture with true perspective, so straight lines in the picture stay straight on the wall. A simpler warp bends them where the shape's two halves meet."
    )

    /// Every term, in the order they first show on screen.
    public static let all = [output, surface, corner, testPattern, keystone, perspective]
}
