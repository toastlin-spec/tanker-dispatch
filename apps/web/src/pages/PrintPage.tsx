import { DownloadOutlined, LeftOutlined, PrinterOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { addDays, formatDateShort } from '@tanker/core';
import { Alert, App, Button, DatePicker, Empty, Space, Spin, Typography } from 'antd';
import { toBlob } from 'html-to-image';
import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type PublishedSheet } from '../api';
import { formatDateTime, fromDayjs, toDayjs, todayTaipei } from '../dates';
import { keys } from '../queries';

function Sheet({ item }: { item: PublishedSheet }) {
  const ref = useRef<HTMLDivElement>(null);
  const { message } = App.useApp();
  const s = item.sheet;
  const saveImage = async () => {
    if (!ref.current) return;
    try {
      const node = ref.current;
      const blob = await toBlob(node, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        width: node.offsetWidth,
        height: node.offsetHeight,
        style: { margin: '0' },
        filter: (el) => !(el instanceof HTMLElement && el.classList.contains('no-print')),
      });
      if (!blob) throw new Error('empty image');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `派車單-${s.date}-${s.driverName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message.error('存成圖片失敗，請改用列印');
    }
  };
  return (
    <div className="sheet" ref={ref} data-testid={`sheet-${item.dutyId}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>派車單</h2>
        <Button size="small" className="no-print" icon={<DownloadOutlined />} onClick={saveImage}>
          存成圖片
        </Button>
      </div>
      <div className="info">
        <div>日期：<b>{formatDateShort(s.date)}</b></div>
        <div>司機：<b>{s.driverName}</b></div>
        <div>班別：{s.shiftLabel}</div>
        <div>出發廠：{s.depotName}</div>
        <div>車輛：{s.vehicle?.name ?? '—'}</div>
        <div>車頭：{s.vehicle?.tractorPlate ?? '—'}</div>
        <div>油槽：{s.vehicle?.trailerPlate ?? '—'}</div>
        <div>艙位：{s.vehicle ? `${s.vehicle.compartmentsKL.join(' + ')} KL` : '—'}</div>
        <div>出車：<b>{s.start}</b></div>
        <div>收車：<b>{s.end ?? '無法計算'}</b></div>
        <div>單數：{s.tripCount} 單（趟）</div>
        <div>總量：{s.totalKL} KL</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 120 }}>時間</th>
            <th style={{ width: 60 }}>動作</th>
            <th>地點</th>
            <th>油品與數量</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i}>
              <td>{r.start}–{r.end}</td>
              <td>{r.kindLabel}</td>
              <td>{r.place}</td>
              <td>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 70 }}>車趟</th>
            <th style={{ width: 90 }}>灌油點</th>
            <th>艙位裝載</th>
          </tr>
        </thead>
        <tbody>
          {s.trips.map((t) => (
            <tr key={t.index}>
              <td>第 {t.index + 1} 趟</td>
              <td>{t.loadingName}</td>
              <td>{t.compartments.map((c) => `第 ${c.compartment} 艙：${c.product} ${c.quantityKL}KL → ${c.stationName}`).join('；')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(item.warnings?.length > 0 || item.reason) && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          {item.warnings.map((w, i) => (
            <div key={i}>⚠ {w.message}</div>
          ))}
          {item.reason && <div>發布原因：{item.reason}</div>}
        </div>
      )}
      <div className="sign">
        <span>
          發布：{formatDateTime(item.publishedAt)}
          {item.publishedBy && `（${item.publishedBy.name ?? item.publishedBy.email}）`}
        </span>
        <span>調度員：＿＿＿＿＿＿</span>
        <span>司機簽名：＿＿＿＿＿＿</span>
      </div>
    </div>
  );
}

export function PrintPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayTaipei();
  const sheets = useQuery({ queryKey: keys.sheets(date), queryFn: () => api.dispatchSheets(date) });
  const setDate = (d: string) => setParams({ date: d });
  return (
    <>
      <div className="page-toolbar no-print">
        <Typography.Title level={4} style={{ margin: 0 }}>
          派車單
        </Typography.Title>
        <Space.Compact>
          <Button icon={<LeftOutlined />} onClick={() => setDate(addDays(date, -1))} aria-label="前一天" />
          <DatePicker value={toDayjs(date)} onChange={(d) => d && setDate(fromDayjs(d))} allowClear={false} />
          <Button icon={<RightOutlined />} onClick={() => setDate(addDays(date, 1))} aria-label="後一天" />
        </Space.Compact>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!sheets.data?.sheets.length}>
          列印全部
        </Button>
        <Link to={`/?date=${date}`}>回調度看板</Link>
      </div>
      {sheets.isLoading && <Spin />}
      {sheets.error && <Alert type="error" showIcon message={(sheets.error as Error).message} />}
      {sheets.data && sheets.data.unpublished.length > 0 && (
        <Alert
          className="no-print"
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`尚未發布：${sheets.data.unpublished.map((u) => u.driverName).join('、')}。發布後才會出現在這裡。`}
        />
      )}
      {sheets.data && sheets.data.sheets.length === 0 && <Empty description={`${formatDateShort(date)} 沒有已發布的班表`} />}
      {sheets.data?.sheets.map((item) => <Sheet key={item.dutyId} item={item} />)}
    </>
  );
}
