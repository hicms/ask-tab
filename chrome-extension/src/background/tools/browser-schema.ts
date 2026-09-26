import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const browserSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('tabs'),
      Type.Literal('open'),
      Type.Literal('close'),
      Type.Literal('focus'),
      Type.Literal('navigate'),
      Type.Literal('content'),
      Type.Literal('snapshot'),
      Type.Literal('screenshot'),
      Type.Literal('click'),
      Type.Literal('type'),
      Type.Literal('select'),
      Type.Literal('scroll'),
      Type.Literal('wait'),
      Type.Literal('console'),
      Type.Literal('network'),
      Type.Literal('group_tabs'),
      Type.Literal('ungroup_tabs'),
      Type.Literal('list_tab_groups'),
      Type.Literal('update_tab_group'),
    ],
    {
      description:
        'Use snapshot to inspect page content, then click/type/select by ref or scroll. Use wait for page updates.',
    },
  ),
  tabId: Type.Optional(
    Type.Number({
      description: 'Target tab ID (required for page actions; not required for tabs/open/wait)',
    }),
  ),
  url: Type.Optional(Type.String({ description: 'URL for "open" or "navigate" actions' })),
  active: Type.Optional(
    Type.Boolean({
      description: 'Whether to activate the tab for "open" or "navigate" (default: false)',
    }),
  ),
  ref: Type.Optional(
    Type.Number({
      description:
        'Snapshot element ref for click/type/select; optional for scroll (nearest scrollable ancestor)',
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: 'Text for type (empty clears it), or exact visible option label for select',
    }),
  ),
  selector: Type.Optional(
    Type.String({ description: 'CSS selector to scope "content" extraction' }),
  ),
  value: Type.Optional(
    Type.String({ description: 'Exact option value for select; takes precedence over text' }),
  ),
  direction: Type.Optional(
    Type.Union(
      [Type.Literal('up'), Type.Literal('down'), Type.Literal('left'), Type.Literal('right')],
      { description: 'Scroll direction (default down)' },
    ),
  ),
  pixels: Type.Optional(
    Type.Number({
      minimum: 0,
      description: 'Scroll distance in pixels; takes precedence over pages',
    }),
  ),
  pages: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 10,
      description: 'Scroll distance in viewport/container sizes (default 1)',
    }),
  ),
  seconds: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 10,
      description: 'Wait duration in seconds (default 1), cancelled when the task stops',
    }),
  ),
  fullPage: Type.Optional(
    Type.Boolean({ description: 'Capture full page for "screenshot" (default: viewport only)' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max entries for "console" or "network" (default: 50)' }),
  ),
  tabIds: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        'Tab IDs to group or ungroup (for "group_tabs" / "ungroup_tabs"). If omitted, falls back to [tabId].',
    }),
  ),
  groupId: Type.Optional(
    Type.Number({
      description:
        'Existing tab group ID. For "open", adds the new tab to this group. For "group_tabs", adds tabs to this group. Required for "update_tab_group".',
    }),
  ),
  title: Type.Optional(
    Type.String({ description: 'Title for the tab group (for "group_tabs" / "update_tab_group")' }),
  ),
  color: Type.Optional(
    Type.Union(
      [
        Type.Literal('grey'),
        Type.Literal('blue'),
        Type.Literal('red'),
        Type.Literal('yellow'),
        Type.Literal('green'),
        Type.Literal('pink'),
        Type.Literal('purple'),
        Type.Literal('cyan'),
        Type.Literal('orange'),
      ],
      {
        description: 'Color for the tab group (for "group_tabs" / "update_tab_group")',
      },
    ),
  ),
  collapsed: Type.Optional(
    Type.Boolean({ description: 'Whether the tab group is collapsed (for "update_tab_group")' }),
  ),
});

type BrowserArgs = Static<typeof browserSchema>;

export { browserSchema };
export type { BrowserArgs };
