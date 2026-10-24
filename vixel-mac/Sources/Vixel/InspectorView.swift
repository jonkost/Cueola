import AppKit
import SwiftUI
import UniformTypeIdentifiers
import VixelCore

/// The Inspector on the right: the output, then the picked surface and its
/// corners, in the order you set them up. Laid out like the form in Apple's
/// macOS kit: grouped rows, the word on the left, its control on the right,
/// an ⓘ at the end of the row.
struct InspectorView: View {
    @ObservedObject var stage: Stage
    @ObservedObject var output: OutputController

    var body: some View {
        Form {
            outputSection
            if let surface = stage.selected {
                surfaceSection(surface)
                cornerSection(surface)
                Section {
                    Button("Delete Surface", role: .destructive) { stage.askingToDelete = surface.id }
                        .actionButton()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                Section {
                    Text(stage.setup.surfaces.isEmpty
                         ? "Add a surface with the + button, then drag its corners onto a shape on the wall."
                         : "Pick a surface in the list or in the picture.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Output

    private var outputSection: some View {
        Section {
            HStack {
                Picker("Screen", selection: screenBinding) {
                    ForEach(screenNames, id: \.self) { name in
                        Text(screenLabel(name)).tag(name)
                    }
                }
                InfoButton(term: Terms.output)
            }
            LabeledContent("Size") {
                Text(verbatim: "\(Int(stage.outputPixels.width)) × \(Int(stage.outputPixels.height)) pixels").monospacedDigit()
            }
            LabeledContent("Shows as") {
                Text(output.fullScreenOn != nil ? "Full screen" : (output.isOpen ? "A window" : "Closed"))
            }
            LabeledContent("Projector keystone") {
                HStack {
                    Text("Turn it off")
                    InfoButton(term: Terms.keystone)
                }
            }
        } header: {
            Text("Output")
        }
    }

    /// Every screen, plus the picked one if it is unplugged right now.
    private var screenNames: [String] {
        var names = output.screens.map(\.name)
        if let picked = stage.setup.outputScreen, !names.contains(picked) { names.append(picked) }
        return names
    }

    private func screenLabel(_ name: String) -> String {
        guard let screen = output.screens.first(where: { $0.name == name }) else { return "\(name) (not connected)" }
        return screen.isControl ? "\(name) (this screen)" : name
    }

    /// The picked screen; with none picked, the one the output is on now.
    private var screenBinding: Binding<String> {
        Binding(
            get: {
                stage.setup.outputScreen ?? output.fullScreenOn ?? output.screens.first(where: \.isControl)?.name ?? ""
            },
            set: { name in
                stage.setOutputScreen(name)
                output.place()
            }
        )
    }

    // MARK: Surface

    private func surfaceSection(_ surface: Surface) -> some View {
        Section {
            NameField(stage: stage, surface: surface)
                .id(surface.id)
            HStack {
                Picker("Shows", selection: kindBinding(surface)) {
                    Text("Grid").tag(SurfaceContent.Kind.grid)
                    Text("Crosshair").tag(SurfaceContent.Kind.crosshair)
                    Text("Color Bars").tag(SurfaceContent.Kind.bars)
                    Text("Solid Color").tag(SurfaceContent.Kind.color)
                    Divider()
                    Text("Video").tag(SurfaceContent.Kind.video)
                }
                InfoButton(term: Terms.testPattern)
            }
            if surface.content.kind == .color {
                ColorPicker("Color", selection: colorBinding(surface), supportsOpacity: false)
            }
            if surface.content.kind == .video {
                LabeledContent("Video") {
                    Text(surface.content.video.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "None")
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if let path = surface.content.video, !FileManager.default.fileExists(atPath: path) {
                    Label("The file is missing. Choose it again.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                HStack {
                    Spacer()
                    Button("Choose Video\u{2026}") { chooseVideo(for: surface.id) }
                        .actionButton()
                }
            }
            if stage.gridOnAll {
                Label("Grid on All is on, so every surface shows the grid for now.", systemImage: "grid")
                    .foregroundStyle(.secondary)
            }
        } header: {
            HStack(spacing: 4) {
                Text("Surface")
                InfoButton(term: Terms.surface)
            }
        }
    }

    private func kindBinding(_ surface: Surface) -> Binding<SurfaceContent.Kind> {
        Binding(
            get: { stage.setup.surface(surface.id)?.content.kind ?? .grid },
            set: { kind in
                guard var content = stage.setup.surface(surface.id)?.content else { return }
                content.kind = kind
                stage.setContent(surface.id, content)
                // Video with no file yet: ask for one.
                if kind == .video, content.video == nil { chooseVideo(for: surface.id) }
            }
        )
    }

    private func colorBinding(_ surface: Surface) -> Binding<Color> {
        Binding(
            get: { Color(nsColor: NSColor(hex: stage.setup.surface(surface.id)?.content.color ?? "") ?? .white) },
            set: { color in
                guard var content = stage.setup.surface(surface.id)?.content else { return }
                content.color = NSColor(color).hexString
                stage.setContent(surface.id, content)
            }
        )
    }

    private func chooseVideo(for id: String) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.movie]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a video for this surface. It loops, with no sound."
        if panel.runModal() == .OK, let url = panel.url { stage.setVideo(url, for: id) }
    }

    // MARK: Corners

    private static let cornerNames = ["Top left", "Top right", "Bottom right", "Bottom left"]
    private static let cornerSymbols = ["arrow.up.left", "arrow.up.right", "arrow.down.right", "arrow.down.left"]

    private func cornerSection(_ surface: Surface) -> some View {
        Section {
            if surface.output.count == 4 {
                Picker("Picked", selection: $stage.selectedCorner) {
                    ForEach(0..<4, id: \.self) { i in
                        Image(systemName: Self.cornerSymbols[i])
                            .accessibilityLabel(Self.cornerNames[i])
                            .tag(Optional(surface.output[i]))
                    }
                }
                .pickerStyle(.segmented)
                .disabled(!stage.editing)
            }
            if let id = stage.selectedCorner, let i = surface.output.firstIndex(of: id), let corner = stage.setup.corner(id) {
                LabeledContent(Self.cornerNames[i]) {
                    Text(verbatim: "\(Int((corner.x * stage.outputPixels.width).rounded())), \(Int((corner.y * stage.outputPixels.height).rounded())) pixels")
                        .monospacedDigit()
                }
            }
            Text(stage.editing
                 ? "Drag a corner in the picture. Or pick one and use the arrow keys: 1 pixel, or 10 with Shift."
                 : "Turn on Edit in the toolbar to move corners.")
                .font(.callout)
                .foregroundStyle(.secondary)
            LabeledContent("Warp") {
                HStack {
                    Text("True perspective")
                    InfoButton(term: Terms.perspective)
                }
            }
            if let shape = stage.setup.outputShape(surface), shape.count == 4, !Quad.isConvex(shape) {
                Label("This shape folds over itself. Drag a corner back out.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
        } header: {
            HStack(spacing: 4) {
                Text("Corners")
                InfoButton(term: Terms.corner)
            }
        }
    }
}

/// The surface's name. It saves when you press Return or click away; a
/// blank name keeps the old one.
private struct NameField: View {
    @ObservedObject var stage: Stage
    let surface: Surface
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("Name", text: $draft)
            .focused($focused)
            .onSubmit(commit)
            .onAppear { draft = surface.name }
            // Picking another surface makes a new field, so this one saves
            // its own surface's name as it goes.
            .onDisappear(perform: commit)
            .onChange(of: surface.name) { if !focused { draft = surface.name } }
            .onChange(of: focused) { if !focused { commit() } }
    }

    private func commit() {
        stage.rename(surface.id, to: draft)
        draft = stage.setup.surface(surface.id)?.name ?? draft
    }
}
