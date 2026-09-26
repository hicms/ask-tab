// ──────────────────────────────────────────────
// Text Generation Worker — Local LLM via Transformers.js
// ──────────────────────────────────────────────
// Uses @huggingface/transformers for on-device text generation.
// Follows the same pattern as stt-worker.ts / tts-worker.ts.

import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
import type { Tensor } from '@huggingface/transformers';

// Configure ONNX runtime BEFORE any model loading.
// Same CSP-safe approach as stt-worker.ts.
try {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('offscreen-channels/assets/');
} catch (err) {
  diagnostics.error('[text-gen] Failed to configure ONNX runtime:', err);
}

// Relay logger — sends structured log entries to the background SW's logger-buffer
const log = (level: string, message: string, data?: unknown) => {
  const consoleFn = level === 'error' ? diagnostics.error : diagnostics.debug;
  consoleFn('[text-gen]', message, data ?? '');
  chrome.runtime
    .sendMessage({
      type: 'LOG_RELAY',
      level,
      message: `[text-gen] ${message}`,
      ...(data !== undefined ? { data } : {}),
    })
    .catch(() => {});
};
const trace = (msg: string, data?: unknown) => log('trace', msg, data);
const debug = (msg: string, data?: unknown) => log('debug', msg, data);

// ── Progress Reporting ──────────────────────────

const sendProgress = (
  requestId: string,
  status: 'downloading' | 'loading' | 'generating' | 'ready',
  percent?: number,
): void => {
  chrome.runtime
    .sendMessage({ type: 'LOCAL_LLM_PROGRESS', requestId, status, percent })
    .catch(() => {});
};

const sendDownloadProgress = (
  downloadId: string,
  status: 'downloading' | 'complete' | 'error',
  percent: number,
  error?: string,
): void => {
  chrome.runtime
    .sendMessage({ type: 'LOCAL_LLM_DOWNLOAD_PROGRESS', downloadId, status, percent, error })
    .catch(() => {});
};

// ── Model Cache ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedTokenizer: any = null;
let cachedModelId: string | null = null;

// Model load mutex — prevents concurrent loads (follows tts-worker.ts pattern)
let modelLoadPromise: Promise<void> | null = null;

// Abort support — InterruptableStoppingCriteria stops ONNX at next token boundary
const activeRequests = new Map<string, InterruptableStoppingCriteria>();

// ── Device Detection ────────────────────────────

/** Cache the WebGPU probe result so we only check once. */
let webgpuAvailable: boolean | null = null;

/** Actually probe for a working WebGPU adapter instead of just checking the property. */
const probeWebGPU = async (): Promise<boolean> => {
  if (webgpuAvailable !== null) return webgpuAvailable;
  try {
    const gpu = (
      navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }
    ).gpu;
    if (!gpu) {
      webgpuAvailable = false;
      return false;
    }
    const adapter = await gpu.requestAdapter();
    webgpuAvailable = adapter !== null;
  } catch {
    webgpuAvailable = false;
  }
  debug('WebGPU probe', { available: webgpuAvailable });
  return webgpuAvailable;
};

const detectDevice = async (explicit?: string): Promise<'webgpu' | 'wasm'> => {
  if (explicit === 'webgpu' || explicit === 'wasm') return explicit;
  return (await probeWebGPU()) ? 'webgpu' : 'wasm';
};

// ── Model Loading (with mutex) ──────────────────

