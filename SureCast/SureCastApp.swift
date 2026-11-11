import SwiftUI
import WebKit
import CoreLocation
import UserNotifications

// SureCast: a native shell around the bundled web dashboard (web/index.html).
// The page fetches its own data (Open-Meteo, NOAA); Swift supplies the phone's
// location (WKWebView geolocation is unreliable for local files) and schedules
// the nightly 8 PM "tomorrow's best times" alerts the page computes.

private let seaColor = UIColor(red: 0.043, green: 0.090, blue: 0.141, alpha: 1)

@main
struct SureCastApp: App {
    var body: some Scene {
        WindowGroup {
            DashboardView()
                .ignoresSafeArea()
                .background(Color(seaColor))
                .preferredColorScheme(.dark)
        }
    }
}

struct DashboardView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "locate")
        config.userContentController.add(context.coordinator, name: "schedule")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = seaColor
        web.scrollView.backgroundColor = seaColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = context.coordinator
        context.coordinator.webView = web
        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, CLLocationManagerDelegate, UNUserNotificationCenterDelegate {
        weak var webView: WKWebView?
        private let manager = CLLocationManager()
        private var wantsFix = false

        override init() {
            super.init()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            UNUserNotificationCenter.current().delegate = self
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "locate": locate()
            case "schedule": if let items = message.body as? [[String: Any]] { scheduleAlerts(items) }
            default: break
            }
        }

        // iOS can kill the page's process under memory pressure, which leaves a blank screen; load it again.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // Each item: {day: "YYYY-MM-DD", title, body}. Fires at 8 PM phone time on that day.
        // Replaces every alert scheduled earlier, so the newest forecast always wins.
        private func scheduleAlerts(_ items: [[String: Any]]) {
            let center = UNUserNotificationCenter.current()
            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else { return }
                center.getPendingNotificationRequests { pending in
                    center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("best-") })
                    for item in items {
                        guard let day = item["day"] as? String, let title = item["title"] as? String,
                              let body = item["body"] as? String else { continue }
                        let ymd = day.split(separator: "-").compactMap { Int($0) }
                        guard ymd.count == 3 else { continue }
                        var when = DateComponents()
                        when.year = ymd[0]; when.month = ymd[1]; when.day = ymd[2]; when.hour = 20; when.minute = 0
                        guard let fire = Calendar.current.date(from: when), fire > Date() else { continue }
                        let content = UNMutableNotificationContent()
                        content.title = title
                        content.body = body
                        content.sound = .default
                        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
                        center.add(UNNotificationRequest(identifier: "best-" + day, content: content, trigger: trigger))
                    }
                }
            }
        }

        // Show the alert even if the app happens to be open at 8 PM.
        func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
            completionHandler([.banner, .sound])
        }

        private func locate() {
            wantsFix = true
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            default: send("window.nativeLocationError()")
            }
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            guard wantsFix else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: wantsFix = false; send("window.nativeLocationError()")
            default: break
            }
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard wantsFix, let fix = locations.last else { return }
            wantsFix = false
            send("window.nativeLocation(\(fix.coordinate.latitude), \(fix.coordinate.longitude))")
        }

        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
            wantsFix = false
            send("window.nativeLocationError()")
        }

        private func send(_ script: String) {
            DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(script) }
        }
    }
}
