import { diagnostics } from '@extension/shared/lib/diagnostics.js';
// ──────────────────────────────────────────────
// WebSocket Shim: Node.js `ws` API → Browser WebSocket
// ──────────────────────────────────────────────
// Baileys uses the Node.js `ws` package which has an EventEmitter-style API.
// This shim wraps the native browser WebSocket to match that interface.

type EventHandler = (...args: unknown[]) => void;

class BrowserWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CLOSING = 2;
  static CONNECTING = 0;

  private _ws: WebSocket;
  private _listeners: Map<string, Set<EventHandler>> = new Map();

  constructor(url: string | URL, _opts?: unknown) {
    const urlStr = typeof url === 'object' && url !== null ? url.toString() : String(url);
    diagnostics.log('[ws-shim] Creating WebSocket', { url: urlStr });
    this._ws = new globalThis.WebSocket(urlStr);
    this._ws.binaryType = 'arraybuffer';

    // Auto-forward standard events
    this._ws.addEventListener('open', (e: Event) => {
      diagnostics.log('[ws-shim] Connection opened');
      this._emit('open', e);
    });

    // close: Node.js `ws` emits (code, reason); browser gives CloseEvent
    this._ws.addEventListener('close', (e: Event) => {
      const ce = e as CloseEvent;
      const code = ce.code ?? 1006;
      const reason = ce.reason ?? '';
      diagnostics.log('[ws-shim] Connection closed', { code, reason, wasClean: ce.wasClean });
      this._emit('close', code, reason);
    });

    // error: Node.js `ws` emits an Error object; browser gives a generic Event
    this._ws.addEventListener('error', (e: Event) => {
      const msg = (e as ErrorEvent).message ?? 'unknown';
      diagnostics.error('[ws-shim] Connection error', { message: msg });
      this._emit('error', new Error(`WebSocket error: ${msg}`));
    });

    // Message event: ws delivers Buffer/ArrayBuffer; browser delivers MessageEvent
    this._ws.addEventListener('message', (e: MessageEvent) => {
      const data = e.data;
      // Convert ArrayBuffer to Buffer-like Uint8Array for Baileys compatibility
      if (data instanceof ArrayBuffer) {
        this._emit('message', new Uint8Array(data));
      } else if (typeof data === 'string') {
        this._emit('message', data);
      } else {
        this._emit('message', data);
      }
    });
  }

  get readyState(): number {
    return this._ws.readyState;
  }

  on(event: string, fn: EventHandler): this {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }

  off(event: string, fn: EventHandler): this {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  removeListener(event: string, fn: EventHandler): this {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }

  once(event: string, fn: EventHandler): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  emit(event: string, ...args: unknown[]): boolean {
    return this._emit(event, ...args);
  }

  // No-op: browser WebSocket has no listener limit concept
  setMaxListeners(): this {
    return this;
  }

  send(data: unknown, _opts?: unknown, cb?: (err?: Error) => void): void {
    // ws library sometimes passes (data, opts, cb) or (data, cb)
    if (typeof _opts === 'function' && !cb) {
      cb = _opts as (err?: Error) => void;
    }
    try {
      if (data instanceof Uint8Array) {
        // Use slice to avoid sending the entire underlying ArrayBuffer when the
        // Uint8Array is a view with a non-zero byteOffset or smaller byteLength.
        this._ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      } else {
        this._ws.send(data as string | ArrayBuffer | Blob);
      }
      cb?.();
    } catch (err) {
      cb?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  close(): void {
    this._ws.close();
  }

  terminate(): void {
    this._ws.close();
  }

  private _emit(event: string, ...args: unknown[]): boolean {
    const handlers = this._listeners.get(event);
    if (!handlers || handlers.size === 0) return false;
    for (const fn of handlers) {
      try {
        fn(...args);
      } catch (err) {
        diagnostics.error(`[ws-shim] Error in ${event} handler:`, err);
      }
    }
    return true;
  }
}

export default BrowserWebSocket;
export { BrowserWebSocket as WebSocket };
