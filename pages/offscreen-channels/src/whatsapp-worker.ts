// ──────────────────────────────────────────────
// WhatsApp Worker — Baileys in Offscreen Document
// ──────────────────────────────────────────────
// Runs Baileys WhatsApp Web client inside the Chrome extension's offscreen
// document. Connects to WhatsApp servers via WebSocket, handles QR auth,
// message send/receive, and connection lifecycle.

import { createLogger } from './pino-shim';
import { storageProxy } from './storage-proxy';
import { useChromeStorageAuthState, CREDS_KEY } from './whatsapp-auth-state';
import {
  makeWASocket,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  isLidUser,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  BufferJSON,
} from '@extension/baileys';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import type { WASocket, proto } from '@extension/baileys';

const logger = createLogger({ level: 'trace' });

/**
 * Browser-safe in-memory cache for makeCacheableSignalKeyStore.
 * Replaces @cacheable/node-cache (Node.js library) with a simple Map + TTL.
 * Implements the subset of the NodeCache API that Baileys actually uses:
 * get, set, del, flushAll.
 */
class BrowserSignalCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlSeconds = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  flushAll(): void {
    this.store.clear();
  }
}

// Module-level signal cache: survives reconnections so cached keys aren't lost
// when Baileys re-establishes the connection after a socket drop.
const signalCache = new BrowserSignalCache(300);

// Message retry counter cache: tracks how many times Baileys has retried
// sending a particular message, so it can back off appropriately.
const retryCounterCache = new BrowserSignalCache(3600);

// Device list cache: tracks which devices each JID has (phone, tablets, linked
// devices). Without this, Baileys falls back to @cacheable/node-cache which may
// not work correctly in the browser — causing messages to be encrypted for the
// wrong device set and triggering "waiting for this message" on recipients.
const userDevicesCache = new BrowserSignalCache(300);

// Track message IDs sent by the bot to distinguish bot echoes from user's
// manual messages (both have fromMe=true on a linked device).
const sentMessageIds = new Set<string>();
const MAX_SENT_IDS = 200;

// ── Sent-message store (for getMessage retries) ──
// When a recipient can't decrypt a message, WhatsApp requests a retry via the
// Signal protocol. Baileys calls getMessage() to fetch the original proto so it
// can re-encrypt and resend. Without this, the recipient sees "waiting for this
// message. this may take a while" permanently.
const WA_SENT_MESSAGES_KEY = 'wa-sent-messages';
const MAX_STORED_MESSAGES = 200;

/** In-memory cache of sent message protos, hydrated from chrome.storage.local on startup */
const sentMessageStore = new Map<string, proto.IMessage>();

/** Load previously sent messages from storage (survives offscreen GC) */
const loadSentMessageStore = async (): Promise<void> => {
  try {
    const data = await storageProxy.get(WA_SENT_MESSAGES_KEY);
    const stored = data[WA_SENT_MESSAGES_KEY];
    if (stored && typeof stored === 'string') {
      const parsed = JSON.parse(stored, BufferJSON.reviver) as Record<string, unknown>;
      for (const [id, msg] of Object.entries(parsed)) {
        sentMessageStore.set(id, msg as proto.IMessage);
      }
      diagnostics.log('[wa-worker] Loaded sent message store', {
        count: sentMessageStore.size,
        ids: [...sentMessageStore.keys()].slice(0, 10),
      });
    } else {
      diagnostics.log('[wa-worker] No sent message store in storage', {
        hasStored: !!stored,
        type: typeof stored,
      });
    }
  } catch (err) {
    diagnostics.warn('[wa-worker] Failed to load sent message store', err);
  }
};

