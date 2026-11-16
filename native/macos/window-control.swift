import AppKit
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

// One process owns retained AX references; nothing is resolved by element label alone.
struct Failure: Error {
    let code: String
    let message: String
    var uncertain = false
    init(_ code: String, _ message: String, uncertain: Bool = false) {
        self.code = code; self.message = message; self.uncertain = uncertain
    }
}
typealias Object = [String: Any]
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func string(_ element: AXUIElement, _ name: String) -> String {
    attribute(element, name) as? String ?? ""
}
func bool(_ element: AXUIElement, _ name: String) -> Bool {
    attribute(element, name) as? Bool ?? false
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute), let s = attribute(element, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func equalRect(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX-b.minX) < 1 && abs(a.minY-b.minY) < 1 && abs(a.width-b.width) < 1 && abs(a.height-b.height) < 1
}
func children(_ e: AXUIElement, limit: Int) -> ([AXUIElement], Bool) {
    var count = 0
    guard AXUIElementGetAttributeValueCount(e, kAXChildrenAttribute as CFString, &count) == .success, count > 0 else { return ([], false) }
    guard limit > 0 else { return ([], true) }
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(e, kAXChildrenAttribute as CFString, 0, min(count, limit), &values) == .success else { return ([], true) }
    return (values as? [AXUIElement] ?? [], count > limit)
}
struct Window {
    let descriptor: Object
    let number: CGWindowID
    let rect: CGRect
    var identity: String { ["hwnd", "pid", "processCreated", "executable"].map { String(describing: descriptor[$0]!) }.joined(separator: "|") }
}
struct Reference { let element: AXUIElement; let root: AXUIElement; let descriptor: Object }
struct Observation { let id: String; let identity: String; let rect: CGRect; let refs: [String: Reference] }

