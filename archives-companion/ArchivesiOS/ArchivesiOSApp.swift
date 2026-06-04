import SwiftUI
import UIKit

@main
struct ArchivesiOSApp: App {
    init() {
        // Dark, on-brand tab bar + nav bar chrome.
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(Theme.bg1)
        tab.shadowColor = UIColor.white.withAlphaComponent(0.06)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.bg0)
        nav.shadowColor = UIColor.white.withAlphaComponent(0.06)
        let titleAttrs: [NSAttributedString.Key: Any] = [.foregroundColor: UIColor(Theme.tPrimary)]
        nav.titleTextAttributes = titleAttrs
        nav.largeTitleTextAttributes = titleAttrs
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
    }

    var body: some Scene {
        WindowGroup { RootView() }
    }
}
