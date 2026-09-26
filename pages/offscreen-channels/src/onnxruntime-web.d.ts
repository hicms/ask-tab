// onnxruntime-web's package.json "exports" doesn't expose types for bundler
// module resolution. Declare the minimal surface we use (env.wasm config).
declare module 'onnxruntime-web' {
  interface WasmConfig {
    numThreads: number;
    wasmPaths: string;
  }
  interface OrtEnv {
    wasm: WasmConfig;
  }
  export const env: OrtEnv;
}
