import { ConfirmDialog, emptyConfirm } from './confirm-dialog.js';
import { t, useT } from '@extension/i18n';
import { updateWorkspaceFile, deleteWorkspaceFile, createWorkspaceFile } from '@extension/storage';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MarkdownEditor,
  ScrollArea,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TreeNode,
  buildFileTree,
} from '@extension/ui';
import JSZip from 'jszip';
import {
  DownloadIcon,
  FilePlusIcon,
  FolderPlusIcon,
  HardDriveDownloadIcon,
  PencilIcon,
  RotateCcwIcon,
  SaveIcon,
  TextCursorInputIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ConfirmDialogState } from './confirm-dialog.js';
import type { DbWorkspaceFile } from '@extension/storage';
import type { FileTreeNode } from '@extension/ui';

type PromptDialogState = {
  open: boolean;
  title: string;
  defaultValue: string;
  onSubmit: (value: string) => void;
};

const emptyPrompt: PromptDialogState = {
  open: false,
  title: '',
  defaultValue: '',
  onSubmit: () => {},
};

const PromptDialog = ({ state, onClose }: { state: PromptDialogState; onClose: () => void }) => {
  const [value, setValue] = useState(state.defaultValue);

  useEffect(() => {
    setValue(state.defaultValue);
  }, [state.defaultValue, state.open]);

  return (
    <Dialog open={state.open} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription className="sr-only">{state.title}</DialogDescription>
        </DialogHeader>
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- focus the input the user just opened
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) {
              state.onSubmit(value.trim());
              onClose();
            }
          }}
        />
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {t('common_cancel')}
          </Button>
          <Button
            disabled={!value.trim()}
            onClick={() => {
              state.onSubmit(value.trim());
              onClose();
            }}>
            {t('common_ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FileEditorDialog = ({
  file,
  onSave,
  onClose,
}: {
  file: DbWorkspaceFile;
  onSave: (content: string) => void;
  onClose: () => void;
}) => {
  const [content, setContent] = useState(file.content);
  const [isDirty, setIsDirty] = useState(false);
  const [mode, setMode] = useState<'view' | 'raw' | 'split'>('raw');

  useEffect(() => {
    setContent(file.content);
    setIsDirty(false);
  }, [file.id, file.content]);

  const charCount = content.length;

  return (
    <>
      <MarkdownEditor
        content={content}
        onChange={newContent => {
          setContent(newContent);
          setIsDirty(true);
        }}
        mode={mode}
        onModeChange={setMode}
        className="min-h-[350px]"
      />

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-muted-foreground text-xs">{charCount.toLocaleString()} chars</span>
        <div className="flex gap-2">
          <Button onClick={onClose} size="sm" variant="outline">
            {t('common_cancel')}
          </Button>
          <Button
            disabled={!isDirty}
            onClick={() => {
              onSave(content);
              onClose();
            }}
            size="sm">
            <SaveIcon className="mr-1 size-3.5" />
            {t('common_save')}
          </Button>
        </div>
      </div>
    </>
  );
};

