// ---------------------------------------------------------------------------
// Snapshot algorithm
// ---------------------------------------------------------------------------

const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'switch',
  'combobox',
  'searchbox',
  'slider',
  'spinbutton',
  'textbox',
  'option',
]);

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'meta',
  'link',
  'path',
  'defs',
  'clippath',
]);

const STRUCTURAL_TAGS = new Set([
  'div',
  'span',
  'section',
  'nav',
  'main',
  'aside',
  'header',
  'footer',
  'article',
  'form',
  'fieldset',
  'legend',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'pre',
  'code',
  'label',
  'dialog',
  'img',
  'video',
  'audio',
  'canvas',
  'iframe',
]);

const MAX_TEXT_LENGTH = 80;
const MAX_DEPTH = 40;
const MAX_NODES = 5000;
const MAX_RESULT_CHARS = 30000;

interface CDPNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  children?: CDPNode[];
  attributes?: string[];
  contentDocument?: CDPNode;
  shadowRoots?: CDPNode[];
  frameId?: string;
}

interface RefEntry {
  nodeId: number;
  backendNodeId: number;
}

interface SnapshotContext {
  refCounter: number;
  nodeCount: number;
  refMap: Map<number, RefEntry>;
  lines: string[];
  unlabeledButtonRefs?: Set<number>;
}

const getAttr = (node: CDPNode, name: string): string | undefined => {
  if (!node.attributes) return undefined;
  for (let i = 0; i < node.attributes.length; i += 2) {
    if (node.attributes[i] === name) return node.attributes[i + 1];
  }
  return undefined;
};

const isInteractive = (node: CDPNode): boolean => {
  const tag = node.nodeName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = getAttr(node, 'role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (getAttr(node, 'onclick') != null) return true;
  if (getAttr(node, 'contenteditable') === 'true') return true;
  const tabIndex = getAttr(node, 'tabindex');
  if (tabIndex != null && Number(tabIndex) >= 0) return true;
  if (/\bcursor\s*:\s*(pointer|grab)\b/i.test(getAttr(node, 'style') ?? '')) return true;
  return false;
};

const isExcluded = (node: CDPNode): boolean => {
  if (getAttr(node, 'hidden') != null || getAttr(node, 'inert') != null) return true;
  if (getAttr(node, 'aria-hidden') === 'true') return true;
  if (getAttr(node, 'disabled') != null) return true;
  const style = getAttr(node, 'style') ?? '';
  return (
    /(?:^|;)\s*display\s*:\s*none\b/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden\b/i.test(style)
  );
};

const truncateText = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_TEXT_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TEXT_LENGTH) + '...';
};

const collectTextContent = (node: CDPNode, includeDescendants = false): string => {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  let text = '';
  for (const child of node.children ?? []) {
    if (child.nodeType === 3) {
      text += child.nodeValue ?? '';
    } else if (includeDescendants && child.nodeType === 1) {
      text += collectTextContent(child, true);
    }
  }
  return text;
};

const getInteractiveLabel = (node: CDPNode): string => {
  const text = truncateText(collectTextContent(node, true));
  if (text) return text;
  const ariaLabel = truncateText(getAttr(node, 'aria-label') ?? '');
  if (ariaLabel) return ariaLabel;
  return truncateText(getAttr(node, 'title') ?? '');
};