final class Backend {
    var observation: Observation?
    // Previously seen IDs must continue mapping to the same live AX window.
    var roots: [String: AXUIElement] = [:]
    func guiSession() -> Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? Object,
              let uid = session["kCGSessionUserIDKey"] as? UInt32 else { return false }
        return uid == getuid() && session["kCGSessionOnConsoleKey"] as? Bool == true
            && session["kCGSessionLoginDoneKey"] as? Bool == true
    }
    func requireGUI() throws {
        guard guiSession() else { throw Failure("permission_denied", "A same-user logged-in console session is required") }
    }
    func requireAX() throws {
        try requireGUI()
        guard AXIsProcessTrusted() else { throw Failure("permission_denied", "Enable Accessibility for the Window Use helper in System Settings") }
    }
    func windows() -> [Window] {
        guard let rows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [Object] else { return [] }
        return rows.compactMap { row in
            guard (row[kCGWindowLayer as String] as? Int) == 0,
                  let number = row[kCGWindowNumber as String] as? UInt32,
                  let pid = row[kCGWindowOwnerPID as String] as? Int32, pid != getpid(),
                  let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
                  let launched = app.launchDate, let executable = app.executableURL?.path,
                  let bounds = row[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 0, rect.height > 0 else { return nil }
            let started = UInt64(max(1, launched.timeIntervalSince1970 * 1_000_000))
            let d: Object = ["hwnd": String(number, radix: 16), "pid": Int(pid), "processCreated": String(started, radix: 16),
                             "executable": executable, "title": row[kCGWindowName as String] as? String ?? "",
                             "widthPx": Int(rect.width.rounded()), "heightPx": Int(rect.height.rounded()), "dpi": 96,
                             "minimized": !(row[kCGWindowIsOnscreen as String] as? Bool ?? false)]
            return Window(descriptor: d, number: number, rect: rect)
        }
    }
    func verify(_ p: Object) throws -> Window {
        guard let d = p["window"] as? Object, let hwnd = d["hwnd"] as? String else { throw Failure("invalid-params", "Window descriptor required") }
        try requireGUI()
        guard let w = windows().first(where: { $0.descriptor["hwnd"] as? String == hwnd }) else { throw Failure("window-closed", "Selected window no longer exists") }
        for key in ["hwnd", "pid", "processCreated", "executable"] {
            guard let a = d[key], let b = w.descriptor[key], String(describing: a) == String(describing: b) else { throw Failure("stale-target", "Window process identity changed") }
        }
        return w
    }
    func root(_ w: Window) throws -> AXUIElement {
        try requireAX()
        let app = AXUIElementCreateApplication(pid_t(w.descriptor["pid"] as! Int))
        AXUIElementSetMessagingTimeout(app, 1.5)
        let candidates = (attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { e in
            guard let rect = axRect(e) else { return false }
            return equalRect(rect, w.rect) && string(e, kAXTitleAttribute) == w.descriptor["title"] as? String
        }
        guard candidates.count == 1 else { throw Failure("accessibility-unavailable", "Cannot uniquely map selected window to an AX window") }
        let found = candidates[0]
        if let previous = roots[w.identity], !CFEqual(previous, found) { throw Failure("stale-target", "Window identifier was reused; reselect the target") }
        roots[w.identity] = found
        return found
    }
    func password(_ e: AXUIElement) -> Bool {
        string(e, kAXSubroleAttribute) == "AXSecureTextField" || bool(e, "AXProtectedContent")
    }
    func patterns(_ e: AXUIElement) -> [String] {
        var names: CFArray?
        AXUIElementCopyActionNames(e, &names)
        let actions = names as? [String] ?? []
        var result: [String] = []
        if actions.contains(kAXPressAction) { result.append("invoke") }
        if actions.contains(kAXPressAction) && ["AXCheckBox", "AXSwitch"].contains(string(e, kAXRoleAttribute)) { result.append("toggle") }
        var settable = DarwinBoolean(false)
        if !password(e), AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue { result.append("setValue") }
        for (name, action) in [("expand", "AXExpand"), ("collapse", "AXCollapse")] where actions.contains(action) { result.append(name) }
        if AXUIElementIsAttributeSettable(e, kAXSelectedAttribute as CFString, &settable) == .success, settable.boolValue { result.append("select") }
        return result
    }
    func describe(_ e: AXUIElement, id: String, fields: [String]) throws -> Object {
        let secret = password(e)
        var d: Object = ["id": id, "isPassword": secret]
        for field in fields {
            switch field {
            case "name": d[field] = secret ? "" : String(string(e, kAXTitleAttribute).prefix(512))
            case "controlType": d[field] = string(e, kAXRoleAttribute)
            case "automationId": d[field] = secret ? "" : string(e, kAXIdentifierAttribute)
            case "enabled": d[field] = bool(e, kAXEnabledAttribute)
            case "isPassword": break
            case "patterns": d[field] = secret ? [] : patterns(e)
            case "selected": d[field] = bool(e, kAXSelectedAttribute)
            case "toggleState": d[field] = (attribute(e, kAXValueAttribute) as? Int ?? 0) == 0 ? "off" : "on"
            case "expandState": d[field] = bool(e, kAXExpandedAttribute) ? "expanded" : "collapsed"
            case "value", "text":
                if secret { d[field] = NSNull(); d["redacted"] = true }
                else { d[field] = String(string(e, kAXValueAttribute).prefix(4096)) }
            default: throw Failure("invalid-params", "Unsupported inspection field")
            }
        }
        return d
    }
    func retained(_ p: Object, _ w: Window) throws -> (Observation, Reference) {
        guard let o = observation, o.id == p["observationId"] as? String, o.identity == w.identity, equalRect(o.rect, w.rect) else { throw Failure("stale-observation", "A fresh inspection of this window is required") }
        guard let id = p["elementId"] as? String, let ref = o.refs[id] else { throw Failure("unknown-element", "Element not retained") }
        let currentRoot = try root(w)
        guard CFEqual(currentRoot, ref.root) else { throw Failure("stale-element", "Accessible window changed") }
        var current = ref.element
        for _ in 0..<128 {
            if password(current) { throw Failure("protected-element", "Element belongs to protected text content") }
            if CFEqual(current, currentRoot) { return (o, ref) }
            guard let parent = attribute(current, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
            current = parent as! AXUIElement
        }
        throw Failure("stale-element", "Element no longer belongs to selected window")
    }
    func inspect(_ p: Object, _ w: Window) throws -> Object {
        let mode = p["mode"] as? String ?? "summary", limit = p["limit"] as? Int ?? 20
        guard ["summary", "find", "task", "read", "changes"].contains(mode), (1...100).contains(limit) else { throw Failure("invalid-params", "Invalid inspection mode or limit") }
        for key in ["query", "scope"] where p[key] != nil && !(p[key] is Object) { throw Failure("invalid-params", "Invalid inspection query or scope") }
        let queryObject = p["query"] as? Object ?? [:], scopeObject = p["scope"] as? Object ?? [:]
        guard Set(queryObject.keys).isSubset(of: ["name", "automationId", "controlType"]), Set(scopeObject.keys).isSubset(of: ["containerId"]) else { throw Failure("invalid-params", "Unsupported query or scope") }
        if let name = queryObject["name"] { guard let q = name as? Object, Set(q.keys).isSubset(of: ["equals", "contains"]) else { throw Failure("invalid-params", "Invalid name query") } }
        let nameValues = (queryObject["name"] as? Object ?? [:]).values
        let values = Array(nameValues) + queryObject.filter { $0.key != "name" }.map { $0.value } + Array(scopeObject.values)
        for value in values { guard let s = value as? String, s.count <= 512, !s.contains("\0") else { throw Failure("invalid-params", "Query exceeds supported bounds") } }
        let oid = "observation-" + UUID().uuidString
        let rootElement = try root(w)
        var refs: [String: Reference] = [:], descriptors: [Object] = []
        var reason: String?
        var metadata: Object = ["mode": mode]
        if mode == "read" {
            let (_, ref) = try retained(p, w)
            let fields = p["fields"] as? [String] ?? ["name", "controlType", "enabled"]
            guard fields.count <= 12 else { throw Failure("invalid-params", "Too many fields") }
            var d = try describe(ref.element, id: p["elementId"] as! String, fields: fields)
            if fields.contains("text") {
                guard let range = p["textRange"] as? Object, let start = range["start"] as? Int, let length = range["length"] as? Int,
                      start >= 0, (1...4096).contains(length), start <= Int(Int32.max) - length else { throw Failure("invalid-params", "Bounded textRange required") }
                if !password(ref.element) {
                    let text = string(ref.element, kAXValueAttribute) as NSString
                    let offset = min(start, text.length), count = min(length, text.length-offset)
                    d["text"] = text.substring(with: NSRange(location: offset, length: count))
                    d["textRange"] = ["start": start, "length": count, "revision": oid] as Object
                }
            }
            descriptors = [d]; refs[d["id"] as! String] = Reference(element: ref.element, root: rootElement, descriptor: d)
            metadata["coverage"] = "requested-fields"
        } else {
            var scanRoot = rootElement
            if let container = (p["scope"] as? Object)?["containerId"] as? String {
                var scoped = p; scoped["elementId"] = container
                scanRoot = try retained(scoped, w).1.element
            }
            let query = p["query"] as? Object ?? [:], nameQuery = query["name"] as? Object ?? [:]
            var queue: [(AXUIElement, Int)] = [(scanRoot, 0)], scanned = 0
            let deadline = Date().addingTimeInterval(1.5)
            while !queue.isEmpty {
                if scanned >= 2048 { reason = "scan-limit"; break }
                if Date() > deadline { reason = "time-limit"; break }
                let (element, depth) = queue.removeFirst(); scanned += 1
                let id = "element-\(scanned)"
                let d = try describe(element, id: id, fields: ["name", "controlType", "automationId", "enabled", "patterns"])
                let name = d["name"] as! String
                let matches = (nameQuery["equals"] == nil || nameQuery["equals"] as? String == name)
                    && (nameQuery["contains"] == nil || name.contains(nameQuery["contains"] as? String ?? "\0"))
                    && (query["automationId"] == nil || query["automationId"] as? String == d["automationId"] as? String)
                    && (query["controlType"] == nil || query["controlType"] as? String == d["controlType"] as? String)
                if matches {
                    if descriptors.count == limit { reason = "output-limit"; break }
                    descriptors.append(d); refs[id] = Reference(element: element, root: rootElement, descriptor: d)
                }
                // Never traverse protected text descendants.
                if password(element) { continue }
                if depth >= 127 { reason = "depth-limit"; continue }
                let room = max(0, 2048-scanned-queue.count)
                let (items, truncated) = children(element, limit: room)
                queue.append(contentsOf: items.map { ($0, depth+1) })
                if truncated { reason = "scan-limit" }
            }
            metadata["coverage"] = reason == nil ? "complete" : "partial"
            if mode == "changes" { metadata["fallback"] = "summary"; metadata["fallbackReason"] = "base-unavailable-or-incompatible" }
        }
        let after = try verify(p)
        guard equalRect(w.rect, after.rect) else { observation = nil; throw Failure("stale-observation", "Window geometry changed during inspection") }
        observation = Observation(id: oid, identity: w.identity, rect: w.rect, refs: refs)
        metadata["returnedCount"] = descriptors.count
        if let reason { metadata["incompleteReason"] = reason }
        return ["window": after.descriptor, "observationId": oid, "elements": descriptors, "elementsTruncated": reason != nil, "retrieval": metadata]
    }
    func act(_ p: Object, _ w: Window) throws -> Object {
        let (_, ref) = try retained(p, w)
        observation = nil
        guard !password(ref.element) else { throw Failure("protected-element", "Protected text elements cannot be acted on") }
        guard bool(ref.element, kAXEnabledAttribute) else { throw Failure("disabled-element", "Element disabled") }
        guard let action = p["action"] as? String, patterns(ref.element).contains(action) else { throw Failure("unsupported-action", "Selected element does not expose this AX action") }
        _ = try verify(p)
        let outcome: AXError
        switch action {
        case "setValue":
            guard let value = p["value"] as? String, value.utf8.count <= 65536, !value.contains("\0") else { throw Failure("invalid-params", "setValue requires bounded text") }
            outcome = AXUIElementSetAttributeValue(ref.element, kAXValueAttribute as CFString, value as CFString)
        case "select": outcome = AXUIElementSetAttributeValue(ref.element, kAXSelectedAttribute as CFString, kCFBooleanTrue)
        case "expand": outcome = AXUIElementPerformAction(ref.element, "AXExpand" as CFString)
        case "collapse": outcome = AXUIElementPerformAction(ref.element, "AXCollapse" as CFString)
        default: outcome = AXUIElementPerformAction(ref.element, kAXPressAction as CFString)
        }
        guard outcome == .success else { throw Failure("uncertain-delivery", "AX provider did not confirm delivery", uncertain: true) }
        return ["window": try afterMutation(p), "acted": true, "requiresObservation": true, "delivery": "accessibilityAction"]
    }
    func afterMutation(_ p: Object) throws -> Object {
        do { return try verify(p).descriptor }
        catch { throw Failure("uncertain-delivery", "Target could not be revalidated after delivery", uncertain: true) }
    }
    // Coordinates are returned only for a visual Agent marker; no input is posted.
    func actionPoint(_ p: Object, _ w: Window) throws -> Object {
        guard let o = observation, o.id == p["observationId"] as? String, o.identity == w.identity, equalRect(o.rect, w.rect) else { throw Failure("stale-observation", "A fresh observation of this window is required") }
        var bounds = w.rect
        if p["elementId"] != nil {
            try requireAX()
            let (_, ref) = try retained(p, w)
            guard bool(ref.element, kAXEnabledAttribute), let elementBounds = axRect(ref.element) else { throw Failure("stale-element", "Element no longer has enabled visible bounds") }
            bounds = elementBounds.intersection(w.rect)
        }
        guard !bounds.isNull, !bounds.isEmpty, bounds.midX.isFinite, bounds.midY.isFinite else { throw Failure("stale-element", "Element bounds do not intersect the selected window") }
        let after = try verify(p)
        guard equalRect(w.rect, after.rect) else { throw Failure("stale-observation", "Window moved during visualization lookup") }
        return ["x": bounds.midX.rounded(), "y": bounds.midY.rounded()]
    }
    func capture(_ p: Object, _ w: Window) async throws -> Object {
        guard CGPreflightScreenCaptureAccess() else { throw Failure("permission_denied", "Enable Screen Recording for the Window Use helper in System Settings") }
        guard #available(macOS 14.0, *) else { throw Failure("capture-unsupported", "Selected-window capture requires macOS 14 or newer") }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        guard let target = content.windows.first(where: { $0.windowID == w.number && $0.owningApplication?.processID == w.descriptor["pid"] as? Int32 }) else { throw Failure("window-closed", "Window not available to ScreenCaptureKit") }
        let width = w.descriptor["widthPx"] as! Int, height = w.descriptor["heightPx"] as! Int
        guard width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 16_000_000 else { throw Failure("capture-size", "Selected window exceeds capture bounds") }
        let config = SCStreamConfiguration()
        config.width = width; config.height = height; config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: target), configuration: config)
        let after = try verify(p)
        guard equalRect(w.rect, after.rect), image.width == width, image.height == height else { throw Failure("capture-size-changed", "Selected window geometry changed during capture") }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { throw Failure("capture-format", "PNG encoding unavailable") }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw Failure("capture-format", "PNG encoding failed") }
        let oid = "image-" + UUID().uuidString
        observation = Observation(id: oid, identity: w.identity, rect: w.rect, refs: [:])
        return ["window": after.descriptor, "observationId": oid,
                "elements": [], "elementsTruncated": false, "retrieval": ["mode": "image", "coverage": "image-only", "returnedCount": 0],
                "widthPx": width, "heightPx": height, "dpi": 96, "frameTimestamp": String(DispatchTime.now().uptimeNanoseconds),
                "image": ["mimeType": "image/png", "data": data.base64EncodedString()]]
    }
    func call(_ method: String, _ p: Object) async throws -> Object {
        if method == "shutdown" { return ["shutdown": true] }
        if method == "listWindows" { try requireGUI(); return ["windows": windows().map { $0.descriptor }] }
        if method == "capabilities" { return ["platform": "darwin", "guiSessionAvailable": guiSession(), "accessibilityTrusted": AXIsProcessTrusted(), "screenCaptureAllowed": CGPreflightScreenCaptureAccess(), "coordinateInput": false, "actionVisualization": true, "desktopCapture": false, "selectedWindowCapture": ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 14] }
        if ["windowAtPoint", "captureDesktop"].contains(method) { throw Failure("unsupported-action", "Coordinate input and desktop capture are not implemented on macOS") }
        if ["overlayShow", "overlayHide", "approvalNotificationShow", "approvalNotificationHide"].contains(method) { throw Failure("unsupported-action", "Native overlay is not implemented on macOS") }
        guard ["status", "observe", "inspect", "act", "restore", "resize", "actionPoint"].contains(method) else { throw Failure("unknown-method", "Unknown native backend method") }
        if ["inspect", "act", "restore", "resize"].contains(method) { try requireAX() }
        if method == "observe" {
            try requireGUI()
            guard CGPreflightScreenCaptureAccess() else { throw Failure("permission_denied", "Enable Screen Recording for the Window Use helper in System Settings") }
        }
        let w = try verify(p)
        if method == "status" { return ["window": w.descriptor] }
        if method == "restore" {
            let element = try root(w); observation = nil
            guard AXUIElementSetAttributeValue(element, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { throw Failure("uncertain-delivery", "AX restore was not confirmed", uncertain: true) }
            return ["window": try afterMutation(p), "restored": true, "requiresObservation": true]
        }
        if w.descriptor["minimized"] as? Bool == true { throw Failure("window-minimized", "Window is minimized or not on the active desktop") }
        switch method {
        case "actionPoint": return try actionPoint(p, w)
        case "inspect": return try inspect(p, w)
        case "observe": return try await capture(p, w)
        case "act": return try act(p, w)
        case "resize":
            guard let width = p["widthDip"] as? Double, let height = p["heightDip"] as? Double,
                  width.isFinite, height.isFinite, (1...16384).contains(width), (1...16384).contains(height) else { throw Failure("resize-bounds", "Window dimensions outside bounds") }
            let element = try root(w); observation = nil
            var size = CGSize(width: width, height: height)
            guard let value = AXValueCreate(.cgSize, &size), AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, value) == .success else { throw Failure("uncertain-delivery", "AX resize was not confirmed", uncertain: true) }
            return ["window": try afterMutation(p), "resized": true, "requiresObservation": true]
        default: throw Failure("unknown-method", "Unknown native backend method")
        }
    }
}