const AgentFilesTab = ({
  files,
  agentId,
  onReload,
}: {
  files: DbWorkspaceFile[];
  agentId: string;
  onReload: () => void;
}) => {
  const t = useT();
  const [editorFile, setEditorFile] = useState<DbWorkspaceFile | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<FileTreeNode | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(emptyConfirm);
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(emptyPrompt);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildFileTree(files), [files]);

  // Derived toolbar state
  const selectedFile = selectedNode?.type === 'file' ? selectedNode.file : null;
  const folderHasPredefined =
    selectedNode?.type === 'folder' &&
    files.some(f => f.predefined && f.name.startsWith(selectedNode.path + '/'));
  const canDelete =
    !!selectedNode &&
    (selectedNode.type === 'file' ? !selectedFile?.predefined : !folderHasPredefined);
  const canRename = canDelete;
  const canEdit = selectedNode?.type === 'file';
  const canDownload = selectedNode?.type === 'file';
  const canDownloadFolder = selectedNode?.type === 'folder';

  // Keep editor file in sync with file list updates; clear if deleted
  useEffect(() => {
    setEditorFile(prev => {
      if (!prev) return prev;
      return files.find(f => f.id === prev.id) ?? null;
    });
  }, [files]);

  // Keep selectedNode in sync with file list updates
  useEffect(() => {
    setSelectedNode(prev => {
      if (prev?.type !== 'file') return prev;
      const updated = files.find(f => f.id === prev.file.id);
      if (!updated) return null;
      if (updated !== prev.file) return { ...prev, file: updated };
      return prev;
    });
  }, [files]);

  // Reset when agent changes
  useEffect(() => {
    setEditorFile(null);
    setSelectedNode(null);
    setExpandedFolders(new Set());
  }, [agentId]);

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectNode = useCallback((node: FileTreeNode) => {
    setSelectedNode(node);
  }, []);

  const handleToggle = useCallback(
    async (file: DbWorkspaceFile) => {
      await updateWorkspaceFile(file.id, { enabled: !file.enabled });
      onReload();
    },
    [onReload],
  );

  const doDeleteFile = useCallback(
    async (file: DbWorkspaceFile) => {
      await deleteWorkspaceFile(file.id);
      if (editorFile?.id === file.id) {
        setEditorFile(null);
      }
      if (selectedNode?.type === 'file' && selectedNode.file.id === file.id) {
        setSelectedNode(null);
      }
      onReload();
      toast.success(t('agents_fileDeleted'));
    },
    [editorFile, selectedNode, onReload, t],
  );

  const handleDelete = useCallback(
    (file: DbWorkspaceFile) => {
      setConfirmDialog({
        open: true,
        title: t('agents_deleteFile'),
        description: t('agents_deleteFileConfirm', file.name),
        destructive: true,
        onConfirm: () => doDeleteFile(file),
      });
    },
    [doDeleteFile, t],
  );

  // Get the folder path prefix for new files when a folder/file-in-folder is selected
  const getSelectedFolderPrefix = useCallback(() => {
    if (!selectedNode) return '';
    if (selectedNode.type === 'folder') return selectedNode.path + '/';
    // If a file inside a folder is selected, use its parent folder
    const lastSlash = selectedNode.path.lastIndexOf('/');
    return lastSlash >= 0 ? selectedNode.path.slice(0, lastSlash + 1) : '';
  }, [selectedNode]);

  const handleNewFile = useCallback(async () => {
    const prefix = getSelectedFolderPrefix();
    const now = Date.now();
    const file: DbWorkspaceFile = {
      id: nanoid(),
      name: prefix + 'untitled.md',
      content: '',
      enabled: true,
      owner: 'user',
      predefined: false,
      createdAt: now,
      updatedAt: now,
      agentId,
    };
    await createWorkspaceFile(file);
    onReload();
    setEditorFile(file);
  }, [onReload, agentId, getSelectedFolderPrefix]);

  const handleNewFolder = useCallback(() => {
    setPromptDialog({
      open: true,
      title: t('agents_newFolderName'),
      defaultValue: '',
      onSubmit: async (name: string) => {
        const folderName = name.replace(/\//g, '-');
        const prefix = getSelectedFolderPrefix();
        const folderPath = prefix + folderName;
        const now = Date.now();
        const file: DbWorkspaceFile = {
          id: nanoid(),
          name: folderPath + '/untitled.md',
          content: '',
          enabled: true,
          owner: 'user',
          predefined: false,
          createdAt: now,
          updatedAt: now,
          agentId,
        };
        await createWorkspaceFile(file);
        setExpandedFolders(prev => new Set([...prev, folderPath]));
        onReload();
      },
    });
  }, [onReload, agentId, getSelectedFolderPrefix, t]);

  const handleUpload = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleUploadFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can be re-uploaded
      e.target.value = '';

      const text = await file.text();

      const prefix = getSelectedFolderPrefix();
      const fileName = prefix + file.name;

      // Check for name collision
      if (files.some(f => f.name === fileName)) {
        toast.error(`A file named "${fileName}" already exists`);
        return;
      }

      const now = Date.now();
      const wsFile: DbWorkspaceFile = {
        id: nanoid(),
        name: fileName,
        content: text,
        enabled: true,
        owner: 'user',
        predefined: false,
        createdAt: now,
        updatedAt: now,
        agentId,
      };
      await createWorkspaceFile(wsFile);
      onReload();
      toast.success(t('agents_fileUploaded'));
    },
    [onReload, agentId, files, getSelectedFolderPrefix, t],
  );

  const handleRename = useCallback(() => {
    if (!selectedNode || !canRename) return;

    if (selectedNode.type === 'file') {
      const file = selectedNode.file;
      const currentName = file.name.split('/').pop() ?? file.name;
      setPromptDialog({
        open: true,
        title: t('agents_renameFile'),
        defaultValue: currentName,
        onSubmit: async (newName: string) => {
          if (newName === currentName) return;
          const prefix =
            file.name.lastIndexOf('/') >= 0
              ? file.name.slice(0, file.name.lastIndexOf('/') + 1)
              : '';
          const fullNewName = prefix + newName;
          if (files.some(f => f.id !== file.id && f.name === fullNewName)) {
            toast.error(`A file named "${fullNewName}" already exists`);
            return;
          }
          await updateWorkspaceFile(file.id, { name: fullNewName });
          setSelectedNode(null);
          onReload();
          toast.success(t('agents_fileRenamed'));
        },
      });
    } else {
      const oldPrefix = selectedNode.path + '/';
      const childFiles = files.filter(f => f.name?.startsWith(oldPrefix));

      if (childFiles.some(f => f.predefined)) {
        toast.error(t('agents_cannotRenamePredefined'));
        return;
      }

      setPromptDialog({
        open: true,
        title: t('agents_renameFolder'),
        defaultValue: selectedNode.name,
        onSubmit: async (newFolderName: string) => {
          if (newFolderName === selectedNode.name) return;
          const sanitized = newFolderName.replace(/\//g, '-');
          const parentPrefix =
            selectedNode.path.lastIndexOf('/') >= 0
              ? selectedNode.path.slice(0, selectedNode.path.lastIndexOf('/') + 1)
              : '';
          const newPrefix = parentPrefix + sanitized + '/';
          await Promise.all(
            childFiles.map(f =>
              updateWorkspaceFile(f.id, { name: newPrefix + f.name.slice(oldPrefix.length) }),
            ),
          );
          setSelectedNode(null);
          onReload();
          toast.success(t('agents_folderRenamed'));
        },
      });
    }
  }, [selectedNode, canRename, files, onReload, t]);

  const handleToolbarDelete = useCallback(() => {
    if (!selectedNode || !canDelete) return;

    if (selectedNode.type === 'file') {
      handleDelete(selectedNode.file);
    } else {
      const prefix = selectedNode.path + '/';
      const childFiles = files.filter(f => f.name?.startsWith(prefix));

      if (childFiles.some(f => f.predefined)) {
        toast.error(t('agents_cannotDeletePredefined'));
        return;
      }

      setConfirmDialog({
        open: true,
        title: t('agents_deleteFolder'),
        description: t('agents_deleteFolderConfirm', [
          selectedNode.name,
          String(childFiles.length),
        ]),
        destructive: true,
        onConfirm: async () => {
          await Promise.all(childFiles.map(f => deleteWorkspaceFile(f.id)));
          setSelectedNode(null);
          onReload();
          toast.success(t('agents_folderDeleted'));
        },
      });
    }
  }, [selectedNode, canDelete, files, handleDelete, onReload, t]);

  const handleToolbarEdit = useCallback(() => {
    if (selectedNode?.type === 'file') {
      setEditorFile(selectedNode.file);
    }
  }, [selectedNode]);

  const handleDownload = useCallback(() => {
    if (selectedNode?.type !== 'file') return;
    const file = selectedNode.file;
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.split('/').pop() ?? file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedNode]);

  const handleDownloadFolder = useCallback(async () => {
    if (selectedNode?.type !== 'folder') return;
    const prefix = selectedNode.path + '/';
    const folderFiles = files.filter(f => f.name?.startsWith(prefix));
    if (folderFiles.length === 0) {
      toast.error(t('agents_folderEmpty'));
      return;
    }

    try {
      const zip = new JSZip();
      for (const f of folderFiles) {
        const relativePath = f.name.slice(prefix.length);
        zip.file(relativePath, f.content);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedNode.name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        `Failed to download folder: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }, [selectedNode?.type, selectedNode?.path, selectedNode?.name, files, t]);

  const handleSave = useCallback(
    async (content: string) => {
      if (!editorFile) return;
      await updateWorkspaceFile(editorFile.id, { content });
      onReload();
      toast.success(t('agents_fileSaved'));
    },
    [editorFile, onReload, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5 border-b px-2 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="size-7" onClick={handleNewFile} size="icon" variant="ghost">
                <FilePlusIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_newFile')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="size-7" onClick={handleNewFolder} size="icon" variant="ghost">
                <FolderPlusIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_newFolder')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="size-7" onClick={handleUpload} size="icon" variant="ghost">
                <UploadIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_upload')}</TooltipContent>
          </Tooltip>

          <Separator className="mx-1 h-4" orientation="vertical" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                disabled={!canEdit}
                onClick={handleToolbarEdit}
                size="icon"
                variant="ghost">
                <PencilIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_edit')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                disabled={!canRename}
                onClick={handleRename}
                size="icon"
                variant="ghost">
                <TextCursorInputIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('session_rename')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                disabled={!canDownload}
                onClick={handleDownload}
                size="icon"
                variant="ghost">
                <DownloadIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_download')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                disabled={!canDownloadFolder}
                onClick={handleDownloadFolder}
                size="icon"
                variant="ghost">
                <HardDriveDownloadIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_downloadFolderZip')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                disabled={!canDelete}
                onClick={handleToolbarDelete}
                size="icon"
                variant="ghost">
                <TrashIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('common_delete')}</TooltipContent>
          </Tooltip>

          <Separator className="mx-1 h-4" orientation="vertical" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="size-7" onClick={onReload} size="icon" variant="ghost">
                <RotateCcwIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_refresh')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      <input
        className="hidden"
        ref={uploadInputRef}
        onChange={handleUploadFileSelected}
        type="file"
      />

      <ScrollArea className="flex-1">
        <div
          className="py-2"
          onClick={e => {
            if (e.target === e.currentTarget) setSelectedNode(null);
          }}
          role="presentation">
          {tree.map(node => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
              onEditFile={f => setEditorFile(f)}
              onToggleFile={handleToggle}
              onDeleteFile={handleDelete}
              selectedPath={selectedNode?.path ?? null}
              onSelect={handleSelectNode}
            />
          ))}
        </div>
      </ScrollArea>

      <Dialog
        open={!!editorFile}
        onOpenChange={open => {
          if (!open) setEditorFile(null);
        }}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{editorFile?.name}</DialogTitle>
            <DialogDescription className="sr-only">Edit {editorFile?.name}</DialogDescription>
          </DialogHeader>
          {editorFile && (
            <FileEditorDialog
              file={editorFile}
              onSave={handleSave}
              onClose={() => setEditorFile(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(emptyConfirm)} />
      <PromptDialog state={promptDialog} onClose={() => setPromptDialog(emptyPrompt)} />
    </div>
  );
};

export { AgentFilesTab };
