import { ISSUE_LEVEL_LABELS, RULE_LABELS, type Issue, type RuleKey } from '@tanker/core';
import { Empty, List, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

const LEVEL_COLORS = { block: 'red', warn: 'orange', info: 'blue' } as const;

const OTHER_LABELS: Record<string, string> = { loading: '裝載限制', orderWindow: '希望到達時段', data: '資料' };

export function ruleLabel(rule: Issue['rule']) {
  return RULE_LABELS[rule as RuleKey] ?? OTHER_LABELS[rule] ?? rule;
}

export function legLink(leg: { fromId: string; toId: string }) {
  return `/settings?tab=legs&from=${encodeURIComponent(leg.fromId)}&to=${encodeURIComponent(leg.toId)}`;
}

export function IssueList({ issues, showInfo = true }: { issues: Issue[]; showInfo?: boolean }) {
  const shown = showInfo ? issues : issues.filter((i) => i.level !== 'info');
  if (shown.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="全部規則通過" />;
  return (
    <List
      size="small"
      dataSource={shown}
      renderItem={(issue) => (
        <List.Item style={{ display: 'block' }}>
          <Space size={4} wrap>
            <Tag color={LEVEL_COLORS[issue.level]}>{ISSUE_LEVEL_LABELS[issue.level]}</Tag>
            <Typography.Text type="secondary">{ruleLabel(issue.rule)}</Typography.Text>
          </Space>
          <div>{issue.message}</div>
          {issue.suggestion && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              建議：{issue.suggestion}
            </Typography.Text>
          )}
          {issue.leg && (
            <div>
              <Link to={legLink(issue.leg)}>到設定頁補上這個路段 →</Link>
            </div>
          )}
        </List.Item>
      )}
    />
  );
}
