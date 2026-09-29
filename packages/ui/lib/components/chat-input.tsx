import { AttachmentsButton } from './attachments-button';
import { MicButton } from './mic-button';
import { ModelCapabilityIcons } from './model-capability-icons';
import { ModelPriceMultiplier } from './model-price-multiplier';
import { ModelTierLabel, tierLabels } from './model-tier-label';
import { ModelVendorIcon } from './model-vendor-icon';
import { insertPastedText } from './paste-text';
import { PreviewAttachment } from './preview-attachment';
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Textarea,
} from './ui';
import { Waveform } from './waveform';
import { useInputHistory } from '../hooks';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { groupModelsByTier, knownTier, useStorage, getSlashCommands } from '@extension/shared';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import { sttConfigStorage } from '@extension/storage';
import { SendIcon, SquareIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Attachment, ChatModel, SlashCommandDef, StreamingStatus } from '@extension/shared';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  SetStateAction,
} from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const ACCEPTED_FILE_TYPES = 'image/*,.pdf,.txt,.md,.csv';

type ChatInputProps = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onSubmit: (content: string, attachments?: Attachment[]) => void;
  status: StreamingStatus;
  stop: () => void;
  models: ChatModel[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
};

const ChatInput = ({
  input,
  setInput,
  onSubmit,
  status,
  stop,
  models,
  selectedModelId,
  onModelChange,
}: ChatInputProps) => {
  const t = useT();
  const sttConfig = useStorage(sttConfigStorage);
  const micEnabled = sttConfig.engine !== 'off';
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const history = useInputHistory();
  const { resetCursor } = history;

  const slashCommands = useMemo(() => getSlashCommands(), []);

  const filteredSlashCommands = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ') || input.includes('\n')) return [];
    const query = input.slice(1).toLowerCase();
    if (slashCommands.some(cmd => cmd.name.toLowerCase() === query)) return [];
    return slashCommands.filter(cmd => cmd.name.toLowerCase().startsWith(query));
  }, [input, slashCommands]);

  const showSlashMenu = filteredSlashCommands.length > 0;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [filteredSlashCommands.length]);

  const isStreaming = status === 'streaming' || status === 'connecting';
  const isUploading = uploadQueue.length > 0;

  const hasContent = input.trim().length > 0 || attachments.length > 0;
  // Mic is offered whenever STT is on and we're not mid-stream.
  const showMic = micEnabled && !isStreaming;
  // With the mic available and an empty draft, the mic is the sole control;
  // as soon as there's content (or no mic, or a stream is running) show Send.
  const showSend = !showMic || hasContent;

  const processFile = useCallback(
    (file: File): Promise<Attachment | null> =>
      new Promise(resolve => {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(t('chat_fileSizeError', file.name));
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            url: reader.result as string,
            contentType: file.type || 'application/octet-stream',
          });
        };
        reader.onerror = () => {
          toast.error(t('chat_fileReadError', file.name));
          resolve(null);
        };
        reader.readAsDataURL(file);
      }),
    [t],
  );

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;

      const totalCount = attachments.length + files.length;
      if (totalCount > MAX_FILES) {
        toast.error(t('chat_maxFilesError', String(MAX_FILES)));
        return;
      }

      const fileNames = files.map(f => f.name);
      setUploadQueue(prev => [...prev, ...fileNames]);

      const results = await Promise.all(files.map(f => processFile(f)));
      const valid = results.filter((r): r is Attachment => r !== null);

      setAttachments(prev => [...prev, ...valid]);
      setUploadQueue(prev => prev.filter(name => !fileNames.includes(name)));

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [attachments.length, processFile, t],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const fileItems = items.filter(item => item.kind === 'file' && item.getAsFile() !== null);

      if (fileItems.length === 0) {
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;

        // Handle text in this textarea synchronously instead of leaving the
        // side panel's paste/focus routing to the browser's default action.
        e.preventDefault();
        e.stopPropagation();
        const value = insertPastedText(e.currentTarget, text);
        resetCursor();
        setInput(value);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (attachments.length + fileItems.length > MAX_FILES) {
        toast.error(t('chat_maxFilesError', String(MAX_FILES)));
        return;
      }

      const fileNames = fileItems.map((item, i) => {
        const file = item.getAsFile();
        return file?.name || `pasted-file-${i}`;
      });
      setUploadQueue(prev => [...prev, ...fileNames]);

      const results: Attachment[] = [];
      for (const item of fileItems) {
        const file = item.getAsFile();
        if (file) {
          const result = await processFile(file);
          if (result) results.push(result);
        }
      }

      setAttachments(prev => [...prev, ...results]);
      setUploadQueue(prev => prev.filter(name => !fileNames.includes(name)));
    },
    [attachments.length, processFile, resetCursor, setInput, t],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDictation = useCallback(
    async (base64: string, mimeType: string) => {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'TRANSCRIBE_DICTATION',
          audio: base64,
          mimeType,
        })) as { transcript?: string; error?: string } | undefined;

        if (!response || response.error) {
          diagnostics.error('[dictation] transcription failed', {
            mimeType,
            error: response?.error,
            hasResponse: Boolean(response),
          });
          toast.error(response?.error || t('chat_mic_error'));
          return;
        }

        const transcript = (response.transcript ?? '').trim();
        if (!transcript) return;
        setInput(prev => (prev.trim() ? `${prev.trimEnd()} ${transcript}` : transcript));
        textareaRef.current?.focus();
      } catch (err) {
        diagnostics.error('[dictation] TRANSCRIBE_DICTATION message failed', err);
        toast.error(t('chat_mic_error'));
      }
    },
    [setInput, t],
  );

  // The side panel can't reliably prompt for mic permission, so when the mic
  // button reports it's missing, ask the background to open a dedicated
  // permission popup window. The grant persists to the extension origin, so the
  // next dictation attempt in the side panel works.
  const handleMicPermission = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_MIC_PERMISSION' }).catch(err => {
      diagnostics.error('[dictation] OPEN_MIC_PERMISSION message failed', err);
    });
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      stop();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    if (trimmed) history.record(trimmed);
    onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
    setAttachments([]);
  };

  const selectSlashCommand = useCallback(
    (cmd: SlashCommandDef) => {
      setInput(`/${cmd.name}`);
      textareaRef.current?.focus();
    },
    [setInput],
  );

  const applyHistoryValue = useCallback(
    (value: string) => {
      setInput(value);
      // Move the caret to the end after the value updates.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    },
    [setInput],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIndex(prev => (prev <= 0 ? filteredSlashCommands.length - 1 : prev - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIndex(prev => (prev >= filteredSlashCommands.length - 1 ? 0 : prev + 1));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashSelectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashSelectedIndex]);
        return;
      }
    }
    // History navigation (only when the slash menu is closed). ArrowUp recalls
    // older entries from the top line; ArrowDown recalls newer entries from the
    // bottom line, so multi-line editing is not hijacked.
    if (!showSlashMenu && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const el = e.currentTarget;
      const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const caretAtEnd =
        el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      if (e.key === 'ArrowUp' && (caretAtStart || history.isNavigating())) {
        const value = history.previous();
        if (value !== null) {
          e.preventDefault();
          applyHistoryValue(value);
          return;
        }
      }
      if (e.key === 'ArrowDown' && (caretAtEnd || history.isNavigating())) {
        const value = history.next();
        if (value !== null) {
          e.preventDefault();
          applyHistoryValue(value);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!isStreaming && (trimmed || attachments.length > 0) && !isUploading) {
        if (trimmed) history.record(trimmed);
        onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
        setAttachments([]);
      }
    }
  };

  return (
    <div className="relative w-full">
      {showSlashMenu && (
        <div className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-1 w-full rounded-md border p-1 shadow-md">
          {filteredSlashCommands.map((cmd, index) => (
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                index === slashSelectedIndex && 'bg-accent',
              )}
              key={cmd.name}
              onMouseDown={e => {
                e.preventDefault();
                selectSlashCommand(cmd);
              }}
              onMouseEnter={() => setSlashSelectedIndex(index)}
              type="button">
              <span className="font-medium">/{cmd.name}</span>
              <span className="text-muted-foreground">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="bg-background w-full overflow-hidden rounded-xl border shadow-sm"
        onSubmit={handleSubmit}>
        {/* Attachment previews */}
        {(attachments.length > 0 || isUploading) && (
          <div
            className="flex gap-2 overflow-x-auto border-b px-3 py-2"
            data-testid="attachments-preview">
            {attachments.map((attachment, index) => (
              <PreviewAttachment
                attachment={attachment}
                key={`${attachment.name}-${index}`}
                onRemove={() => removeAttachment(index)}
              />
            ))}
            {uploadQueue.map(name => (
              <PreviewAttachment
                attachment={{ name, url: '', contentType: '' }}
                isUploading
                key={`uploading-${name}`}
              />
            ))}
          </div>
        )}

        <input
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          multiple
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />

        <Textarea
          className={cn(
            'outline-hidden w-full resize-none rounded-none border-none bg-transparent p-3 shadow-none ring-0',
            'focus-visible:ring-0',
          )}
          onChange={e => {
            history.resetCursor();
            setInput(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat_placeholder')}
          ref={textareaRef}
          rows={1}
          style={{ fieldSizing: 'content', maxHeight: '164px' } as React.CSSProperties}
          value={input}
        />
        <div className="flex items-center justify-between p-1">
          <div className="flex items-center gap-1">
            <AttachmentsButton
              disabled={isStreaming}
              onClick={() => fileInputRef.current?.click()}
            />
            {models.length > 0 && (
              <Select onValueChange={onModelChange} value={selectedModelId}>
                <SelectTrigger
                  className={cn(
                    'text-muted-foreground h-auto border-none bg-transparent px-2 py-1.5 font-medium shadow-none transition-colors',
                    'hover:bg-accent hover:text-foreground',
                  )}>
                  <SelectValue placeholder={t('chat_modelSelect')} />
                </SelectTrigger>
                <SelectContent>
                  {groupModelsByTier(models).map(group => (
                    <SelectGroup key={group.tier ?? 'unrated'}>
                      {group.tier && <SelectLabel>{t(tierLabels[group.tier])}</SelectLabel>}
                      {group.models.map(model => (
                        <SelectItem
                          key={model.dbId ?? model.id}
                          trailing={
                            knownTier(model.tier) || model.priceMultiplier ? (
                              <>
                                <ModelTierLabel tier={model.tier} />
                                <ModelPriceMultiplier multiplier={model.priceMultiplier} />
                              </>
                            ) : undefined
                          }
                          value={model.dbId ?? model.id}>
                          <span className="inline-flex items-center gap-2">
                            <ModelVendorIcon vendor={model.vendor} />
                            {model.name}
                            <ModelCapabilityIcons model={model} />
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-1">
            {recordingStream && (
              <Waveform
                barCount={9}
                className="text-foreground h-5 w-16"
                stream={recordingStream}
              />
            )}
            {showMic && (
              <MicButton
                disabled={isStreaming}
                hotkey={sttConfig.hotkey}
                onAudio={handleDictation}
                onPermissionNeeded={handleMicPermission}
                onStreamChange={setRecordingStream}
              />
            )}
            {showSend && (
              <Button
                className="shrink-0 gap-1.5 rounded-lg"
                disabled={
                  isUploading || (!isStreaming && !input.trim() && attachments.length === 0)
                }
                size="icon"
                type="submit"
                variant="default">
                {isStreaming ? <SquareIcon className="size-4" /> : <SendIcon className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};

export { ChatInput };