/** Persist sent message store to storage (fire-and-forget) */
const persistSentMessageStore = (): void => {
  const obj: Record<string, unknown> = {};
  for (const [id, msg] of sentMessageStore) {
    obj[id] = msg;
  }
  const serialized = JSON.stringify(obj, BufferJSON.replacer);
  diagnostics.info('[wa-worker] persistSentMessageStore', {
    count: sentMessageStore.size,
    serializedLen: serialized.length,
    ids: [...sentMessageStore.keys()].slice(0, 10),
  });
  storageProxy
    .set({ [WA_SENT_MESSAGES_KEY]: serialized })
    .then(() => diagnostics.info('[wa-worker] persistSentMessageStore OK'))
    .catch(err => diagnostics.warn('[wa-worker] Failed to persist sent message store', err));
};

const MAX_RECONNECT_ATTEMPTS = 5;
const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1019707846];

/**
 * Fetch the latest WhatsApp Web client revision from their service worker.
 * WhatsApp rotates this frequently; using a stale version causes 405 rejection.
 */
const fetchWaVersion = async (): Promise<[number, number, number]> => {
  try {
    const res = await fetch('https://web.whatsapp.com/sw.js');
    const text = await res.text();
    const match = text.match(/\\"client_revision\\":\s*(\d+)/);
    if (match?.[1]) {
      const version: [number, number, number] = [2, 3000, +match[1]];
      diagnostics.log('[wa-worker] Fetched WA version', version);
      return version;
    }
  } catch (err) {
    diagnostics.warn('[wa-worker] Failed to fetch WA version, using fallback', err);
  }
  return FALLBACK_VERSION;
};

// ── LID → Phone JID mapping cache ──
// WhatsApp uses opaque Linked IDs (LIDs) instead of phone JIDs.
// We maintain a mapping so allowlist checks (which use phone JIDs) can match.
const LID_STORAGE_KEY = 'wa-lid-map';
const lidMap = new Map<string, string>();
const reverseLidMap = new Map<string, string>();

/** Load persisted LID mappings from storage */
const loadLidMap = async (): Promise<void> => {
  try {
    const data = await storageProxy.get(LID_STORAGE_KEY);
    const stored = data[LID_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      for (const [lid, jid] of Object.entries(stored as Record<string, string>)) {
        lidMap.set(lid, jid);
        reverseLidMap.set(jid, lid);
      }
      if (lidMap.size > 0) {
        diagnostics.log('[wa-worker] Loaded LID mappings from storage', { count: lidMap.size });
      }
    }
  } catch (err) {
    diagnostics.warn('[wa-worker] Failed to load LID map from storage', err);
  }
};

/** Persist current LID mappings to storage */
const saveLidMap = async (): Promise<void> => {
  try {
    await storageProxy.set({ [LID_STORAGE_KEY]: Object.fromEntries(lidMap) });
  } catch (err) {
    diagnostics.warn('[wa-worker] Failed to persist LID map', err);
  }
};

/** Register a LID → phone JID mapping. Returns true if new. */
const registerLidMapping = (lid: string, phoneJid: string): boolean => {
  const normalizedLid = jidNormalizedUser(lid);
  const normalizedPhone = jidNormalizedUser(phoneJid);
  if (!normalizedLid || !normalizedPhone) return false;
  if (lidMap.get(normalizedLid) === normalizedPhone) return false;

  lidMap.set(normalizedLid, normalizedPhone);
  reverseLidMap.set(normalizedPhone, normalizedLid);
  diagnostics.log('[wa-worker] LID mapping registered', {
    lid: normalizedLid,
    phone: normalizedPhone,
  });
  return true;
};

/**
 * Resolve a JID: if it's a LID and we have a mapping, return the phone JID.
 * Otherwise return the original JID (normalized).
 */
const resolveJid = (jid: string): { resolved: string; changed: boolean } => {
  const normalized = jidNormalizedUser(jid);
  if (isLidUser(jid)) {
    const phoneJid = lidMap.get(normalized);
    if (phoneJid) {
      return { resolved: phoneJid, changed: true };
    }
  }
  return { resolved: normalized || jid, changed: false };
};

/**
 * Resolve a phone JID to its LID JID for outbound messages.
 * Baileys encrypts correctly when addressing by LID (isLid=true),
 * using the LID-keyed Signal sessions that the phone expects.
 */
