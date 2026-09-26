import { useT } from '@extension/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Separator,
} from '@extension/ui';
import {
  PlayIcon,
  TrashIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  ClockIcon,
  RefreshCwIcon,
  HistoryIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type TaskSummary = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: { kind: string; everyMs?: number; atMs?: number };
  payload: { kind: string; message?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
};

type RunLogEntry = {
  id: string;
  taskId: string;
  timestamp: number;
  status: string;
  error?: string;
  durationMs?: number;
  chatId?: string;
};

type CronStatus = {
  running: boolean;
  tasks: number;
  nextWakeAtMs: number | null;
};

const sendMessage = (msg: Record<string, unknown>): Promise<Record<string, unknown>> =>
  chrome.runtime.sendMessage(msg) as Promise<Record<string, unknown>>;

const formatMs = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
};

const formatSchedule = (schedule: TaskSummary['schedule']): string => {
  if (schedule.kind === 'at' && schedule.atMs) {
    return `Once at ${new Date(schedule.atMs).toLocaleString()}`;
  }
  if (schedule.kind === 'every' && schedule.everyMs) {
    return `Every ${formatMs(schedule.everyMs)}`;
  }
  return schedule.kind;
};

const formatTime = (ms?: number): string => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
};

const CronConfig = () => {
  const t = useT();
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<RunLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, tasksRes] = await Promise.all([
        sendMessage({ type: 'CRON_STATUS' }),
        sendMessage({ type: 'CRON_LIST_TASKS', includeDisabled: true }),
      ]);
      if (statusRes.status) setStatus(statusRes.status as CronStatus);
      if (tasksRes.tasks) setTasks(tasksRes.tasks as TaskSummary[]);
    } catch {
      // Extension may not be ready
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Listen for cron events for live refresh
    const listener = (message: Record<string, unknown>) => {
      if (message.type === 'CRON_EVENT') refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const handleToggle = useCallback(
    async (taskId: string, enabled: boolean) => {
      await sendMessage({ type: 'CRON_TOGGLE_TASK', taskId, enabled });
      refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      await sendMessage({ type: 'CRON_DELETE_TASK', taskId });
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      refresh();
    },
    [refresh, selectedTaskId],
  );

  const handleRunNow = useCallback(
    async (taskId: string) => {
      await sendMessage({ type: 'CRON_RUN_NOW', taskId });
      refresh();
    },
    [refresh],
  );

  const handleViewRuns = useCallback(async (taskId: string) => {
    setSelectedTaskId(prev => (prev === taskId ? null : taskId));
    const res = await sendMessage({ type: 'CRON_GET_RUNS', taskId });
    if (res.runs) setRunLogs(res.runs as RunLogEntry[]);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockIcon className="h-5 w-5" />
            {t('cron_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('common_loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5" />
                {t('cron_title')}
              </CardTitle>
              <CardDescription>{t('cron_description')}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {status && (
                <Badge variant={status.running ? 'default' : 'secondary'}>
                  {status.running ? t('cron_active') : t('cron_stopped')}
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={refresh}>
                <RefreshCwIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        {status && (
          <CardContent>
            <div className="text-muted-foreground flex gap-4 text-sm">
              <span>
                {status.tasks} task{status.tasks !== 1 ? 's' : ''}
              </span>
              {status.nextWakeAtMs && <span>Next run: {formatTime(status.nextWakeAtMs)}</span>}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Task List */}
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">{t('cron_noJobs')}</p>
          </CardContent>
        </Card>
      ) : (
        tasks.map(task => (
          <Card key={task.id} className={!task.enabled ? 'opacity-60' : ''}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium">{task.name}</h3>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {task.payload.kind}
                    </Badge>
                    {task.state.lastStatus && (
                      <Badge
                        variant={
                          task.state.lastStatus === 'ok'
                            ? 'default'
                            : task.state.lastStatus === 'error'
                              ? 'destructive'
                              : 'secondary'
                        }
                        className="shrink-0 text-xs">
                        {task.state.lastStatus}
                      </Badge>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-muted-foreground mt-1 truncate text-xs">
                      {task.description}
                    </p>
                  )}
                  <div className="text-muted-foreground mt-1 flex flex-wrap gap-3 text-xs">
                    <span>{formatSchedule(task.schedule)}</span>
                    {task.state.nextRunAtMs && (
                      <span>Next: {formatTime(task.state.nextRunAtMs)}</span>
                    )}
                    {task.state.lastRunAtMs && (
                      <span>Last: {formatTime(task.state.lastRunAtMs)}</span>
                    )}
                    {task.state.lastDurationMs !== undefined && (
                      <span>Duration: {formatMs(task.state.lastDurationMs)}</span>
                    )}
                  </div>
                  {task.state.lastError && (
                    <p className="mt-1 truncate text-xs text-red-500">{task.state.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title={task.enabled ? 'Disable' : 'Enable'}
                    onClick={() => handleToggle(task.id, !task.enabled)}>
                    {task.enabled ? (
                      <ToggleRightIcon className="h-4 w-4 text-green-500" />
                    ) : (
                      <ToggleLeftIcon className="text-muted-foreground h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Run now"
                    onClick={() => handleRunNow(task.id)}>
                    <PlayIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="View history"
                    onClick={() => handleViewRuns(task.id)}>
                    <HistoryIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t('common_delete')}
                    onClick={() => handleDelete(task.id)}>
                    <TrashIcon className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>

              {/* Run History (expandable) */}
              {selectedTaskId === task.id && (
                <>
                  <Separator className="my-3" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-medium">{t('cron_runHistory')}</h4>
                    {runLogs.length === 0 ? (
                      <p className="text-muted-foreground text-xs">{t('cron_noRuns')}</p>
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {runLogs
                          .slice()
                          .reverse()
                          .map(log => (
                            <div
                              key={log.id}
                              className="flex items-center gap-2 rounded px-2 py-1 text-xs odd:bg-gray-50 dark:odd:bg-gray-900/30">
                              <Badge
                                variant={
                                  log.status === 'ok'
                                    ? 'default'
                                    : log.status === 'error'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                                className="text-[10px]">
                                {log.status}
                              </Badge>
                              <span className="text-muted-foreground">
                                {new Date(log.timestamp).toLocaleString()}
                              </span>
                              {log.durationMs !== undefined && (
                                <span className="text-muted-foreground">
                                  {formatMs(log.durationMs)}
                                </span>
                              )}
                              {log.error && (
                                <span className="truncate text-red-500">{log.error}</span>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export { CronConfig };