const formatInteractiveNode = (node: CDPNode, ref: number): string => {
  const tag = node.nodeName.toLowerCase();
  const parts: string[] = [`[${ref}]`];

  // Determine display type
  if (tag === 'a') {
    parts.push('link');
  } else if (tag === 'button' || getAttr(node, 'role') === 'button') {
    parts.push('button');
  } else if (tag === 'input') {
    const type = getAttr(node, 'type') ?? 'text';
    parts.push(`input type=${type}`);
  } else if (tag === 'select') {
    parts.push('select');
  } else if (tag === 'textarea') {
    parts.push('textarea');
  } else {
    const role = getAttr(node, 'role');
    parts.push(role ?? tag);
  }

  if (getAttr(node, 'contenteditable') === 'true') parts.push('contenteditable');
  const label = getInteractiveLabel(node);
  if (label) parts.push(`"${label}"`);

  // Key attributes

  const placeholder = getAttr(node, 'placeholder');
  if (placeholder) parts.push(`placeholder="${truncateText(placeholder)}"`);

  const href = getAttr(node, 'href');
  if (href) parts.push(`href=${href.length > 60 ? href.slice(0, 60) + '...' : href}`);

  const value = getAttr(node, 'value');
  if (value && tag === 'input') parts.push(`value="${truncateText(value)}"`);

  const name = getAttr(node, 'name');
  if (name) parts.push(`name="${name}"`);

  if (getAttr(node, 'disabled') != null) parts.push('disabled');
  if (getAttr(node, 'readonly') != null) parts.push('readonly');
  if (getAttr(node, 'required') != null) parts.push('required');

  return parts.join(' ');
};

const walkNode = (node: CDPNode, depth: number, ctx: SnapshotContext): void => {
  if (ctx.nodeCount >= MAX_NODES) return;
  if (depth > MAX_DEPTH) return;

  const tag = node.nodeName.toLowerCase();

  // Skip invisible/irrelevant nodes
  if (SKIP_TAGS.has(tag) || getAttr(node, 'data-asktab-visuals') != null || isExcluded(node))
    return;

  const indent = '  '.repeat(depth);
  ctx.nodeCount++;

  // Text node
  if (node.nodeType === 3) {
    const text = truncateText(node.nodeValue ?? '');
    if (text) {
      ctx.lines.push(`${indent}${text}`);
    }
    return;
  }

  // Element node
  if (node.nodeType === 1) {
    // Handle iframes specially
    if (tag === 'iframe') {
      const src = getAttr(node, 'src') ?? '';
      ctx.lines.push(`${indent}[iframe] src=${src}`);
      // Walk contentDocument if same-origin
      if (node.contentDocument) {
        walkNode(node.contentDocument, depth + 1, ctx);
      }
      return;
    }

    if (isInteractive(node)) {
      const ref = ++ctx.refCounter;
      ctx.refMap.set(ref, { nodeId: node.nodeId, backendNodeId: node.backendNodeId });
      ctx.lines.push(`${indent}${formatInteractiveNode(node, ref)}`);
      if ((tag === 'button' || getAttr(node, 'role') === 'button') && !getInteractiveLabel(node)) {
        ctx.unlabeledButtonRefs?.add(ref);
      }
      // Walk children for nested interactive elements
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        if (child.nodeType === 1 && isInteractive(child)) {
          walkNode(child, depth + 1, ctx);
        }
        if (child.nodeType === 11) walkNode(child, depth + 1, ctx);
      }
      return;
    }

    if (STRUCTURAL_TAGS.has(tag)) {
      // Only emit structural tag if it has content
      const childLines: string[] = [];
      const childCtx: SnapshotContext = {
        ...ctx,
        lines: childLines,
      };
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        walkNode(child, depth + 1, childCtx);
      }
      // Update shared counters
      ctx.refCounter = childCtx.refCounter;
      ctx.nodeCount = childCtx.nodeCount;

      if (childLines.length > 0) {
        ctx.lines.push(`${indent}[${tag}]`);
        ctx.lines.push(...childLines);
      }
      return;
    }

    // Other element — just walk children
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
      walkNode(child, depth, ctx);
    }
  }

  // Document node (nodeType 9)
  if (node.nodeType === 9 || node.nodeType === 11) {
    for (const child of node.children ?? []) {
      walkNode(child, depth, ctx);
    }
  }
};

export {
  walkNode,
  isInteractive,
  formatInteractiveNode,
  truncateText,
  collectTextContent,
  MAX_NODES,
  MAX_DEPTH,
  MAX_TEXT_LENGTH,
  MAX_RESULT_CHARS,
};
export type { CDPNode, SnapshotContext, RefEntry };
