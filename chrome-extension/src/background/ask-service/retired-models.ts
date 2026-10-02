import { getChannelConfigs, updateChannelConfig } from '../channels/config';
import { chatDb, selectedModelStorage } from '@extension/storage';
import type { PublicModel } from '@extension/storage';

/** Public model IDs the service replaced with a successor. The old IDs no longer resolve. */
const retiredModelIds: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'claude-sonnet-5-5',
};

const storedId = (publicId: string): string => `ask:${publicId}`;

/**
 * Point saved model choices at the successor so they survive the rename instead
 * of silently falling back to the default model. Runs only when the catalog has
 * the successor and no longer has the retired ID.
 */
const migrateRetiredModelReferences = async (published: readonly PublicModel[]): Promise<void> => {
  const ids = new Set(published.filter(model => model.kind === 'chat').map(model => model.id));
  const renames = new Map(
    Object.entries(retiredModelIds)
      .filter(([retired, successor]) => !ids.has(retired) && ids.has(successor))
      .flatMap(([retired, successor]) => [
        [storedId(retired), storedId(successor)],
        // Scheduled tasks name the public ID rather than the stored one.
        [retired, successor],
      ]),
  );
  if (renames.size === 0) return;
  const rename = (id: string | undefined) => (id === undefined ? id : (renames.get(id) ?? id));

  const selected = await selectedModelStorage.get();
  if (renames.has(selected)) await selectedModelStorage.set(rename(selected) ?? '');

  for (const config of await getChannelConfigs()) {
    if (config.modelId && renames.has(config.modelId)) {
      await updateChannelConfig(config.channelId, { modelId: rename(config.modelId) });
    }
  }

  await chatDb.transaction('rw', chatDb.agents, chatDb.scheduledTasks, async () => {
    await chatDb.agents.toCollection().modify(agent => {
      if (!agent.model) return;
      const { primary, fallbacks } = agent.model;
      if (primary && renames.has(primary)) agent.model.primary = rename(primary);
      if (fallbacks?.some(id => renames.has(id))) {
        agent.model.fallbacks = fallbacks.map(id => rename(id) ?? id);
      }
    });
    await chatDb.scheduledTasks.toCollection().modify(task => {
      const { model } = task.payload;
      if (typeof model === 'string' && renames.has(model)) task.payload.model = rename(model);
    });
  });
};

export { migrateRetiredModelReferences, retiredModelIds };
