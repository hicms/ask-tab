// ──────────────────────────────────────────────
// Timer Shim — Node.js timer compat for browser
// ──────────────────────────────────────────────
// In Node.js, setInterval/setTimeout return Timeout objects with .unref()/.ref().
// In browsers, they return plain numbers. Baileys transitive deps
// (@cacheable/memory, @cacheable/node-cache) call .unref() on timer return
// values without guarding, which crashes in the offscreen document.
//
// Adding no-op .unref()/.ref() to Number.prototype is safe in this isolated
// offscreen context and prevents the crash.

const proto = Number.prototype as unknown as Record<string, unknown>;
if (typeof proto.unref !== 'function') {
  proto.unref = function () {
    return this;
  };
  proto.ref = function () {
    return this;
  };
}

export {};
