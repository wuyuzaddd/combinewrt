/**
 * Tiny decoupling seam: the source-watch scheduler announces an adopted index,
 * and the build retry queue wakes up. A direct import would create a cycle
 * (retry -> source-watch -> builds) and both modules are singletons in practice.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onIndexAdopted(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyIndexAdopted(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A retry listener must never break the watch that adopted the index.
    }
  }
}