const resolvePhoneToLid = (jid: string): { resolved: string; changed: boolean } => {
  if (isLidUser(jid)) return { resolved: jid, changed: false };
  const normalized = jidNormalizedUser(jid);
  const lidJid = reverseLidMap.get(normalized);
  if (lidJid) return { resolved: lidJid, changed: true };
  return { resolved: jid, changed: false };
};

/** Clear Baileys auth creds so the next connect starts fresh with a new QR */
const clearAuthState = async (): Promise<void> => {
  try {
    await storageProxy.remove(CREDS_KEY);
    diagnostics.log('[wa-worker] Auth creds cleared for fresh QR pairing');
  } catch (err) {
    diagnostics.warn('[wa-worker] Failed to clear auth state', err);
  }
};

// ── Browser-native WhatsApp media download + decrypt ──
// Replaces Baileys' downloadContentFromMessage (which uses Node.js streams/crypto)
// with fetch + Web Crypto API for the offscreen document environment.

/**
 * Derive WhatsApp media encryption keys using HKDF (Web Crypto API).
 * Mirrors Baileys' getMediaKeys() from Utils/messages-media.js.
 */
const deriveMediaKeys = async (
  mediaKey: Uint8Array,
  _mediaType: 'audio' | 'ptt',
): Promise<{ iv: Uint8Array; cipherKey: Uint8Array }> => {
  // Both 'audio' and 'ptt' map to 'Audio' in MEDIA_HKDF_KEY_MAPPING
  const hkdfInfo = `WhatsApp Audio Keys`;
  const infoBytes = new TextEncoder().encode(hkdfInfo);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(mediaKey),
    { name: 'HKDF' },
    false,
    ['deriveBits'],
  );
  const expanded = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: infoBytes },
    keyMaterial,
    112 * 8, // 112 bytes → iv(16) + cipherKey(32) + macKey(32) + refKey(32)
  );
  const expandedArr = new Uint8Array(expanded);
  return {
    iv: expandedArr.slice(0, 16),
    cipherKey: expandedArr.slice(16, 48),
  };
};

/**
 * Download and decrypt a WhatsApp audio message.
 * Uses fetch for download and Web Crypto API for AES-256-CBC decryption.
 */
const downloadWhatsAppAudio = async (audioMessage: {
  mediaKey?: Uint8Array | null;
  directPath?: string | null;
  url?: string | null;
}): Promise<ArrayBuffer> => {
  const { mediaKey, directPath, url } = audioMessage;
  if (!mediaKey) throw new Error('audioMessage has no mediaKey');

  const downloadUrl = url || (directPath ? `https://mmg.whatsapp.net${directPath}` : null);
  if (!downloadUrl) throw new Error('audioMessage has no url or directPath');

  const mediaKeyBytes = mediaKey instanceof Uint8Array ? mediaKey : new Uint8Array(mediaKey);
  const { iv, cipherKey } = await deriveMediaKeys(mediaKeyBytes, 'audio');

  // Fetch encrypted audio from WhatsApp CDN
  const response = await fetch(downloadUrl, {
    headers: { Origin: 'https://web.whatsapp.com' },
  });
  if (!response.ok) throw new Error(`CDN fetch failed: ${response.status} ${response.statusText}`);
  const encrypted = new Uint8Array(await response.arrayBuffer());

  // Strip trailing 10-byte MAC before decryption
  const ciphertext = encrypted.slice(0, encrypted.length - 10);

  // AES-256-CBC decrypt via Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(cipherKey),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: new Uint8Array(iv) },
    cryptoKey,
    ciphertext,
  );

  return decrypted;
};

let sock: WASocket | null = null;
let isRunning = false;
let isStarting = false;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

