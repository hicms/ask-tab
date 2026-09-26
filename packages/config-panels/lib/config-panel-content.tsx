import { AgentsConfig } from './agents-config';
import { BackupConfig } from './backup-config';
import { CronConfig } from './cron-config';
import { LogViewer } from './log-viewer';
import { ModelConfig } from './model-config';
import { SessionManager } from './session-manager';
import { Settings } from './settings';
import { SkillConfig } from './skill-config';
import { SpeechToTextConfig } from './speech-to-text-config';
import { SuggestedActionsConfig } from './suggested-actions-config';
import { TelegramConfig } from './telegram-config';
import { TextToSpeechConfig } from './text-to-speech-config';
import { ToolConfig } from './tool-config';
import { UsageDashboard } from './usage-dashboard';
import { WhatsAppConfig } from './whatsapp-config';
import type { ConfigTabId } from './tab-groups';

const ConfigPanelContent = ({
  activeTab,
  onOpenSession,
}: {
  activeTab: ConfigTabId;
  onOpenSession?: (chatId: string) => void;
}) => (
  <>
    {activeTab === 'general' && <Settings />}
    {activeTab === 'backup' && <BackupConfig />}
    {activeTab === 'model' && <ModelConfig />}
    {activeTab === 'tool' && <ToolConfig />}
    {activeTab === 'speech' && (
      <>
        <SpeechToTextConfig />
        <TextToSpeechConfig />
      </>
    )}
    {activeTab === 'actions' && <SuggestedActionsConfig />}
    {activeTab === 'skills' && <SkillConfig />}
    {activeTab === 'agents' && <AgentsConfig />}
    {activeTab === 'channels' && (
      <>
        <TelegramConfig />
        <WhatsAppConfig />
      </>
    )}
    {activeTab === 'cron' && <CronConfig />}
    {activeTab === 'sessions' && <SessionManager onOpenSession={onOpenSession} />}
    {activeTab === 'usage' && <UsageDashboard />}
    {activeTab === 'logs' && <LogViewer />}
  </>
);

export { ConfigPanelContent };