const loadModel = async (modelId: string, device?: string): Promise<void> => {
  let effectiveDevice = await detectDevice(device);
  // Start with q4f16 (INT4 weights + FP16 compute) — smallest and fastest.
  // On WebGPU, q4f16 may produce garbage on large-vocab models (Qwen3: 151K tokens)
  // because FP16 precision is too low for the quantized LM head. When detected, we
  // upgrade to fp16 (full-precision FP16 weights, no quantization noise) on WebGPU.
  // WASM fallback is a last resort for WebGPU loading failures (not quality failures,
  // which stay on WebGPU to avoid corrupting the ONNX WASM runtime).
  let dtype: 'q4f16' | 'fp16' = 'q4f16';

  trace('Loading model', { modelId, device: effectiveDevice, dtype });
  const t0 = performance.now();

  let model;
  let tokenizer;
  try {
    [model, tokenizer] = await Promise.all([
      AutoModelForCausalLM.from_pretrained(modelId, { dtype, device: effectiveDevice }),
      AutoTokenizer.from_pretrained(modelId),
    ]);

    // WebGPU: shader warmup + output quality check
    if (effectiveDevice === 'webgpu') {
      const warmupInputs = tokenizer('Hi');
      const warmupOutput = await model.generate({ ...warmupInputs, max_new_tokens: 4 });
      // Decode only generated tokens (skip input) to check for garbage
      const inputLen = warmupInputs.input_ids.dims[1];
      const allIds = Array.from((warmupOutput as Tensor).slice(0).data).map(Number);
      const genText = tokenizer
        .decode(allIds.slice(inputLen), { skip_special_tokens: true })
        .trim();
      if (genText.length >= 2 && !/[a-zA-Z]/.test(genText)) {
        // q4f16 output is garbage — quantization noise + FP16 precision too low for large vocab.
        // Upgrade to fp16 on WebGPU (full-precision weights, no quant noise). Stay on WebGPU
        // to avoid corrupting the ONNX WASM runtime with a device switch.
        debug('q4f16 quality check failed, upgrading to fp16', {
          generated: genText.slice(0, 40),
        });
        dtype = 'fp16';
        model = await AutoModelForCausalLM.from_pretrained(modelId, {
          dtype,
          device: effectiveDevice,
        });
        // Shader warmup for fp16 (non-fatal)
        try {
          const inputs = tokenizer('a');
          await model.generate({ ...inputs, max_new_tokens: 1 });
          debug('Shader warmup complete (fp16)');
        } catch (warmupErr) {
          debug('Shader warmup failed (non-fatal)', { error: String(warmupErr) });
        }
      } else {
        debug('Shader warmup + quality check passed');
      }
    }
  } catch (err) {
    // WebGPU loading failed entirely (not a quality issue). Fall back to WASM.
    if (effectiveDevice === 'webgpu') {
      debug('WebGPU loading failed, falling back to WASM', { error: String(err) });
      effectiveDevice = 'wasm';
      [model, tokenizer] = await Promise.all([
        AutoModelForCausalLM.from_pretrained(modelId, { dtype, device: effectiveDevice }),
        AutoTokenizer.from_pretrained(modelId),
      ]);
    } else {
      throw err;
    }
  }

  // Atomic assignment — only after both succeed
  cachedModel = model;
  cachedTokenizer = tokenizer;
  cachedModelId = modelId;

  debug('Model loaded', {
    device: effectiveDevice,
    dtype,
    elapsed: Math.round(performance.now() - t0) + 'ms',
  });
};

/** Ensure model is loaded, with mutex to prevent concurrent loads. */
const ensureModel = async (modelId: string, device?: string): Promise<void> => {
  if (cachedModelId === modelId && cachedModel && cachedTokenizer) return;

  // If another load is in progress, wait for it then check again
  if (modelLoadPromise) {
    await modelLoadPromise;
    if (cachedModelId === modelId && cachedModel && cachedTokenizer) return;
  }

  // Clear stale cache
  cachedModel = null;
  cachedTokenizer = null;
  cachedModelId = null;

  modelLoadPromise = loadModel(modelId, device);
  try {
    await modelLoadPromise;
  } finally {
    modelLoadPromise = null;
  }
};

// ── Generation ──────────────────────────────────

