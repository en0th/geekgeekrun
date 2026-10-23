import Foundation
import Security
import Capacitor

private func transportConfiguration() -> URLSessionConfiguration {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 120
    config.timeoutIntervalForResource = 3600
    return config
}

private final class NativeHTTPTask: NSObject, URLSessionDataDelegate {
    let id: String
    let streaming: Bool
    let call: CAPPluginCall
    let emit: ([String: Any]) -> Void
    let complete: () -> Void
    var session: URLSession?
    var task: URLSessionDataTask?
    var bytes = Data()
    var response: HTTPURLResponse?
    var exceeded = false
    init(id: String, streaming: Bool, call: CAPPluginCall, emit: @escaping ([String: Any]) -> Void, complete: @escaping () -> Void) {
        self.id = id; self.streaming = streaming; self.call = call; self.emit = emit; self.complete = complete
    }
    private func headers() -> [String: String] {
        var values: [String: String] = [:]
        response?.allHeaderFields.forEach { key, value in values[String(describing: key).lowercased()] = String(describing: value) }
        return values
    }
    func start(_ request: URLRequest) {
        session = URLSession(configuration: transportConfiguration(), delegate: self, delegateQueue: nil)
        task = session?.dataTask(with: request)
        task?.resume()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        self.response = http
        if streaming { emit(["id": id, "kind": "headers", "status": http.statusCode, "headers": headers()]) }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if streaming { emit(["id": id, "kind": "chunk", "data": data.base64EncodedString()]) }
        else if bytes.count + data.count > 32 * 1024 * 1024 { exceeded = true; dataTask.cancel() }
        else { bytes.append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { complete(); session.finishTasksAndInvalidate(); self.task = nil; self.session = nil }
        if error != nil || exceeded || response == nil {
            if streaming { emit(["id": id, "kind": "error"]) }
            else { call.reject("Native request failed or was cancelled", "NETWORK_ERROR") }
            return
        }
        if streaming { emit(["id": id, "kind": "end"]) }
        else { call.resolve(["status": response!.statusCode, "headers": headers(), "data": bytes.base64EncodedString()]) }
    }
}

@objc(MobileBridgePlugin)
public class MobileBridgePlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "MobileBridgePlugin"
    public let jsName = "MobileBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        "request", "stream", "cancel", "openSocket", "sendSocket", "closeSocket", "readSession", "writeSession", "clearSession"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let stateQueue = DispatchQueue(label: "io.geekgeekrun.mobile.transport")
    private var requests: [String: NativeHTTPTask] = [:]
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private lazy var socketSession = URLSession(configuration: transportConfiguration(), delegate: self, delegateQueue: nil)
    private let service = "io.geekgeekrun.mobile.session.v1"
    private func secureURL(_ call: CAPPluginCall, scheme: String) throws -> URL {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == scheme, url.host != nil, url.user == nil, url.password == nil, url.fragment == nil else { throw URLError(.badURL) }
        return url
    }
    private func makeRequest(_ call: CAPPluginCall) throws -> URLRequest {
        var request = URLRequest(url: try secureURL(call, scheme: "https"))
        request.httpMethod = call.getString("method") ?? "GET"
        let headers = call.getObject("headers") ?? [:]
        for (name, value) in headers where !["host", "content-length", "cookie"].contains(name.lowercased()) { if let string = value as? String { request.setValue(string, forHTTPHeaderField: name) } }
        if let parts = call.getArray("parts") as? [[String: Any]] {
            let boundary = "ggr-" + UUID().uuidString
            var data = Data()
            func append(_ text: String) { data.append(Data(text.utf8)) }
            func quote(_ text: String) -> String { text.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\"", with: "_") }
            for part in parts {
                guard let name = part["name"] as? String else { throw URLError(.cannotEncodeContentData) }
                append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quote(name))\"")
                if let encoded = part["data"] as? String, let file = Data(base64Encoded: encoded) {
                    let filename = quote(part["filename"] as? String ?? "upload")
                    let mime = quote(part["mimeType"] as? String ?? "application/octet-stream")
                    append("; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n"); data.append(file); append("\r\n")
                } else { append("\r\n\r\n\(part["value"] as? String ?? "")\r\n") }
                if data.count > 32 * 1024 * 1024 { throw URLError(.dataLengthExceedsMaximum) }
            }
            append("--\(boundary)--\r\n")
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type"); request.httpBody = data
        } else if let body = call.getString("body") { request.httpBody = Data(body.utf8) }
        return request
    }
    private func start(_ call: CAPPluginCall, streaming: Bool) {
        stateQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                guard let id = call.getString("id"), self.requests[id] == nil else { throw URLError(.badURL) }
                let request = try self.makeRequest(call)
                let job = NativeHTTPTask(id: id, streaming: streaming, call: call, emit: { [weak self] value in self?.notifyListeners("network", data: value) }, complete: { [weak self] in self?.stateQueue.async { self?.requests.removeValue(forKey: id) } })
                self.requests[id] = job; job.start(request)
                if streaming { call.resolve() }
            } catch { call.reject("Invalid native request", "INVALID_REQUEST") }
        }
    }
    @objc func request(_ call: CAPPluginCall) { start(call, streaming: false) }
    @objc func stream(_ call: CAPPluginCall) { start(call, streaming: true) }
    @objc func cancel(_ call: CAPPluginCall) { stateQueue.async { [weak self] in self?.requests.removeValue(forKey: call.getString("id") ?? "")?.task?.cancel(); call.resolve() } }
    private func socketEvent(_ id: String, _ kind: String, data: String? = nil) {
        var value: [String: Any] = ["id": id, "kind": kind]; if let data = data { value["data"] = data }; notifyListeners("socket", data: value)
    }
    @objc func openSocket(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                guard let id = call.getString("id"), self.sockets[id] == nil, call.getArray("protocols") as? [String] == ["mqtt"], let headers = call.getObject("headers") else { throw URLError(.badURL) }
                var request = URLRequest(url: try self.secureURL(call, scheme: "wss"))
                for name in ["wt", "wt2", "zp_product_id"] { guard let value = headers[name] as? String else { throw URLError(.badURL) }; request.setValue(value, forHTTPHeaderField: name) }
                request.setValue("mqtt", forHTTPHeaderField: "Sec-WebSocket-Protocol")
                let task = self.socketSession.webSocketTask(with: request)
                task.taskDescription = id; self.sockets[id] = task; task.resume(); self.receive(task, id: id); call.resolve()
            } catch { call.reject("Invalid secure socket request", "SOCKET_ERROR") }
        }
    }
    private func receive(_ task: URLSessionWebSocketTask, id: String) {
        task.receive { [weak self] result in
            self?.stateQueue.async { [weak self] in
                guard let self = self, self.sockets[id] === task else { return }
                switch result {
                case .success(.data(let data)): self.socketEvent(id, "message", data: data.base64EncodedString()); self.receive(task, id: id)
                case .success(.string(_)): self.failSocket(task, id: id)
                case .failure: self.failSocket(task, id: id)
                @unknown default: self.failSocket(task, id: id)
                }
            }
        }
    }
    private func failSocket(_ task: URLSessionWebSocketTask, id: String) { sockets.removeValue(forKey: id); task.cancel(with: .goingAway, reason: nil); socketEvent(id, "error"); socketEvent(id, "close") }
    @objc func sendSocket(_ call: CAPPluginCall) {
        stateQueue.async { [weak self] in
            guard let id = call.getString("id"), let task = self?.sockets[id], let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else { call.reject("Socket unavailable", "SOCKET_ERROR"); return }
            task.send(.data(data)) { error in if error == nil { call.resolve() } else { call.reject("Socket write was not accepted", "SOCKET_ERROR") } }
        }
    }
    @objc func closeSocket(_ call: CAPPluginCall) { stateQueue.async { [weak self] in self?.sockets.removeValue(forKey: call.getString("id") ?? "")?.cancel(with: .goingAway, reason: nil); call.resolve() } }
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        stateQueue.async { [weak self] in guard let self = self, let id = webSocketTask.taskDescription, self.sockets[id] === webSocketTask else { return }; if `protocol` == "mqtt" { self.socketEvent(id, "open") } else { self.failSocket(webSocketTask, id: id) } }
    }
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        stateQueue.async { [weak self] in guard let self = self, let id = webSocketTask.taskDescription, self.sockets.removeValue(forKey: id) != nil else { return }; self.socketEvent(id, "close") }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private var keyQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session", kSecAttrSynchronizable as String: false] }
    @objc func readSession(_ call: CAPPluginCall) {
        var query = keyQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var output: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &output)
        if status == errSecItemNotFound { call.resolve(); return }
        guard status == errSecSuccess, let data = output as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("Secure session could not be read", "VAULT_ERROR"); return }
        call.resolve(["value": value])
    }
    @objc func writeSession(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), value.utf8.count <= 65536 else { call.reject("Invalid session", "VAULT_ERROR"); return }
        let attrs: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(keyQuery as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(keyQuery.merging(attrs, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) }
        if status == errSecSuccess { call.resolve() } else { call.reject("Secure session could not be saved", "VAULT_ERROR") }
    }
    @objc func clearSession(_ call: CAPPluginCall) { let status = SecItemDelete(keyQuery as CFDictionary); if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("Secure session could not be cleared", "VAULT_ERROR") } }
    deinit { requests.values.forEach { $0.task?.cancel() }; sockets.values.forEach { $0.cancel(with: .goingAway, reason: nil) } }
}

class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(MobileBridgePlugin()) }
}
