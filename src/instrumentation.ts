export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDatabase } = await import("./lib/db");
  try {
    getDatabase();
    const { startReconciler, startRetention } = await import("./lib/builds");
    const { startBaseVersionCheck, startBaseVersionMonitor } = await import("./lib/base");
    startReconciler();
    startRetention();
    startBaseVersionCheck();
    startBaseVersionMonitor();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[combinewrt] startup failed:\n${message}`);
    process.exit(1);
  }
}
