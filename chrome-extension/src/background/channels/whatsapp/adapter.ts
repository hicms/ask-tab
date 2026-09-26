import { formatWhatsAppText } from './format';
import { createLogger } from '../../logging/logger-buffer';
import { splitMessage } from '../utils';
import type {
  ChannelAdapter,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
} from '../types';

const waLog = createLogger('wa-adapter');

const MAX_WA_MESSAGE_LENGTH = 4096;

/** Send a single text message via the offscreen WhatsApp worker */
const sendViaOffscreen = async (
  jid: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
  waLog.debug('sendViaOffscreen START', { jid, textLen: text.length });
  const t0 = Date.now();

  const result = (await chrome.runtime.sendMessage({
    type: 'WA_SEND_MESSAGE',
    jid,
    text,
  })) as { ok: boolean; messageId?: string; error?: string } | undefined;

  const elapsed = Date.now() - t0;

  // Guard: offscreen may not be running, response can be undefined
  if (!result) {
    waLog.warn('sendViaOffscreen got undefined response (offscreen not running?)', {
      jid,
      elapsedMs: elapsed,
    });
    return { ok: false, error: 'WhatsApp worker not running' };
  }

  waLog.debug('sendViaOffscreen result', {
    jid,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    elapsedMs: elapsed,
  });
  return result;
};

const createWhatsAppAdapter = (): ChannelAdapter => ({
  id: 'whatsapp',
  label: 'WhatsApp',
  maxMessageLength: MAX_WA_MESSAGE_LENGTH,

  validateAuth: async () => {
    const data = await chrome.storage.local.get('wa-auth-creds');
    if (data['wa-auth-creds']) {
      return { valid: true, identity: 'WhatsApp linked' };
    }
    return { valid: false, error: 'Not linked — scan QR code to connect' };
  },

  sendMessage: async (msg: ChannelOutboundMessage): Promise<ChannelSendResult> => {
    waLog.info('sendMessage START', {
      to: msg.to,
      textLen: msg.text.length,
      textPreview: msg.text.slice(0, 100),
    });

    try {
      // Convert LLM markdown to WhatsApp markup
      const formatted = formatWhatsAppText(msg.text);
      waLog.debug('sendMessage formatted', {
        formattedLen: formatted.length,
        formattedPreview: formatted.slice(0, 100),
      });

      // Split long messages at natural boundaries
      const chunks = splitMessage(formatted, MAX_WA_MESSAGE_LENGTH);
      waLog.debug('sendMessage chunked', {
        chunkCount: chunks.length,
        chunkLengths: chunks.map(c => c.length),
      });
      if (chunks.length === 0) return { ok: true };

      let lastMessageId: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        waLog.info('sendMessage chunk', { to: msg.to, chunkIndex: i, chunkLen: chunks[i].length });
        const result = await sendViaOffscreen(msg.to, chunks[i]);
        if (!result.ok) {
          waLog.error('sendMessage chunk FAILED', {
            to: msg.to,
            chunkIndex: i,
            error: result.error,
          });
          return { ok: false, error: result.error };
        }
        lastMessageId = result.messageId;
        waLog.info('sendMessage chunk OK', {
          to: msg.to,
          chunkIndex: i,
          messageId: result.messageId,
        });
      }

      waLog.info('sendMessage COMPLETE', { to: msg.to, totalChunks: chunks.length, lastMessageId });
      return { ok: true, messageId: lastMessageId };
    } catch (err) {
      waLog.error('sendMessage EXCEPTION', {
        to: msg.to,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },

  formatSenderDisplay: (msg: ChannelInboundMessage): string =>
    msg.senderName ?? msg.senderUsername ?? `+${msg.senderId.split('@')[0]}`,
});

/** Send audio directly via the offscreen WhatsApp worker (used by TTS) */
const sendAudioViaOffscreen = async (
  jid: string,
  audio: ArrayBuffer,
  ptt: boolean,
): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
  // Convert ArrayBuffer to base64 for JSON serialization over chrome.runtime.sendMessage
  const bytes = new Uint8Array(audio);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const audioBase64 = btoa(binary);

  waLog.debug('sendAudioViaOffscreen START', { jid, audioBytes: audio.byteLength, ptt });

  const result = (await chrome.runtime.sendMessage({
    type: 'WA_SEND_AUDIO',
    jid,
    audioBase64,
    ptt,
  })) as { ok: boolean; messageId?: string; error?: string } | undefined;

  if (!result) {
    waLog.warn('sendAudioViaOffscreen got undefined response (offscreen not running?)', { jid });
    return { ok: false, error: 'WhatsApp worker not running' };
  }

  waLog.debug('sendAudioViaOffscreen result', {
    jid,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
  });
  return result;
};

export { createWhatsAppAdapter, sendAudioViaOffscreen, MAX_WA_MESSAGE_LENGTH };
