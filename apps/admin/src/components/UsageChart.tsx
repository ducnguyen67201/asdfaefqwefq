import type { ReactNode } from 'react';

import type { UsageResponse } from '../api/contracts';
import {
  chartDateLabel,
  chartMoneyLabel,
  compactNumber,
  moneyLabel,
} from '../lib/formatters';

interface UsageChartProps {
  controls: ReactNode;
  laneLabel: string;
  loading: boolean;
  rangeLabel: string;
  series: UsageResponse['series'];
  summary: UsageResponse['summary'];
}

const WIDTH = 960;
const HEIGHT = 260;
const PADDING = { bottom: 36, left: 58, right: 18, top: 18 };

export function UsageChart({
  controls,
  laneLabel,
  loading,
  rangeLabel,
  series,
  summary,
}: UsageChartProps) {
  const { granularity, items } = series;
  const summaryLabel = `${rangeLabel} · ${laneLabel} · ${compactNumber(summary.totalRequests)} model call${summary.totalRequests === 1 ? '' : 's'}`;
  const accessibleLabel = `Usage graph for ${rangeLabel}. ${moneyLabel(summary.totalSpendMicroUsd)} spent across ${summary.totalRequests} model calls.`;

  if (!items.length || summary.totalRequests === 0) {
    return (
      <section className="usage-chart-card" aria-labelledby="usage-chart-title">
        <ChartHeader
          controls={controls}
          summaryLabel={summaryLabel}
          totalSpend={summary.totalSpendMicroUsd}
        />
        <div
          aria-label={accessibleLabel}
          aria-live="polite"
          className={`usage-chart${loading ? ' usage-chart--loading' : ''}`}
          role="group"
        >
          <div className="usage-chart-empty">
            No usage to graph for these filters.
          </div>
        </div>
      </section>
    );
  }

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const bottom = PADDING.top + plotHeight;
  const maximumSpend = Math.max(...items.map((item) => item.spendMicroUsd), 1);
  const yMaximum = Math.ceil(maximumSpend * 1.12);
  const points = items.map((item, index) => ({
    item,
    x:
      items.length === 1
        ? PADDING.left + plotWidth / 2
        : PADDING.left + (index / (items.length - 1)) * plotWidth,
    y: bottom - (item.spendMicroUsd / yMaximum) * plotHeight,
  }));
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath =
    points.length > 1 && firstPoint && lastPoint
      ? [
          `M ${firstPoint.x} ${bottom}`,
          ...points.map((point) => `L ${point.x} ${point.y}`),
          `L ${lastPoint.x} ${bottom}`,
          'Z',
        ].join(' ')
      : '';
  const labelCount = Math.min(6, items.length);
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, index) =>
      Math.round((index / Math.max(1, labelCount - 1)) * (items.length - 1)),
    ),
  );

  return (
    <section className="usage-chart-card" aria-labelledby="usage-chart-title">
      <ChartHeader
        controls={controls}
        summaryLabel={summaryLabel}
        totalSpend={summary.totalSpendMicroUsd}
      />
      <div
        aria-label={accessibleLabel}
        aria-live="polite"
        className={`usage-chart${loading ? ' usage-chart--loading' : ''}`}
        role="group"
      >
        <svg aria-label={`Spend over time, grouped by ${granularity}.`} role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <defs>
            <linearGradient id="usage-chart-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#8fc58f" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#8fc58f" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {Array.from({ length: 5 }, (_, index) => {
            const y = PADDING.top + (index / 4) * plotHeight;
            const value = yMaximum * (1 - index / 4);
            return (
              <g key={index}>
                <line
                  className="chart-grid-line"
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                />
                <text
                  className="chart-axis-label"
                  textAnchor="end"
                  x={PADDING.left - 10}
                  y={y + 4}
                >
                  {chartMoneyLabel(value)}
                </text>
              </g>
            );
          })}
          {areaPath && <path className="chart-area" d={areaPath} />}
          <path className="chart-line" d={linePath} />
          {points.map((point) => (
            <circle
              className="chart-point"
              cx={point.x}
              cy={point.y}
              key={point.item.startedAt}
              r="5"
            >
              <title>
                {`${chartDateLabel(point.item.startedAt, granularity)}: ${moneyLabel(point.item.spendMicroUsd)}, ${point.item.requests} call${point.item.requests === 1 ? '' : 's'}, ${compactNumber(point.item.tokens)} tokens`}
              </title>
            </circle>
          ))}
          {[...labelIndexes].map((index) => {
            const point = points[index];
            if (!point) return null;
            return (
              <text
                className="chart-axis-label"
                key={point.item.startedAt}
                textAnchor={
                  index === 0
                    ? 'start'
                    : index === items.length - 1
                      ? 'end'
                      : 'middle'
                }
                x={point.x}
                y={HEIGHT - 10}
              >
                {chartDateLabel(point.item.startedAt, granularity)}
              </text>
            );
          })}
        </svg>
        <div className="sr-only">
          {items
            .map(
              (item) =>
                `${chartDateLabel(item.startedAt, granularity)}: ${moneyLabel(item.spendMicroUsd)}, ${item.requests} calls.`,
            )
            .join(' ')}
        </div>
      </div>
    </section>
  );
}

interface ChartHeaderProps {
  controls: ReactNode;
  summaryLabel: string;
  totalSpend: number;
}

function ChartHeader({ controls, summaryLabel, totalSpend }: ChartHeaderProps) {
  return (
    <>
      <div className="usage-chart-header">
        <div>
          <h2 id="usage-chart-title">Usage over time</h2>
          <p>{summaryLabel}</p>
        </div>
        {controls}
      </div>
      <div className="usage-chart-legend" aria-hidden="true">
        <span>
          <i /> Spend
        </span>
        <strong>{moneyLabel(totalSpend)}</strong>
      </div>
    </>
  );
}
