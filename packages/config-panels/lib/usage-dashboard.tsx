import { useT } from '@extension/i18n';
import { listChats } from '@extension/storage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@extension/ui';
import { BarChart3Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SessionStats {
  id: string;
  title: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  compactionCount: number;
  updatedAt: number;
}

const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const UsageDashboard = () => {
  const t = useT();
  const [sessions, setSessions] = useState<SessionStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listChats(500)
      .then(chats => {
        const stats = chats
          .map(c => ({
            id: c.id,
            title: c.title,
            totalTokens: c.totalTokens ?? 0,
            inputTokens: c.inputTokens ?? 0,
            outputTokens: c.outputTokens ?? 0,
            compactionCount: c.compactionCount ?? 0,
            updatedAt: c.updatedAt,
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens);
        setSessions(stats);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalInput = sessions.reduce((s, c) => s + c.inputTokens, 0);
  const totalOutput = sessions.reduce((s, c) => s + c.outputTokens, 0);
  const totalTokens = sessions.reduce((s, c) => s + c.totalTokens, 0);
  const sessionCount = sessions.length;
  const avgTokens = sessionCount > 0 ? Math.round(totalTokens / sessionCount) : 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3Icon className="size-5" />
            {t('usage_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('common_loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3Icon className="size-5" />
          {t('usage_title')}
        </CardTitle>
        <CardDescription>{t('usage_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Aggregate stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md border p-3 text-center">
            <p className="text-muted-foreground text-xs">{t('usage_sessions')}</p>
            <p className="text-lg font-bold">{sessionCount}</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-muted-foreground text-xs">{t('usage_totalTokens')}</p>
            <p className="text-lg font-bold">{formatTokenCount(totalTokens)}</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-muted-foreground text-xs">{t('usage_input')}</p>
            <p className="text-lg font-bold">{formatTokenCount(totalInput)}</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-muted-foreground text-xs">{t('usage_output')}</p>
            <p className="text-lg font-bold">{formatTokenCount(totalOutput)}</p>
          </div>
        </div>

        <div className="text-muted-foreground text-xs">
          {t('usage_average', formatTokenCount(avgTokens))}
        </div>

        {/* Per-session breakdown */}
        {sessions.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t('usage_sessionsByUsage')}</h3>
            <div className="divide-y rounded-md border">
              {sessions.slice(0, 20).map(s => (
                <div className="flex items-center gap-3 px-3 py-2" key={s.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.title}</p>
                    <p className="text-muted-foreground text-xs">{formatDate(s.updatedAt)}</p>
                  </div>
                  <div className="text-right text-xs">
                    <span className="font-mono font-medium">{formatTokenCount(s.totalTokens)}</span>
                    {s.compactionCount > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({t('usage_compacted', String(s.compactionCount))})
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {sessions.length > 20 && (
                <div className="text-muted-foreground px-3 py-2 text-center text-xs">
                  {t('usage_moreSessionsCount', String(sessions.length - 20))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { UsageDashboard };
