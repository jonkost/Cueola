// Runs a page in WebKit, the engine inside Safari, with no window on screen.
// Chrome cannot stand in for Safari: the two paint an empty time box
// differently, and that difference is the whole reason this file exists.
//
// It is driven by blank-time-safari.browser.mjs. Mac only.
//
//   webkit-runner <url> <steps.json> [width] [height]
//
// steps.json is a list. Each step does one thing:
//   { "js": "return 1 + 1" }                  run JavaScript in the page
//   { "keys": "9", "tab": 1 }                 type keys, then press Tab
//   { "shot": "a", "selector": "#pp-call" }   photograph one element, keep it as "a"
//   { "diff": ["a", "b"] }                    count the pixels that differ between two photos
//   { "png": "/tmp/page.png" }                save a picture of the whole page
// Any step may add "name" (a label for its result) and "wait" (ms to pause after).
// One line of JSON is printed per result, for the caller to read.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: webkit-runner <url> <steps.json> [width] [height]\n".data(using: .utf8)!)
  exit(2)
}
let width = args.count > 3 ? Double(args[3]) ?? 1014 : 1014
let height = args.count > 4 ? Double(args[4]) ?? 885 : 885

struct Step: Decodable {
  var name: String?
  var js: String?
  var keys: String?
  var tab: Int?
  var shot: String?
  var selector: String?
  var diff: [String]?
  var png: String?
  var wait: Int?
}

func readSteps() -> [Step] {
  guard let data = FileManager.default.contents(atPath: args[2]),
        let list = try? JSONDecoder().decode([Step].self, from: data) else {
    FileHandle.standardError.write("webkit-runner: cannot read steps file\n".data(using: .utf8)!)
    exit(2)
  }
  return list
}
let steps = readSteps()

// A page only counts a box as "the one being typed in" while its window has
// the keyboard. This window is off screen and must never take the keyboard
// away from whoever is at the Mac, so it simply says it has it.
final class KeyWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
  override var isKeyWindow: Bool { true }
  override var isMainWindow: Bool { true }
}

final class Runner: NSObject, WKNavigationDelegate {
  let webView: WKWebView
  let window: KeyWindow
  var index = 0
  var shots: [String: [UInt8]] = [:]
  var shotSizes: [String: Int] = [:]

  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent() // a clean browser every run
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
    // Far off screen: nothing flashes up on the Mac while the check runs.
    window = KeyWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.contentView = webView
    window.orderBack(nil)
    window.makeFirstResponder(webView)
    NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
    webView.navigationDelegate = self
  }

  func emit(_ fields: [String: Any]) {
    var line = fields
    line["step"] = index
    if let name = steps[index - 1].name { line["name"] = name }
    if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) { print(text) }
    fflush(stdout)
  }

  func fail(_ message: String) -> Never {
    print("{\"fatal\":\"\(message.replacingOccurrences(of: "\"", with: "'"))\"}")
    exit(1)
  }

  func start() { webView.load(URLRequest(url: URL(string: args[1])!)) }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    after(800) { self.next() }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("page failed to load: \(error.localizedDescription)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("page failed to load: \(error.localizedDescription)") }

  func after(_ ms: Int, _ work: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(ms), execute: work)
  }

  func press(_ characters: String, code: UInt16) {
    for type in [NSEvent.EventType.keyDown, .keyUp] {
      guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) else { continue }
      if type == .keyDown { webView.keyDown(with: event) } else { webView.keyUp(with: event) }
    }
  }
  static let keyCodes: [Character: UInt16] = ["0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "a": 0, "p": 35]

  // The picture as plain red-green-blue-alpha bytes, so two can be compared.
  func bytes(of image: NSImage) -> (pixels: [UInt8], width: Int)? {
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
    guard let context = CGContext(data: &pixels, width: cg.width, height: cg.height, bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
    return (pixels, cg.width)
  }

  func next() {
    guard index < steps.count else { exit(0) }
    let step = steps[index]
    index += 1
    let done = { self.after(step.wait ?? 150) { self.next() } }

    if let js = step.js {
      webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .success(let value): self.emit(["kind": "js", "value": value])
        case .failure(let error): self.emit(["kind": "js", "error": "\(error)"])
        }
        done()
      }
    } else if step.keys != nil || step.tab != nil {
      var delay = 0
      for character in step.keys ?? "" {
        self.after(delay) { self.press(String(character), code: Runner.keyCodes[character] ?? 0) }
        delay += 120
      }
      for _ in 0..<(step.tab ?? 0) {
        self.after(delay) { self.press("\t", code: 48) }
        delay += 120
      }
      self.after(delay) { self.emit(["kind": "keys"]); done() }
    } else if let label = step.shot, let selector = step.selector {
      let find = "const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height];"
      webView.callAsyncJavaScript(find, arguments: ["sel": selector], in: nil, in: .page) { result in
        guard case .success(let value) = result, let box = value as? [Double], box.count == 4, box[2] > 0, box[3] > 0 else {
          self.emit(["kind": "shot", "error": "nothing to photograph at \(selector)"])
          done()
          return
        }
        let config = WKSnapshotConfiguration()
        config.rect = CGRect(x: box[0], y: box[1], width: box[2], height: box[3])
        self.webView.takeSnapshot(with: config) { image, _ in
          if let image, let picture = self.bytes(of: image) {
            self.shots[label] = picture.pixels
            self.shotSizes[label] = picture.width
            self.emit(["kind": "shot", "shot": label, "pixels": picture.pixels.count / 4])
          } else {
            self.emit(["kind": "shot", "error": "snapshot failed for \(selector)"])
          }
          done()
        }
      }
    } else if let pair = step.diff, pair.count == 2 {
      guard let a = shots[pair[0]], let b = shots[pair[1]], a.count == b.count, shotSizes[pair[0]] == shotSizes[pair[1]] else {
        emit(["kind": "diff", "error": "photos \(pair[0]) and \(pair[1]) are missing or not the same size"])
        done()
        return
      }
      // A pixel counts as different when any channel moves by more than a hair.
      var different = 0
      var i = 0
      while i < a.count {
        if abs(Int(a[i]) - Int(b[i])) > 6 || abs(Int(a[i + 1]) - Int(b[i + 1])) > 6 || abs(Int(a[i + 2]) - Int(b[i + 2])) > 6 { different += 1 }
        i += 4
      }
      emit(["kind": "diff", "different": different, "of": a.count / 4])
      done()
    } else if let path = step.png {
      webView.takeSnapshot(with: WKSnapshotConfiguration()) { image, _ in
        if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
          try? png.write(to: URL(fileURLWithPath: path))
          self.emit(["kind": "png", "path": path])
        } else {
          self.emit(["kind": "png", "error": "snapshot failed"])
        }
        done()
      }
    } else {
      emit(["kind": "wait"])
      done()
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // no Dock icon, and never comes to the front
let runner = Runner()
runner.start()
app.run()