@main struct Main {
    static func main() async {
        let backend = Backend()
        // Bound retained memory and drain oversized lines to recover the next request.
        var pending = Data(), oversized = false
        while true {
            let chunk = FileHandle.standardInput.availableData
            if chunk.isEmpty { break }
            for byte in chunk {
                if byte != 10 {
                    if !oversized { pending.append(byte); if pending.count > 16 * 1024 * 1024 { oversized = true; pending.removeAll(keepingCapacity: false) } }
                    continue
                }
                var id: Any = NSNull(), response: Object
                var shutdown = false
                do {
                    guard !oversized else { throw Failure("request-too-large", "JSON request exceeds 16 MiB") }
                    guard let request = try JSONSerialization.jsonObject(with: pending) as? Object,
                          Set(request.keys).isSubset(of: ["id", "method", "params"]),
                          let requestId = request["id"], requestId is String || (requestId is NSNumber && CFGetTypeID(requestId as CFTypeRef) != CFBooleanGetTypeID()),
                          String(describing: requestId).count <= 128, let method = request["method"] as? String, method.count <= 64,
                          request["params"] == nil || request["params"] is Object else { throw Failure("invalid-request", "Invalid request envelope") }
                    id = requestId
                    response = ["id": id, "result": try await backend.call(method, request["params"] as? Object ?? [:])]
                    shutdown = method == "shutdown"
                } catch let error as Failure {
                    var payload: Object = ["code": error.code, "message": error.message]
                    if error.uncertain { payload["mutationOutcome"] = "unknown" }
                    response = ["id": id, "error": payload]
                } catch { response = ["id": id, "error": ["code": "native-error", "message": "macOS provider operation failed"]] }
                if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
                    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
                }
                pending.removeAll(keepingCapacity: true); oversized = false
                if shutdown { return }
            }
        }
    }
}