const handleGenerateRequest = async (
  requestId: string,
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  maxTokens?: number,
  temperature?: number,
  device?: string,
  tools?: unknown[],
  supportsReasoning?: boolean,
): Promise<void> => {
  const stoppingCriteria = new InterruptableStoppingCriteria();
  activeRequests.set(requestId, stoppingCriteria);

  try {
    // 1. Load or reuse cached model + tokenizer (mutex-guarded)
    sendProgress(requestId, 'downloading');
    await ensureModel(modelId, device);

    if (stoppingCriteria.interrupted) {
      chrome.runtime
        .sendMessage({ type: 'LOCAL_LLM_ERROR', requestId, error: 'Generation aborted' })
        .catch(() => {});
      return;
    }

    // 2. Truncate inputs BEFORE applying chat template to preserve template structure.
    // Small models can't handle large contexts. Qwen3 vocab is 151K — even moderate
    // input produces huge logits tensors. Keep total context small.
    // Increase budgets when tools are provided (tool schemas consume tokens).
    const effectiveMaxTokens = maxTokens ?? 256;
    const hasTools = tools && tools.length > 0;
    const MAX_INPUT_TOKENS = hasTools ? 1024 : 512;

    // Budget: reserve tokens for system, rest for conversation
    const systemTokens = cachedTokenizer.encode(systemPrompt);
    const maxSystemTokens = Math.min(systemTokens.length, hasTools ? 512 : 128);
    let truncatedSystem = systemPrompt;
    if (systemTokens.length > maxSystemTokens) {
      truncatedSystem = cachedTokenizer.decode(systemTokens.slice(0, maxSystemTokens), {
        skip_special_tokens: true,
      });
      debug('System prompt truncated', {
        original: systemTokens.length,
        truncated: maxSystemTokens,
      });
    }

    // Keep only the most recent messages that fit the remaining budget
    const remainingBudget = MAX_INPUT_TOKENS - maxSystemTokens - 50; // 50 tokens for template overhead
    const truncatedMessages: Array<{ role: string; content: string }> = [];
    let usedTokens = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = cachedTokenizer.encode(messages[i].content).length + 10; // +10 for role/template
      if (usedTokens + msgTokens > remainingBudget) break;
      truncatedMessages.unshift(messages[i]);
      usedTokens += msgTokens;
    }

    // Ensure at least the last message is included
    if (truncatedMessages.length === 0 && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const lastMsgTokens = cachedTokenizer.encode(lastMsg.content);
      const maxMsgTokens = Math.min(lastMsgTokens.length, remainingBudget);
      truncatedMessages.push({
        role: lastMsg.role,
        content: cachedTokenizer.decode(lastMsgTokens.slice(0, maxMsgTokens), {
          skip_special_tokens: true,
        }),
      });
    }

    debug('Input budget', {
      systemTokens: maxSystemTokens,
      messages: truncatedMessages.length,
      messageTokens: usedTokens,
      maxInput: MAX_INPUT_TOKENS,
    });

    // 3. Format messages and tokenize into tensor dict for model.generate()
    // apply_chat_template with tools injects tool schemas into the prompt,
    // which can add thousands of tokens. We must measure the ACTUAL input size
    // from the template output and truncate if it exceeds a safe context limit.
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: truncatedSystem },
      ...truncatedMessages,
    ];
    const isQwen = modelId.toLowerCase().includes('qwen');

    const templateOpts: Record<string, unknown> = {
      add_generation_prompt: true,
      return_dict: true,
    };
    // Qwen3: conditionally enable thinking mode based on model config
    if (isQwen) {
      templateOpts.enable_thinking = supportsReasoning ?? false;
    }
    // Pass tool definitions to the chat template (Qwen3 natively formats them)
    if (hasTools) {
      templateOpts.tools = tools;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inputs: any;
    try {
      inputs = cachedTokenizer.apply_chat_template(chatMessages, templateOpts);
    } catch (templateErr) {
      // Fallback: build ChatML manually then tokenize to tensor dict
      debug('Chat template failed, using ChatML fallback', { error: String(templateErr) });
      const prompt =
        chatMessages.map(m => `<|im_start|>${m.role}\n${m.content}<|im_end|>`).join('\n') +
        '\n<|im_start|>assistant\n';
      inputs = cachedTokenizer(prompt);
    }

    // Measure actual input tokens from the template output (includes tool schemas).
    // The pre-truncation budget only counted message/system tokens — tool definitions
    // injected by the template can add thousands of tokens for 10+ tools.
    const MAX_CONTEXT_TOKENS = 2048;
    let inputTokens: number = inputs.input_ids.dims?.[1] ?? 0;

    // If input exceeds safe context, iteratively remove oldest messages
    while (inputTokens > MAX_CONTEXT_TOKENS && chatMessages.length > 2) {
      chatMessages.splice(1, 1); // Remove oldest non-system message
      try {
        inputs = cachedTokenizer.apply_chat_template(chatMessages, templateOpts);
        inputTokens = inputs.input_ids.dims?.[1] ?? 0;
      } catch {
        break;
      }
      debug('Truncating messages to fit context', {
        remaining: chatMessages.length - 1,
        inputTokens,
      });
    }

    debug('Final prompt tokens', { tokens: inputTokens, messages: chatMessages.length - 1 });

    // 4. Stream generation token-by-token
    sendProgress(requestId, 'generating');

    let fullText = '';

    const streamer = new TextStreamer(cachedTokenizer, {
      skip_prompt: true,
      skip_special_tokens: false, // Keep <think>, <tool_call> tags — parsed by bridge
      callback_function: (token: string) => {
        if (stoppingCriteria.interrupted || !token) return;
        fullText += token;
        chrome.runtime.sendMessage({ type: 'LOCAL_LLM_TOKEN', requestId, token }).catch(() => {});
      },
    });

    await cachedModel.generate({
      ...inputs,
      max_new_tokens: effectiveMaxTokens,
      temperature: temperature ?? 0.6,
      do_sample: true,
      streamer,
      stopping_criteria: [stoppingCriteria],
    });

    if (stoppingCriteria.interrupted) {
      chrome.runtime
        .sendMessage({ type: 'LOCAL_LLM_ERROR', requestId, error: 'Generation aborted' })
        .catch(() => {});
      return;
    }

    // 5. Compute output token count and send completion
    const outputTokens = cachedTokenizer.encode(fullText).length;

    chrome.runtime
      .sendMessage({
        type: 'LOCAL_LLM_END',
        requestId,
        fullText,
        usage: { inputTokens, outputTokens },
      })
      .catch(() => {});
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'Generation error', { requestId, error });
    chrome.runtime.sendMessage({ type: 'LOCAL_LLM_ERROR', requestId, error }).catch(() => {});
  } finally {
    activeRequests.delete(requestId);
  }
};

// ── Model Download ──────────────────────────────

const handleModelDownload = async (
  modelId: string,
  downloadId: string,
  device?: string,
): Promise<void> => {
  try {
    trace('handleModelDownload: start', { modelId, downloadId, device });
    sendDownloadProgress(downloadId, 'downloading', 0);

    await ensureModel(modelId, device);

    trace('handleModelDownload: complete');
    sendDownloadProgress(downloadId, 'complete', 100);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'Model download error', error);
    sendDownloadProgress(downloadId, 'error', 0, error);
  }
};

// ── Abort ───────────────────────────────────────

const handleAbort = (requestId: string): void => {
  const stoppingCriteria = activeRequests.get(requestId);
  if (stoppingCriteria) {
    stoppingCriteria.interrupt();
    debug('Generation abort requested (stopping_criteria interrupted)', { requestId });
  }
};

export { handleGenerateRequest, handleModelDownload, handleAbort };
