import { useQuery } from '@tanstack/react-query';
import { Table, Typography } from 'antd';
import { api, type AuditLogRow } from '../api';
import { formatDateTime } from '../dates';
import { keys } from '../queries';

const ENTITY_LABELS: Record<string, string> = {
  duty: '班表',
  order: '訂單',
  leg: '路段',
  location: '據點',
  setting: '設定',
  driver: '司機',
  vehicle: '車輛',
  system: '系統',
};

export function AuditPage() {
  const logs = useQuery({ queryKey: keys.audit, queryFn: () => api.auditLogs({ limit: 500 }) });
  return (
    <>
      <Typography.Title level={4}>操作紀錄</Typography.Title>
      <Table<AuditLogRow>
        rowKey="id"
        size="small"
        loading={logs.isLoading}
        dataSource={logs.data ?? []}
        pagination={{ pageSize: 50 }}
        columns={[
          { title: '時間', dataIndex: 'at', render: (v: string) => formatDateTime(v), width: 170 },
          {
            title: '類別',
            dataIndex: 'entityType',
            render: (v: string) => ENTITY_LABELS[v] ?? v,
            width: 80,
            filters: Object.entries(ENTITY_LABELS).map(([value, text]) => ({ value, text })),
            onFilter: (v, r) => r.entityType === v,
          },
          { title: '內容', dataIndex: 'summary' },
          {
            title: '警告原因',
            dataIndex: 'reason',
            render: (v: string | null, r) => {
              const warnings = (r.detail as { warnings?: string[] } | null)?.warnings;
              if (!v && !warnings?.length) return null;
              return (
                <>
                  {warnings?.map((w, i) => (
                    <div key={i} style={{ color: '#b35c00', fontSize: 12 }}>
                      ● {w}
                    </div>
                  ))}
                  {v && <div>原因：{v}</div>}
                </>
              );
            },
          },
        ]}
      />
    </>
  );
}
