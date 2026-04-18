import UIKit
import Capacitor

/// Handles custom URL schemes and universal links using the UIScene lifecycle (iOS 13+).
/// This replaces the deprecated `application(_:open:options:)` / `OpenURLOptionsKey` path on AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Cold launch: URL / universal link may arrive only in connectionOptions here.
        if !connectionOptions.urlContexts.isEmpty {
            forwardOpenURLContexts(connectionOptions.urlContexts)
        }
        if let activity = connectionOptions.userActivities.first {
            forwardContinueUserActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        forwardOpenURLContexts(URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forwardContinueUserActivity(userActivity)
    }

    private func forwardOpenURLContexts(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts {
            // Capacitor’s bridge still takes the legacy options dictionary. Passing `[:]` avoids using
            // deprecated `OpenURLOptionsKey` in our code; URL handling does not require source/annotation
            // for typical deep links. Metadata remains on `context.options` (UISceneOpenURLOptions) if needed later.
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    private func forwardContinueUserActivity(_ userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