/** Start the WhatsApp worker — connects to WhatsApp via Baileys */
const startWhatsAppWorker = async (): Promise<void> => {
  if (isStarting) {
    diagnostics.warn('[wa-worker] Start already in progress');
    return;
  }
  if (isRunning && sock) {
    diagnostics.warn('[wa-worker] Already running');
    return;
  }

  diagnostics.log('[wa-worker] Starting WhatsApp connection');
  isStarting = true;
  isRunning = true;

  try {
    const [{ state, saveCreds }, version] = await Promise.all([
      // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook; Baileys naming
      useChromeStorageAuthState(),
      fetchWaVersion(),
      loadLidMap(),
      loadSentMessageStore(),
    ]);

    diagnostics.info('[wa-worker] Reusing module-level BrowserSignalCache for signal keys');
    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger, signalCache),
      },
      version,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
      getMessage: async key => {
        const id = key.id ?? '';
        const msg = sentMessageStore.get(id);
        const msgType = msg ? Object.keys(msg).join(',') : 'N/A';
        diagnostics.info('[wa-worker] getMessage', {
          id,
          remoteJid: key.remoteJid,
          fromMe: key.fromMe,
          participant: key.participant,
          found: !!msg,
          msgType,
          storeSize: sentMessageStore.size,
          storeIds: [...sentMessageStore.keys()].slice(0, 20),
        });
        // Forward to service worker so getMessage calls appear in the unified log
        trySendMessage({
          type: 'WA_DEBUG',
          channelId: 'whatsapp',
          event: 'getMessage',
          id,
          remoteJid: key.remoteJid,
          fromMe: key.fromMe,
          found: !!msg,
          msgType,
          storeSize: sentMessageStore.size,
        });
        return msg;
      },
      msgRetryCounterCache: retryCounterCache,
      userDevicesCache,
    });

    // Connection events
    sock.ev.on('connection.update', update => {
      // Log EVERY update (including intermediate states like 'connecting')
      diagnostics.info('[wa-worker] connection.update', update);

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Send QR to service worker → Options page displays it
        logger.info({ qrLength: qr.length }, '[wa-worker] QR code received, forwarding to SW');
        trySendMessage({
          type: 'WA_QR_CODE',
          channelId: 'whatsapp',
          qr,
        });
      }

      if (connection === 'open') {
        diagnostics.log('[wa-worker] Connected to WhatsApp');
        reconnectAttempts = 0;

        // Announce presence so WhatsApp servers start sending message notifications.
        // Without this, the first connection after QR scan may not receive messages
        // until the device is recognized as actively monitoring.
        sock?.sendPresenceUpdate('available').catch(() => {});

        // Self mapping: map our own LID to our phone JID
        if (sock?.user?.id && sock.user.lid) {
          if (registerLidMapping(sock.user.lid, sock.user.id)) {
            saveLidMap();
          }
        }

        diagnostics.info('[wa-worker] LID state on connect', {
          myId: sock?.user?.id,
          myLid: sock?.user?.lid,
          lidMapSize: lidMap.size,
          reverseLidMapSize: reverseLidMap.size,
        });

        trySendMessage({
          type: 'WA_CONNECTION_STATUS',
          channelId: 'whatsapp',
          status: 'connected',
        });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        diagnostics.log('[wa-worker] Connection closed', {
          statusCode,
          shouldReconnect,
          reconnectAttempts,
        });

        // Clean up current socket
        sock = null;

        if (shouldReconnect && isRunning) {
          reconnectAttempts++;

          if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            diagnostics.error('[wa-worker] Max reconnect attempts exceeded');
            isRunning = false;
            trySendMessage({
              type: 'CHANNEL_ERROR',
              channelId: 'whatsapp',
              error: `Connection lost after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts (last status: ${statusCode ?? 'unknown'})`,
              retryable: false,
            });
            return;
          }

          trySendMessage({
            type: 'WA_CONNECTION_STATUS',
            channelId: 'whatsapp',
            status: 'reconnecting',
            statusCode,
          });

          // Exponential backoff: 5s → 10s → 20s → 40s → 60s
          const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
          diagnostics.log(
            `[wa-worker] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
          );

          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            if (isRunning) {
              startWhatsAppWorker().catch(err => {
                diagnostics.error('[wa-worker] Reconnection failed:', err);
              });
            }
          }, delay);
        } else {
          isRunning = false;

          // Clear stale auth state on logout so next connect starts fresh with a new QR
          if (!shouldReconnect) {
            clearAuthState().catch(() => {});
          }

          trySendMessage({
            type: 'WA_CONNECTION_STATUS',
            channelId: 'whatsapp',
            status: shouldReconnect ? 'reconnecting' : 'logged_out',
          });
        }
      }
    });

    // Credential persistence
    sock.ev.on('creds.update', saveCreds);

    // ── LID mapping event sources ──

    // Source 1: Direct phone-number share events
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (registerLidMapping(lid, jid)) {
        saveLidMap();
      }
    });

    // Source 2: History sync contacts with both id (phone) and lid
    sock.ev.on('messaging-history.set', ({ contacts }) => {
      let newMappings = 0;
      for (const contact of contacts) {
        if (contact.id && contact.lid) {
          if (registerLidMapping(contact.lid, contact.id)) {
            newMappings++;
          }
        }
      }
      if (newMappings > 0) {
        diagnostics.log('[wa-worker] LID mappings from history sync', {
          newMappings,
          totalMappings: lidMap.size,
        });
        saveLidMap();
      }
    });

    // Message status updates — log retry-related events for diagnostics.
    // Baileys fires this when message delivery status changes (sent, delivered,
    // read) and when retry receipts are processed.
    sock.ev.on('messages.update', updates => {
      for (const update of updates) {
        // Log any update that contains retry-related or status information
        if (update.update) {
          const id = update.key.id ?? '';
          const hasProtoInStore = sentMessageStore.has(id);
          diagnostics.info('[wa-worker] messages.update', {
            id,
            remoteJid: update.key.remoteJid,
            fromMe: update.key.fromMe,
            participant: update.key.participant,
            status: update.update.status,
            messageStubType: update.update.messageStubType,
            hasProtoInStore,
            updateKeys: Object.keys(update.update),
          });

          // Forward retry-related updates to service worker for unified logging
          trySendMessage({
            type: 'WA_DEBUG',
            channelId: 'whatsapp',
            event: 'messages.update',
            id,
            remoteJid: update.key.remoteJid,
            fromMe: update.key.fromMe,
            status: update.update.status,
            hasProtoInStore,
          });
        }
      }
    });

    // Inbound messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Log ALL upsert events (including non-notify) to detect if outgoing messages re-enter
      diagnostics.info('[wa-worker] messages.upsert RAW', {
        type,
        count: messages.length,
        ids: messages.map(m => m.key.id).slice(0, 5),
        fromMe: messages.map(m => m.key.fromMe),
        jids: messages.map(m => m.key.remoteJid).slice(0, 5),
      });

      // Store ALL messages with protos in the getMessage store — this ensures
      // getMessage can return the original proto for Signal retries even if the
      // sendMessage return value was somehow different from the upsert echo.
      let storedFromUpsert = 0;
      for (const msg of messages) {
        if (msg.key.id && msg.message) {
          const alreadyHad = sentMessageStore.has(msg.key.id);
          sentMessageStore.set(msg.key.id, msg.message);
          storedFromUpsert++;
          if (!alreadyHad) {
            diagnostics.info('[wa-worker] upsert: stored NEW proto', {
              id: msg.key.id,
              fromMe: msg.key.fromMe,
              protoKeys: Object.keys(msg.message),
            });
          }
        } else if (msg.key.id && !msg.message) {
          diagnostics.info('[wa-worker] upsert: message has NO proto', {
            id: msg.key.id,
            fromMe: msg.key.fromMe,
            stubType: msg.messageStubType,
          });
        }
      }
      if (storedFromUpsert > 0) {
        // Evict oldest if over cap
        while (sentMessageStore.size > MAX_STORED_MESSAGES) {
          const firstKey = sentMessageStore.keys().next().value;
          if (firstKey) sentMessageStore.delete(firstKey);
          else break;
        }
        diagnostics.info('[wa-worker] upsert: persisting store', {
          storedFromUpsert,
          totalSize: sentMessageStore.size,
        });
        persistSentMessageStore();
      }

      // Only process real-time notifications — skip 'append' (historical) to avoid flood on reconnect
      if (type !== 'notify') {
        diagnostics.log('[wa-worker] Skipping non-notify upsert', { type, count: messages.length });
        return;
      }

      const normalized = [];

      for (const msg of messages) {
        // Skip bot's own echoed responses — the bot records each sent message ID
        // in sentMessageIds. When Baileys echoes it back via messages.upsert we
        // match by ID and skip. User's manual phone messages (also fromMe=true)
        // have IDs not in the set, so they pass through.
        if (msg.key.id && sentMessageIds.has(msg.key.id)) {
          diagnostics.log('[wa-worker] Skipping bot echo', {
            id: msg.key.id,
            jid: msg.key.remoteJid,
          });
          sentMessageIds.delete(msg.key.id); // Clean up after match
          continue;
        }

        if (!msg.message) {
          diagnostics.log('[wa-worker] Skipping message without content', {
            id: msg.key.id,
            stubType: msg.messageStubType,
          });
          continue;
        }

        const jid = msg.key.remoteJid;
        if (!jid || isJidStatusBroadcast(jid)) continue;

        // Extract text content from various message types
        let text =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          msg.message.imageMessage?.caption ??
          msg.message.videoMessage?.caption ??
          '';

        // Handle audio/voice messages — download, decrypt, and transcribe
        const audioMsg = msg.message.audioMessage;
        if (!text && audioMsg) {
          const isPtt = !!audioMsg.ptt;
          const label = isPtt ? 'Voice message' : 'Audio';
          try {
            diagnostics.log(`[wa-worker] ${label}: downloading...`, {
              id: msg.key.id,
              jid,
              mimetype: audioMsg.mimetype,
              seconds: audioMsg.seconds,
              ptt: isPtt,
            });

            const audioBuffer = await downloadWhatsAppAudio(audioMsg);
            diagnostics.log(`[wa-worker] ${label}: downloaded`, {
              id: msg.key.id,
              decryptedBytes: audioBuffer.byteLength,
            });

            // Read STT config from chrome.storage.local (same key as sttConfigStorage)
            const sttData = await storageProxy.get('stt-config');
            const sttConfig = (sttData['stt-config'] ?? {}) as Record<string, unknown>;
            const model = (sttConfig.localModel as string) || 'tiny';
            const language = (sttConfig.language as string) || 'en';

            // Lazy import stt-worker and transcribe (both run in the same offscreen doc)
            const { transcribeAudio } = await import('./stt-worker');
            const requestId = `wa-audio-${msg.key.id ?? Date.now()}`;
            const transcribed = await transcribeAudio(
              audioBuffer,
              audioMsg.mimetype || 'audio/ogg',
              'transformers',
              requestId,
              model,
              language,
            );

            text = `[${label}]: ${transcribed}`;
            diagnostics.log(`[wa-worker] ${label}: transcribed`, {
              id: msg.key.id,
              textLength: transcribed.length,
              preview: transcribed.substring(0, 100),
            });
          } catch (err) {
            diagnostics.warn(`[wa-worker] ${label}: transcription failed, using placeholder`, {
              id: msg.key.id,
              error: err instanceof Error ? err.message : String(err),
            });
            text = `[${label}]`;
          }
        }

        if (!text) {
          diagnostics.log('[wa-worker] Skipping non-text message', {
            id: msg.key.id,
            jid,
            messageKeys: Object.keys(msg.message),
          });
          continue;
        }

        // Resolve LID JIDs to phone JIDs using our mapping cache
        const rawSenderId = msg.key.participant ?? jid;
        const { resolved: senderId, changed: senderChanged } = resolveJid(rawSenderId);
        const { resolved: channelChatId } = resolveJid(jid);

        const entry: Record<string, unknown> = {
          channelMessageId: msg.key.id ?? '',
          channelChatId,
          senderId,
          senderName: msg.pushName,
          body: text,
          timestamp: (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
          chatType: isJidGroup(jid) ? 'group' : ('direct' as 'direct' | 'group'),
          fromMe: msg.key.fromMe ?? false,
          ...(audioMsg ? { isAudio: true } : {}),
        };

        // Include original sender for debugging when LID resolution changed the value
        if (senderChanged) {
          entry.originalSenderId = rawSenderId;
        }

        normalized.push(entry);
      }

      diagnostics.log('[wa-worker] Normalized messages', {
        total: messages.length,
        normalized: normalized.length,
      });

      if (normalized.length > 0) {
        trySendMessage({
          type: 'CHANNEL_UPDATES',
          channelId: 'whatsapp',
          updates: normalized,
        });
      }
    });

    isStarting = false;
  } catch (err) {
    diagnostics.error('[wa-worker] Failed to start:', err);
    isRunning = false;
    isStarting = false;
    trySendMessage({
      type: 'CHANNEL_ERROR',
      channelId: 'whatsapp',
      error: err instanceof Error ? err.message : String(err),
      retryable: false,
    });
  }
};

/** Stop the WhatsApp worker */
const stopWhatsAppWorker = (): void => {
  diagnostics.log('[wa-worker] Stopping');
  isRunning = false;
  reconnectAttempts = 0;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
      sock.ev.removeAllListeners('chats.phoneNumberShare');
      sock.ev.removeAllListeners('messaging-history.set');
      sock.ev.removeAllListeners('messages.upsert');
      sock.ev.removeAllListeners('messages.update');
      sock.end(undefined);
    } catch {
      // Socket may already be closed
    }
    sock = null;
  }
};

/** Send a message to a WhatsApp JID */
const sendWhatsAppMessage = async (
  jid: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
  if (!sock || !isRunning) {
    diagnostics.warn('[wa-worker] sendMessage SKIP — not connected', { jid, textLen: text.length });
    return { ok: false, error: 'WhatsApp not connected' };
  }

  const t0 = Date.now();

  try {
    const { resolved: sendJid, changed: jidResolved } = resolvePhoneToLid(jid);
    diagnostics.info('[wa-worker] sendMessage START', {
      jid,
      textLen: text.length,
      ...(jidResolved
        ? { sendJid, lidResolved: true }
        : { lidResolved: false, reverseLidMapSize: reverseLidMap.size }),
    });
    const result = await sock.sendMessage(sendJid, { text });
    const elapsed = Date.now() - t0;

    // Track sent message ID so we can filter out the echo in messages.upsert
    if (result?.key.id) {
      sentMessageIds.add(result.key.id);
      if (sentMessageIds.size > MAX_SENT_IDS) {
        const first = sentMessageIds.values().next().value;
        if (first) sentMessageIds.delete(first);
      }

      // Store message proto for getMessage retries (Signal protocol re-encryption)
      if (result.message) {
        sentMessageStore.set(result.key.id, result.message);
        if (sentMessageStore.size > MAX_STORED_MESSAGES) {
          const firstKey = sentMessageStore.keys().next().value;
          if (firstKey) sentMessageStore.delete(firstKey);
        }
        persistSentMessageStore();
      } else {
        diagnostics.warn(
          '[wa-worker] sendMessage result has NO message proto — getMessage retries will fail',
          {
            messageId: result.key.id,
            jid,
            fullResultKeys: result ? Object.keys(result) : [],
          },
        );
      }
    } else {
      diagnostics.warn('[wa-worker] sendMessage result has NO key.id', {
        jid,
        hasResult: !!result,
        resultKeys: result ? Object.keys(result) : [],
      });
    }

    diagnostics.info('[wa-worker] sendMessage OK', {
      jid,
      messageId: result?.key.id,
      hasMessageProto: !!result?.message,
      protoKeys: result?.message ? Object.keys(result.message) : [],
      storeSize: sentMessageStore.size,
      elapsedMs: elapsed,
    });
    return { ok: true, messageId: result?.key.id ?? undefined };
  } catch (err) {
    const elapsed = Date.now() - t0;
    diagnostics.error('[wa-worker] sendMessage FAIL', {
      jid,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      elapsedMs: elapsed,
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Send an audio message to a WhatsApp JID */
const sendWhatsAppAudio = async (
  jid: string,
  audioBuffer: ArrayBuffer,
  ptt: boolean,
): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
  if (!sock || !isRunning) {
    diagnostics.warn('[wa-worker] sendAudio SKIP — not connected', {
      jid,
      audioBytes: audioBuffer.byteLength,
    });
    return { ok: false, error: 'WhatsApp not connected' };
  }

  const t0 = Date.now();

  try {
    const { resolved: sendJid, changed: jidResolved } = resolvePhoneToLid(jid);
    diagnostics.info('[wa-worker] sendAudio START', {
      jid,
      audioBytes: audioBuffer.byteLength,
      ptt,
      ...(jidResolved ? { sendJid, lidResolved: true } : { lidResolved: false }),
    });

    // Provide `seconds` to prevent Baileys from computing audio duration
    // (which requires fs.createWriteStream, unavailable in the offscreen document).
    // OGG Opus at typical bitrates ≈ 3 KB/s; rough estimate is sufficient.
    const seconds = Math.max(1, Math.ceil(audioBuffer.byteLength / 3000));
    const result = await sock.sendMessage(sendJid, {
      audio: Buffer.from(audioBuffer),
      ptt,
      mimetype: 'audio/ogg; codecs=opus',
      seconds,
    });
    const elapsed = Date.now() - t0;

    // Track sent message ID so we can filter out the echo in messages.upsert
    if (result?.key.id) {
      sentMessageIds.add(result.key.id);
      if (sentMessageIds.size > MAX_SENT_IDS) {
        const first = sentMessageIds.values().next().value;
        if (first) sentMessageIds.delete(first);
      }

      // Store message proto for getMessage retries
      if (result.message) {
        sentMessageStore.set(result.key.id, result.message);
        if (sentMessageStore.size > MAX_STORED_MESSAGES) {
          const firstKey = sentMessageStore.keys().next().value;
          if (firstKey) sentMessageStore.delete(firstKey);
        }
        persistSentMessageStore();
      }
    }

    diagnostics.info('[wa-worker] sendAudio OK', {
      jid,
      messageId: result?.key.id,
      ptt,
      elapsedMs: elapsed,
    });
    return { ok: true, messageId: result?.key.id ?? undefined };
  } catch (err) {
    const elapsed = Date.now() - t0;
    diagnostics.error('[wa-worker] sendAudio FAIL', {
      jid,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      elapsedMs: elapsed,
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Set typing indicator for a WhatsApp JID */
const setWhatsAppTyping = async (jid: string, isTyping: boolean): Promise<void> => {
  if (!sock || !isRunning) return;
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch {
    // Presence updates are best-effort
  }
};

/** Check if the worker is currently connected */
const isWhatsAppConnected = (): boolean => isRunning && sock !== null;

/** Send a message to the service worker, swallowing errors */
const trySendMessage = (message: Record<string, unknown>): void => {
  chrome.runtime.sendMessage(message).catch(err => {
    diagnostics.warn('[wa-worker] Failed to send message to SW:', err);
  });
};

export {
  startWhatsAppWorker,
  stopWhatsAppWorker,
  sendWhatsAppMessage,
  sendWhatsAppAudio,
  setWhatsAppTyping,
  isWhatsAppConnected,
  BrowserSignalCache,
};
