export interface OfflineShellRegistrationAccess<Registration> {
  getRegistration(scope: string): Promise<Registration | undefined>;
  register(script: string, options: { scope: string; updateViaCache: "none" }): Promise<Registration>;
}

/**
 * A registration can immediately download the entire built shell. Routine checks
 * only inspect an existing registration; preparation requires an explicit action.
 */
export function offlineShellRegistration<Registration>(
  serviceWorker: OfflineShellRegistrationAccess<Registration>,
  intent: "inspect" | "prepare",
): Promise<Registration | undefined> {
  return intent === "prepare"
    ? serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    : serviceWorker.getRegistration("/");
}
