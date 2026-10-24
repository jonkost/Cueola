import SwiftUI
import UniformTypeIdentifiers
import VixelCore

/// The control window, laid out like the window in Apple's macOS kit: the
/// surfaces in the sidebar, the output's picture in the middle, the
/// Inspector on the right, the tools in the toolbar.
struct ControlView: View {
    @ObservedObject var stage: Stage
    @ObservedObject var output: OutputController
    @AppStorage("ui.inspector") private var showInspector = true

    var body: some View {
        NavigationSplitView {
            SurfaceList(stage: stage)
                .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 320)
        } detail: {
            PreviewArea(stage: stage, output: output)
        }
        .navigationTitle("Vixel")
        .inspector(isPresented: $showInspector) {
            InspectorView(stage: stage, output: output)
                .inspectorColumnWidth(min: 300, ideal: 330, max: 400)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { stage.addSurface() } label: {
                    Label("Add Surface", systemImage: "plus")
                }
                .help("Add a surface")
                Toggle(isOn: $stage.editing) {
                    Label("Edit", systemImage: "skew")
                }
                .help("Edit: show every outline, corner and name on the output, and move corners")
                Toggle(isOn: $stage.gridOnAll) {
                    Label("Grid on All", systemImage: "grid")
                }
                .help("Put the grid on every surface, for lining up")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { showInspector.toggle() } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }
                .help("Show or hide the Inspector")
            }
        }
        .confirmationDialog(deleteTitle, isPresented: deleteAsked, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let id = stage.askingToDelete { stage.deleteSurface(id) }
                stage.askingToDelete = nil
            }
            Button("Cancel", role: .cancel) { stage.askingToDelete = nil }
        } message: {
            Text("Its corners go with it. This cannot be undone.")
        }
        // Closing the control window quits, so a full-screen output is never
        // left on the wall with nothing to control it.
        .onDisappear { NSApp.terminate(nil) }
    }

    private var deleteTitle: String {
        let name = stage.askingToDelete.flatMap { stage.setup.surface($0)?.name } ?? "this surface"
        return "Delete \u{201C}\(name)\u{201D}?"
    }

    private var deleteAsked: Binding<Bool> {
        Binding(get: { stage.askingToDelete != nil }, set: { if !$0 { stage.askingToDelete = nil } })
    }
}

/// The sidebar: every surface, top of the list drawn first.
struct SurfaceList: View {
    @ObservedObject var stage: Stage

    var body: some View {
        List(selection: $stage.selectedSurface) {
            Section("Surfaces") {
                ForEach(stage.setup.surfaces) { surface in
                    Label {
                        Text(surface.name)
                    } icon: {
                        ContentIcon(content: surface.content)
                    }
                    .tag(surface.id)
                    .contextMenu {
                        Button("Delete Surface\u{2026}", role: .destructive) { stage.askingToDelete = surface.id }
                    }
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first(where: { UTType(filenameExtension: $0.pathExtension)?.conforms(to: .movie) ?? false }) else { return false }
                        stage.setVideo(url, for: surface.id)
                        stage.selectedSurface = surface.id
                        return true
                    }
                }
            }
        }
        .onDeleteCommand {
            if let id = stage.selectedSurface { stage.askingToDelete = id }
        }
        .overlay {
            if stage.setup.surfaces.isEmpty {
                ContentUnavailableView("No Surfaces", systemImage: "skew",
                                       description: Text("Add one with the + button in the toolbar."))
            }
        }
    }
}

/// The small picture beside a surface's name: what it shows.
struct ContentIcon: View {
    let content: SurfaceContent

    var body: some View {
        switch content.kind {
        case .grid: Image(systemName: "grid")
        case .crosshair: Image(systemName: "scope")
        case .bars: Image(systemName: "rectangle.split.3x1.fill")
        case .color: Image(systemName: "square.fill").foregroundStyle(Color(nsColor: NSColor(hex: content.color) ?? .white))
        case .video: Image(systemName: "film")
        }
    }
}

/// The middle of the window: the output in small, with its corners to
/// drag, and a line saying where the output is.
struct PreviewArea: View {
    @ObservedObject var stage: Stage
    @ObservedObject var output: OutputController

    var body: some View {
        VStack(spacing: 12) {
            GeometryReader { geo in
                let fit = fitted(in: geo.size)
                ZStack {
                    MapPicture(stage: stage, role: .preview)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.separator))
                    EditMarks(stage: stage, role: .preview)
                    if stage.setup.surfaces.isEmpty { emptyHint }
                }
                .frame(width: fit.width, height: fit.height)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
            statusLine
        }
        .padding(20)
    }

    /// The biggest box with the output's shape that fits.
    private func fitted(in space: CGSize) -> CGSize {
        let px = stage.outputPixels
        let aspect = px.height > 0 ? px.width / px.height : 16.0 / 10.0
        let width = min(space.width, space.height * aspect)
        return CGSize(width: max(1, width), height: max(1, width / aspect))
    }

    private var emptyHint: some View {
        VStack(spacing: 10) {
            Text("Light on the wall in three steps").font(.title3.weight(.semibold))
            Text("Add a surface, drag its corners onto a shape on the wall, then pick what it shows.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Add Surface") { stage.addSurface() }
                .actionButton(prominent: true)
                .padding(.top, 4)
        }
        .foregroundStyle(.white)
        .padding(24)
        .frame(maxWidth: 420)
    }

    private var statusLine: some View {
        HStack(spacing: 6) {
            Image(systemName: "videoprojector")
            Text(outputWords).lineLimit(1).truncationMode(.middle).layoutPriority(1)
            Spacer()
            if let problem = stage.saveProblem {
                Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).lineLimit(1)
            } else if stage.editing {
                Text("Edit is on").foregroundStyle(Color.accentColor)
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }

    private var outputWords: String {
        let size = "\(Int(stage.outputPixels.width)) × \(Int(stage.outputPixels.height))"
        if let screen = output.fullScreenOn { return "Output: full screen on \(screen), \(size)" }
        if !output.isOpen { return "Output: closed. Open it from the Window menu." }
        if let picked = stage.setup.outputScreen, !output.screens.contains(where: { $0.name == picked }) {
            return "Output: a window until \(picked) is connected, \(size)"
        }
        return output.screens.count > 1
            ? "Output: a window on this screen, \(size). Pick a screen in the Inspector."
            : "Output: a window on this screen, \(size). Plug in a projector to fill it."
    }
}
