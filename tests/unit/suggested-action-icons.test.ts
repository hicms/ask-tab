import 'fake-indexeddb/auto';
import { validateFullBackup } from '../../packages/storage/lib/impl/full-backup';
import {
  getDefaultSuggestedActions,
  isDefaultActions,
  isSuggestedActionIconId,
  MAX_SUGGESTED_ACTIONS,
  SUGGESTED_ACTION_ICON_IDS,
} from '../../packages/storage/lib/impl/suggested-actions-storage';
import { describe, expect, it } from 'vitest';

const backupWithActions = (actions: unknown) => ({
  format: 'asktab-full-backup',
  version: 2,
  createdAt: 1,
  local: { 'suggested-actions': actions },
  tables: {
    agents: [{ id: 'main' }],
    chats: [],
    messages: [],
    modelTranscripts: [],
    artifacts: [],
    workspaceFiles: [],
    scheduledTasks: [],
    taskRunLogs: [],
    heartbeatState: [],
  },
});

describe('suggested action icon presets', () => {
  it('provides twelve distinct preset SVG identities and four default choices', () => {
    expect(new Set(SUGGESTED_ACTION_ICON_IDS).size).toBe(12);
    expect(SUGGESTED_ACTION_ICON_IDS.every(isSuggestedActionIconId)).toBe(true);
    expect(getDefaultSuggestedActions('zh_CN').map(action => action.icon)).toEqual([
      'page',
      'sparkles',
      'sun',
      'palm',
    ]);
  });

  it('keeps legacy defaults locale-aware but treats a selected icon as customization', () => {
    const defaults = getDefaultSuggestedActions('en');
    expect(isDefaultActions(defaults.map(({ icon: _icon, ...action }) => action))).toBe(true);
    expect(
      isDefaultActions(
        defaults.map((action, index) =>
          index === 0 ? { ...action, icon: 'book' as const } : action,
        ),
      ),
    ).toBe(false);
  });

  it('accepts old and new action records in cloud backups and rejects invalid icons', () => {
    const actions = [
      { id: 'a', label: 'Old', prompt: 'Old prompt' },
      { id: 'b', label: 'New', prompt: 'New prompt', icon: 'compass' },
    ];
    expect(validateFullBackup(backupWithActions(actions)).local['suggested-actions']).toEqual(
      actions,
    );
    expect(() =>
      validateFullBackup(backupWithActions([{ ...actions[1], icon: '<svg />' }])),
    ).toThrow('Invalid backup configuration: suggested-actions');
    expect(() =>
      validateFullBackup(
        backupWithActions(
          Array.from({ length: MAX_SUGGESTED_ACTIONS + 1 }, (_, index) => ({
            id: String(index),
            label: 'A',
            prompt: 'B',
          })),
        ),
      ),
    ).toThrow('Invalid backup configuration: suggested-actions');
  });
});
