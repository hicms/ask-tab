// ---------------------------------------------------------------------------
// deep_research tool — delegates to spawn_subagent for non-blocking execution.
//
// Builds a prescriptive research prompt from args (topic, focusAreas, config)
// and calls executeSpawnSubagent with tools ['web_search', 'web_fetch'].
// Saving is handled deterministically via the onComplete hook.
// Returns immediately — results appear as a system message when complete.
// ---------------------------------------------------------------------------

import { executeSpawnSubagent } from './subagent';
import { executeWrite } from './workspace';
import { createLogger } from '../logging/logger-buffer';
import { toolConfigStorage } from '@extension/storage';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';
import type { DeepResearchConfig } from '@extension/storage';
import type { Static } from '@sinclair/typebox';

const log = createLogger('tool');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SOURCES = 5;
const DEFAULT_MAX_ITERATIONS = 2;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const deepResearchSchema = Type.Object({
  topic: Type.String({ description: 'The research topic or question to investigate' }),
  focusAreas: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional sub-questions to focus on (skips automatic decomposition)',
    }),
  ),
  saveToWorkspace: Type.Optional(
    Type.Boolean({ description: 'Save the final report to workspace', default: true }),
  ),
});

type DeepResearchArgs = Static<typeof deepResearchSchema>;

/** Context passed to executeDeepResearch for subagent chatId injection. */
interface ToolContext {
  chatId?: string;
}

// ---------------------------------------------------------------------------
// Workspace path helper
// ---------------------------------------------------------------------------

const generateWorkspacePath = (topic: string): string => {
  const date = new Date().toISOString().split('T')[0];
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `memory/research/${date}-${slug}.md`;
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const buildResearchPrompt = (args: DeepResearchArgs, config: DeepResearchConfig): string => {
  const focusSection =
    args.focusAreas && args.focusAreas.length > 0
      ? `Use the following sub-questions as your research focus areas (do NOT decompose further):\n${args.focusAreas.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : `Decompose the topic into up to ${config.maxDepth} specific sub-questions that together provide comprehensive coverage.`;

  return `# Deep Research Task

## Topic
${args.topic}

## Instructions

You are conducting deep, multi-step web research. Follow this process:

### Step 1: Plan Sub-Questions
${focusSection}

### Step 2: Research Each Sub-Question
For each sub-question (up to ${config.maxDepth} total):
1. Use \`web_search\` to find relevant sources (request up to ${config.maxSources} results per search).
2. Use \`web_fetch\` to read the top 3 most relevant pages from the search results.
3. Analyze the content and take notes on key findings with source URLs.
4. If the initial search is insufficient, refine your query and search again (up to ${config.maxIterations} search iterations per sub-question).

### Step 3: Synthesize Report
Combine all findings into a comprehensive, well-structured Markdown report:
- Start with a \`## Summary\` section: a concise 3–5 sentence executive summary of the key findings and conclusions.
- Use \`#\` for the main title and \`##\` for sections.
- Use inline citations like [1], [2] referencing numbered sources.
- End with a \`## Sources\` section listing all sources as: \`[N] Title — URL\`
- Output the complete report as your final response.

## Constraints
- Maximum sub-questions: ${config.maxDepth}
- Maximum sources per search: ${config.maxSources}
- Maximum search iterations per sub-question: ${config.maxIterations}
- Be thorough but efficient — avoid redundant searches.`;
};

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

const executeDeepResearch = async (
  args: DeepResearchArgs,
  context?: ToolContext,
): Promise<string> => {
  log.trace('[deepResearch] starting', { topic: args.topic });

  // Read config
  const toolConfig = await toolConfigStorage.get();
  const config: DeepResearchConfig = {
    maxSources: DEFAULT_MAX_SOURCES,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    maxDepth: DEFAULT_MAX_DEPTH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...(toolConfig.deepResearchConfig ?? {}),
  };

  const prompt = buildResearchPrompt(args, config);
  const workspacePath = args.saveToWorkspace !== false ? generateWorkspacePath(args.topic) : null;

  return executeSpawnSubagent({ task: prompt, tools: ['web_search', 'web_fetch'] }, context, {
    label: `Deep research: ${args.topic}`,
    createArtifact: true,
    onComplete: async ({ responseText, error }) => {
      // Deterministically save report to workspace
      if (workspacePath && responseText && !error) {
        await executeWrite({ path: workspacePath, content: responseText, mode: 'overwrite' });
      }
      // Prepend metadata so the LLM and UI know where the report was saved
      const header = workspacePath ? `*Report saved to workspace: \`${workspacePath}\`*\n\n` : '';
      return { findings: `${header}${responseText || error || '(no output)'}` };
    },
  });
};

// ── Tool registration ──

const deepResearchToolDef: ToolRegistration = {
  name: 'deep_research',
  label: 'Deep Research',
  description:
    'Conduct deep multi-step web research on a topic in the background. Returns immediately — results appear as a system message when complete.',
  schema: deepResearchSchema,
  excludeInHeadless: true,
  needsContext: true,
  execute: (args, context) =>
    executeDeepResearch(args as DeepResearchArgs, { chatId: context?.chatId }),
};

export {
  deepResearchSchema,
  executeDeepResearch,
  generateWorkspacePath,
  buildResearchPrompt,
  deepResearchToolDef,
};
export type { DeepResearchArgs, ToolContext };
