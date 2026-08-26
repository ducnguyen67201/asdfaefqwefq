import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type { UsageResponse } from '../api/contracts';
import { EmptyState } from '../components/EmptyState';
import { SummaryCard } from '../components/SummaryCard';
import { UsageChart } from '../components/UsageChart';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  compactNumber,
  dateTimeLabel,
  initials,
  moneyLabel,
  shortIdentifier,
  usageLaneLabels,
  usageMetric,
} from '../lib/formatters';

const PAGE_SIZE = 50;
const rangeLabels: Record<string, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};
const laneFilterLabels: Record<string, string> = {
  '': 'All activity',
  realtime_transcription: 'Live voice',
  responses: 'Agent tasks',
  speech: 'Spoken replies',
  transcription: 'Voice transcription',
};

interface UsagePageProps {
  active: boolean;
  notify: (message: string) => void;
  onSessionExpired: () => void;
}

const emptyResponse: UsageResponse = {
  items: [],
  page: { limit: PAGE_SIZE, offset: 0, total: 0 },
  series: { granularity: 'day', items: [] },
  summary: {
    activeUsers: 0,
    totalRequests: 0,
    totalSpendMicroUsd: 0,
    totalTokens: 0,
  },
};

export function UsagePage({
  active,
  notify,
  onSessionExpired,
}: UsagePageProps) {
  const [lane, setLane] = useState('');
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('7d');
  const [response, setResponse] = useState<UsageResponse>(emptyResponse);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 260);
  const itemCountRef = useRef(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    itemCountRef.current = response.items.length;
  }, [response.items.length]);

  const loadUsage = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await adminApi.listUsage({
          lane,
          limit: PAGE_SIZE,
          offset: append ? itemCountRef.current : 0,
          range,
          search: debouncedSearch,
        });
        if (requestId !== requestSequence.current) return;
        setResponse((current) => ({
          ...result,
          items: append ? [...current.items, ...result.items] : result.items,
        }));
      } catch (caught) {
        if (requestId !== requestSequence.current) return;
        if (isUnauthorized(caught)) {
          onSessionExpired();
          return;
        }
        notify(errorMessage(caught));
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    }, [debouncedSearch, lane, notify, onSessionExpired, range],
  );

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void loadUsage(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, loadUsage]);

  return (
    <section className="page-view" hidden={!active} id="usage-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Product activity</p>
          <h1>Usage</h1>
          <p className="page-subtitle">
            See who is using Tro, what capabilities they use, and how much each
            activity costs.
          </p>
        </div>
        <button
          className="button button--secondary"
          disabled={loading}
          onClick={() => void loadUsage()}
          type="button"
        >
          <span aria-hidden="true">↻</span>
          Refresh
        </button>
      </header>

      <section className="summary-grid summary-grid--usage" aria-label="Usage summary">
        <SummaryCard
          foot="Completed model activity"
          label="Total spend"
          value={moneyLabel(response.summary.totalSpendMicroUsd)}
        />
        <SummaryCard
          foot="Unique people in this period"
          footKind="good"
          label="Active users"
          value={compactNumber(response.summary.activeUsers)}
        />
        <SummaryCard
          foot="Agent, voice, and speech requests"
          label="Model calls"
          value={compactNumber(response.summary.totalRequests)}
        />
        <SummaryCard
          foot="Input and output combined"
          label="Tokens"
          value={compactNumber(response.summary.totalTokens)}
        />
      </section>

      <UsageChart
        controls={
          <div className="toolbar-controls toolbar-controls--usage">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search usage</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search user, task, or model"
                type="search"
                value={search}
              />
            </label>
            <label className="filter-field filter-field--usage">
              <span className="sr-only">Filter by activity</span>
              <select onChange={(event) => setLane(event.target.value)} value={lane}>
                <option value="">All activity</option>
                <option value="responses">Agent tasks</option>
                <option value="transcription">Voice transcription</option>
                <option value="realtime_transcription">Live voice</option>
                <option value="speech">Spoken replies</option>
              </select>
            </label>
            <label className="filter-field filter-field--range">
              <span className="sr-only">Filter by date range</span>
              <select onChange={(event) => setRange(event.target.value)} value={range}>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </label>
          </div>
        }
        laneLabel={laneFilterLabels[lane] ?? 'All activity'}
        loading={loading}
        rangeLabel={rangeLabels[range] ?? 'Selected period'}
        series={response.series}
        summary={response.summary}
      />

      <aside className="privacy-note" aria-label="Usage privacy">
        <span className="privacy-note__icon" aria-hidden="true">◇</span>
        <span>
          <strong>Private by design.</strong> Prompts, outputs, screenshots, and
          tool inputs are never stored here—only billing and activity metadata.
        </span>
      </aside>

      <section className="table-card" aria-labelledby="usage-table-title">
        <div className="table-toolbar">
          <div>
            <h2 id="usage-table-title">Recent activity</h2>
            <p>
              {loading
                ? 'Loading activity…'
                : `${response.page.total.toLocaleString()} matching activit${response.page.total === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
        </div>
        {response.items.length ? (
          <div className="table-scroll">
            <table className="usage-table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Model</th>
                  <th scope="col">Usage</th>
                  <th scope="col">Cost</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {response.items.map((item) => {
                  const metric = usageMetric(item);
                  const laneLabel = usageLaneLabels[item.lane];
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">
                            {initials(item.user.name, item.user.email)}
                          </span>
                          <span>
                            <span className="user-name">
                              {item.user.name || 'Unnamed user'}
                            </span>
                            <span className="user-email">{item.user.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="activity-cell">
                          <span className={`activity-icon activity-icon--${item.lane}`}>
                            {item.lane === 'responses'
                              ? '↗'
                              : item.lane === 'speech'
                                ? '◖'
                                : '⌁'}
                          </span>
                          <span>
                            <span className="activity-name">
                              {item.activityTitle || laneLabel}
                            </span>
                            <span className="activity-meta">
                              {item.activityTitle ? `${laneLabel} · ` : ''}
                              Task {shortIdentifier(item.taskId)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td><code className="model-name">{item.model}</code></td>
                      <td>
                        <span className="usage-metric">
                          <span className="usage-metric__primary">{metric.primary}</span>
                          <span className="usage-metric__detail">{metric.detail}</span>
                        </span>
                      </td>
                      <td>
                        <span className="cost-value">
                          <span className="cost-value__amount">
                            {moneyLabel(item.amountMicroUsd)}
                          </span>
                          <span className="cost-value__source">{item.usageSource}</span>
                        </span>
                      </td>
                      <td className="usage-time">{dateTimeLabel(item.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && (
            <EmptyState
              detail="Try a wider date range or different filters."
              icon="◔"
              title="No usage found"
            />
          )
        )}
        <div className="table-footer">
          <span>
            {response.items.length
              ? `Showing 1–${response.items.length} of ${response.page.total}`
              : 'No activity to show'}
          </span>
          {response.items.length < response.page.total && (
            <button
              className="button button--secondary"
              disabled={loading}
              onClick={() => void loadUsage(true)}
              type="button"
            >
              Load more
            </button>
          )}
        </div>
      </section>
    </section>
  );
}
