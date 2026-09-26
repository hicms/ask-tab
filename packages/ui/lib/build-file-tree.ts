import type { DbWorkspaceFile } from '@extension/storage';

export type FileTreeNode =
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { type: 'file'; name: string; path: string; file: DbWorkspaceFile };

/**
 * Build a tree hierarchy from a flat list of workspace files.
 * Files with paths like `skills/web-research/SKILL.md` become nested folder nodes.
 * At each level, folders sort first (alphabetical), then files (alphabetical).
 */
export function buildFileTree(files: DbWorkspaceFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    if (!file.name) continue;
    const segments = file.name.split('/');
    let currentLevel = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast) {
        // File leaf node
        currentLevel.push({
          type: 'file',
          name: segment,
          path: file.name,
          file,
        });
      } else {
        // Folder intermediate node — find or create
        const folderPath = segments.slice(0, i + 1).join('/');
        let folder = currentLevel.find(
          (n): n is Extract<FileTreeNode, { type: 'folder' }> =>
            n.type === 'folder' && n.path === folderPath,
        );
        if (!folder) {
          folder = { type: 'folder', name: segment, path: folderPath, children: [] };
          currentLevel.push(folder);
        }
        currentLevel = folder.children;
      }
    }
  }

  sortTreeLevel(root);
  return root;
}

function sortTreeLevel(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    // Folders first, then files
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const node of nodes) {
    if (node.type === 'folder') {
      sortTreeLevel(node.children);
    }
  }
}
