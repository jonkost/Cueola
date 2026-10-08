import SwiftUI

/// Outrangutan Help (Help menu, Command-?): the app in plain words, one
/// topic at a time, written for students running the show.
struct HelpView: View {
    @ObservedObject private var keys = KeyMap.shared
    @State private var topic: String? = "build"

    private struct Topic: Identifiable {
        let id: String
        let title: String
        let symbol: String
        let lines: [String]
    }

    private var topics: [Topic] {
        [
            Topic(id: "build", title: "Build a Show", symbol: "film.stack", lines: [
                "Drag videos, sounds and stills into the window, or click Add Media in the toolbar.",
                "Add Matte makes a solid color picture: black, white, or a chroma green or blue.",
                "Drag cues up and down to change the order. Command-D makes a copy of a cue.",
                "Click a cue to stand it by. Its settings appear in the Inspector on the right (Command-I).",
                "Cue tab: name, notes, a color, whether GO fires it, a pad that plays with it, and OBS.",
                "Timing tab: a wait before it starts, what happens next (Manual, Continue, Follow), and what happens at the end.",
                "Trim and Sound tab: drag the yellow handles to trim, or type the times. Loop and volume.",
                "Fades tab: fade in, fade out and dissolve, with a curve.",
                "Picture tab: which output it shows on, how it fits the screen, and a key for green screen or graphics on black.",
                "Made a mistake? Edit, Undo (Command-Z) takes it back.",
            ]),
            Topic(id: "run", title: "Run the Show", symbol: "play.circle", lines: [
                "Open the outputs first: the Outputs button in the toolbar. A second screen fills edge to edge.",
                "\(keys.name(.go)) is GO: it fires the cue standing by and stands by the next one.",
                "\(keys.name(.pause)) pauses everything; press it again to carry on.",
                "\(keys.name(.stop)) stops what fired last. \(keys.name(.fade)) fades everything out over one second.",
                "\(keys.name(.allStop)) is All Stop: everything off at once, pads too. Use it when something goes wrong.",
                "The Up and Down arrows move the standby.",
                "The big clock counts down what is left. Click it to count up instead. Under it is the time of day.",
                "The strip under the buttons shows the program picture, its brightness (waveform) and color (vectorscope), and how loud the cues are.",
                "Window, Multiview (Shift-Command-M) is a monitor wall for the director's screen: Program, a preview of the standby cue (Roll plays a video silently between its trim points), the clock and the next cues. Full screen with the green button.",
                "Lock Editing (the lock in the toolbar) keeps a stray click from changing the show. GO and the keys still work.",
            ]),
            Topic(id: "pads", title: "SFX Pads", symbol: "square.grid.3x3.fill", lines: [
                "Click SFX in the toolbar (Command-2), or Both to see the pads beside the cues (Command-3; View, Layout stacks them instead). Drop sounds on the pads, or click an empty pad to pick one.",
                "Click a pad, or press its key, to play it. Several at once lets pads play on top of each other.",
                "Record puts a new sound from the microphone on the next empty pad.",
                "The Inspector sets each pad's name, emoji, color, key, volume, EQ, fades and trim.",
                "Banks are pages of pads. Search in the toolbar to find a pad in any bank.",
            ]),
            Topic(id: "cueola", title: "Connect to Cueola", symbol: "antenna.radiowaves.left.and.right", lines: [
                "File, Connect to a Show (Command-K): sign in the way you sign in to Cueola, and type the show code.",
                "Then the director's TAKE on the rundown and KeyWi Bird's playback keys fire cues here.",
                "The light in the toolbar is green when the show is heard. A lightning bolt means KeyWi Bird on this Mac is linked directly.",
                "On the Mac with the Stream Deck, turn on Outrangutan for Mac in KeyWi Bird's Deck settings. Keys then arrive at once, even with the internet down.",
            ]),
            Topic(id: "before", title: "Before the Show", symbol: "checkmark.seal", lines: [
                "Click Show Check in the toolbar. Fix everything red; look at everything orange.",
                "Plug in the power adapter. Open the outputs. Lock editing.",
                "Save a show file (Command-S) to carry the show to another Mac or open it in the web app.",
                "Settings, OBS connects OBS Studio, so cues can switch scenes and start recording.",
            ]),
            Topic(id: "trouble", title: "When Something Goes Wrong", symbol: "lifepreserver", lines: [
                "Wrong thing on air: \(keys.name(.allStop)) (All Stop). Then stand by the right cue and GO.",
                "A cue says File missing: it was moved. Right-click it, Remove, and add the file again.",
                "The output landed on this screen: its cable came loose. Plug it back in; the output goes back on its own.",
                "The rundown's fires don't arrive: look at the light in the toolbar, then Show Check.",
                "The app closed during the show: open it again. A bar offers to stand by the cue that was on air, at the point it stopped.",
                "Window, Show Log (Command-L) lists everything that happened, with times.",
            ]),
        ]
    }

    var body: some View {
        NavigationSplitView {
            List(topics, selection: $topic) { t in
                Label(t.title, systemImage: t.symbol).tag(t.id)
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 210)
        } detail: {
            if let t = topics.first(where: { $0.id == topic }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Label(t.title, systemImage: t.symbol).font(.largeTitle.weight(.semibold))
                        ForEach(Array(t.lines.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Circle().fill(Color.accentColor).frame(width: 6, height: 6).offset(y: -3)
                                Text(line).font(.title3).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(28)
                    .frame(maxWidth: 640, alignment: .leading)
                }
            } else {
                ContentUnavailableView("Pick a Topic", systemImage: "questionmark.circle")
            }
        }
        .navigationTitle("Outrangutan Help")
        .frame(minWidth: 760, minHeight: 480)
    }
}

/// Help menu: opens the Help window.
struct HelpButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Outrangutan Help") { openWindow(id: "help") }
            .keyboardShortcut("?", modifiers: .command)
    }
}
