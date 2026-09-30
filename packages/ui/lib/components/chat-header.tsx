import { AgentSwitcher } from './agent-switcher';
import {
  ChatAccountIcon,
  ChatExpandIcon,
  ChatMenuIcon,
  ChatNewChatIcon,
} from './chat-action-icons';
import { ContextStatusBadge } from './context-status';
import { ModelPriceMultiplier } from './model-price-multiplier';
import { ModelVendorIcon } from './model-vendor-icon';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui';
import { useT } from '@extension/i18n';
import { SettingsIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import type { AgentSwitcherAgent } from './agent-switcher';
import type { ChatModel } from '@extension/shared';

type ContextStatus = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  compactionCount: number;
  contextLimit: number;
  lastCompactionMethod?: string;
  lastCompactionTokensSaved?: number;
};

type ChatHeaderProps = {
  chatTitle?: string;
  model?: ChatModel;
  onNewChat: () => void;
  onOpenSidebar?: () => void;
  isFullPage?: boolean;
  contextStatus?: ContextStatus;
  agents?: AgentSwitcherAgent[];
  activeAgentId?: string;
  onAgentChange?: (agentId: string) => void;
  onRenameTitle?: (title: string) => void;
};

const PureChatHeader = ({
  chatTitle,
  model,
  onNewChat,
  onOpenSidebar,
  isFullPage,
  contextStatus,
  agents,
  activeAgentId,
  onAgentChange,
  onRenameTitle,
}: ChatHeaderProps) => {
  const t = useT();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const startRename = () => {
    if (!onRenameTitle || !chatTitle) return;
    setRenameValue(chatTitle);
    setIsRenaming(true);
  };

  const commitRename = () => {
    setIsRenaming(false);
    const next = renameValue.trim();
    if (next && next !== chatTitle) onRenameTitle?.(next);
  };
  return (
    <header className="chat-header sticky top-0 z-10 shrink-0">
      <div className="chat-header-content flex min-w-0 items-center">
        {onOpenSidebar && (
          <Button
            aria-label="Toggle sidebar"
            className="chat-header-control"
            onClick={onOpenSidebar}
            size="sm"
            title="Toggle sidebar"
            variant="ghost">
            <ChatMenuIcon />
          </Button>
        )}

        {agents && activeAgentId && onAgentChange && agents.length > 1 && (
          <AgentSwitcher
            activeAgentId={activeAgentId}
            agents={agents}
            onAgentChange={onAgentChange}
          />
        )}

        <Button
          aria-label={t('session_newSession')}
          className="chat-header-new"
          onClick={onNewChat}
          size="sm">
          <ChatNewChatIcon />
          <span className="chat-header-new-label">{t('session_newSession')}</span>
        </Button>

        {chatTitle && (
          <div className="chat-header-title min-w-0">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="chat-header-title-input w-full min-w-0 rounded border px-1.5 py-0.5 text-sm outline-none"
                onBlur={commitRename}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameValue('');
                    setIsRenaming(false);
                  }
                }}
                type="text"
                value={renameValue}
              />
            ) : (
              <span
                className="block truncate text-sm font-medium"
                onDoubleClick={startRename}
                title={chatTitle}>
                {chatTitle}
              </span>
            )}
          </div>
        )}

        {model && (
          <Badge
            className="chat-header-model min-w-0 items-center gap-2"
            data-testid="chat-header-model"
            variant="outline">
            <ModelVendorIcon className="size-5" vendor={model.vendor} />
            <span className="min-w-0 truncate" title={model.name}>
              {model.name}
            </span>
            <ModelPriceMultiplier
              className="chat-header-price"
              multiplier={model.priceMultiplier}
            />
          </Badge>
        )}

        {contextStatus && contextStatus.totalTokens > 0 && (
          <ContextStatusBadge
            compactionCount={contextStatus.compactionCount}
            contextLimit={contextStatus.contextLimit}
            inputTokens={contextStatus.inputTokens}
            lastCompactionMethod={contextStatus.lastCompactionMethod}
            lastCompactionTokensSaved={contextStatus.lastCompactionTokensSaved}
            outputTokens={contextStatus.outputTokens}
            totalTokens={contextStatus.totalTokens}
          />
        )}

        <div className="chat-header-tools ml-auto flex shrink-0 items-center gap-2">
          {!isFullPage && (
            <Button
              aria-label="Open in full page"
              className="chat-header-control"
              onClick={() => {
                chrome.tabs.create({ url: chrome.runtime.getURL('full-page-chat/index.html') });
                window.close();
              }}
              size="sm"
              title="Open in full page"
              variant="ghost">
              <ChatExpandIcon />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Account menu"
                className="chat-header-control"
                data-testid="user-menu-button"
                size="sm"
                title="Account menu"
                variant="ghost">
                <ChatAccountIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => chrome.runtime.openOptionsPage()}>
                <SettingsIcon className="mr-2 size-4" />
                {t('settings_title')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

const ChatHeader = memo(PureChatHeader);

export { ChatHeader };
export type { ChatHeaderProps };
