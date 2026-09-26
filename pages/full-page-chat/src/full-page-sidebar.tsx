import { CONFIG_TAB_GROUPS } from '@extension/config-panels';
import { useT } from '@extension/i18n';
import { clampSidebarWidth, cn } from '@extension/ui';
import { MessageSquare } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type { ConfigTabId } from '@extension/config-panels';

type SidebarTab = ConfigTabId | 'chat';

type FullPageSidebarProps = {
  isOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
};

const FullPageSidebar = ({
  isOpen,
  width,
  onWidthChange,
  activeTab,
  onTabChange,
}: FullPageSidebarProps) => {
  const t = useT();
  const isDragging = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const newWidth = clampSidebarWidth(moveEvent.clientX);
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onWidthChange],
  );

  if (!isOpen) return null;

  return (
    <div
      className="bg-background relative flex flex-shrink-0 flex-col border-r"
      data-testid="sidebar-push"
      style={{ width }}>
      {/* Tab navigation */}
      <nav className="flex flex-col gap-0 overflow-y-auto px-2 py-2">
        {/* Chat tab */}
        <div className="mb-3">
          <button
            onClick={() => onTabChange('chat')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'chat'
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'text-muted-foreground hover:bg-muted',
            )}
            type="button">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>{t('tab_chat')}</span>
          </button>
        </div>

        {CONFIG_TAB_GROUPS.map(group => (
          <div key={group.label} className="mb-3">
            <div className="text-muted-foreground mb-1 px-3 text-[11px] font-medium uppercase tracking-wider">
              {group.label}
            </div>
            {group.tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  type="button">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Resize handle */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="hover:bg-primary/20 active:bg-primary/30 absolute inset-y-0 right-0 w-1 cursor-col-resize"
        data-testid="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
};

export { FullPageSidebar };
export type { FullPageSidebarProps, SidebarTab };
