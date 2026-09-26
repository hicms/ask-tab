import { Badge } from './ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import { cn } from '../utils';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PowerIcon,
  TrashIcon,
} from 'lucide-react';
import type { FileTreeNode } from '../build-file-tree';
import type { DbWorkspaceFile } from '@extension/storage';

type TreeNodeProps = {
  node: FileTreeNode;
  depth: number;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onEditFile?: (file: DbWorkspaceFile) => void;
  onViewFile?: (file: DbWorkspaceFile) => void;
  onToggleFile: (file: DbWorkspaceFile) => void;
  onDeleteFile: (file: DbWorkspaceFile) => void;
  selectedPath?: string | null;
  onSelect?: (node: FileTreeNode) => void;
};

const TreeNode = ({
  node,
  depth,
  expandedFolders,
  onToggleFolder,
  onEditFile,
  onViewFile,
  onToggleFile,
  onDeleteFile,
  selectedPath,
  onSelect,
}: TreeNodeProps) => {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders.has(node.path);
    return (
      <>
        <button
          className={cn(
            'flex w-full items-center gap-1 rounded-md py-1.5 text-sm',
            selectedPath === node.path ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
          )}
          onClick={() => {
            onSelect?.(node);
            onToggleFolder(node.path);
          }}
          style={{ paddingLeft: 12 + depth * 16 }}
          type="button">
          {isExpanded ? (
            <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpenIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <FolderIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onEditFile={onEditFile}
              onViewFile={onViewFile}
              onToggleFile={onToggleFile}
              onDeleteFile={onDeleteFile}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  // File node
  const { file } = node;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md py-1.5 text-sm',
            selectedPath === node.path ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
          )}
          onClick={() => onSelect?.(node)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') onSelect?.(node);
          }}
          role="button"
          style={{ paddingLeft: 12 + depth * 16 + 18 }}
          tabIndex={0}>
          <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
          <button
            className={cn(
              'min-w-0 flex-1 cursor-pointer truncate text-left',
              !file.enabled && 'text-muted-foreground line-through',
            )}
            onClick={e => {
              e.stopPropagation();
              onSelect?.(node);
            }}
            onDoubleClick={() => onEditFile?.(file)}
            title={node.name}
            type="button">
            {node.name}
          </button>
          {!file.enabled && (
            <Badge className="mr-2 shrink-0 text-[10px]" variant="outline">
              OFF
            </Badge>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onEditFile && (
          <ContextMenuItem onClick={() => onEditFile(file)}>
            <PencilIcon className="size-4" />
            Edit
          </ContextMenuItem>
        )}
        {onViewFile && (
          <ContextMenuItem onClick={() => onViewFile(file)}>
            <EyeIcon className="size-4" />
            View
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onToggleFile(file)}>
          <PowerIcon className="size-4" />
          {file.enabled ? 'Disable' : 'Enable'}
        </ContextMenuItem>
        {!file.predefined && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive" onClick={() => onDeleteFile(file)}>
              <TrashIcon className="size-4" />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

export { TreeNode };
export type { TreeNodeProps };
