import { TracePlugin } from './plugin-instance.js';
import type { TracerConfig as _TracerConfig } from './plugin-instance.js';

/** Re-export the configuration type for third-party use. */
export type { _TracerConfig as TracerConfig };

/** Minimal library API surface.
 *  Only recording-related methods are exposed — no storage switching,
 *  state management, or internal operations. */
export interface Tracer {
  /** Wrap a fetch function with trace recording.
   *  Each call to wrap() produces an independent wrapper.
   *  The caller is responsible for using or patching the result. */
  wrap(fetch: typeof globalThis.fetch): typeof fetch;

  /** Convenience: wraps the current globalThis.fetch. */
  getInterceptor(): typeof fetch;

  /** Install the interceptor on globalThis.fetch automatically. */
  installInterceptor(): void;
}

/** Create a Tracer instance.
 *  This is the entry point for third-party OpenCode plugins. */
export function createTracer(config: _TracerConfig): Tracer {
  const plugin = new TracePlugin(config);
  return {
    wrap: (fetch) => plugin.wrap(fetch),
    getInterceptor: () => plugin.getInterceptor(),
    installInterceptor: () => plugin.installInterceptor(),
  };
}
