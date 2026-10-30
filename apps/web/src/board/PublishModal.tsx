import { checkPublish, type DutyEvaluation, type Issue } from '@tanker/core';
import { Alert, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { IssueList } from '../components/IssueList';

export function PublishModal(props: {
  open: boolean;
  title: string;
  evaluation: DutyEvaluation | null;
  serverIssues?: Issue[];
  serverError?: string | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (props.open) setReason('');
  }, [props.open]);
  if (!props.evaluation) return null;
  const check = checkPublish(props.evaluation);
  const needReason = check.needsReason && reason.trim().length === 0;
  return (
    <Modal
      open={props.open}
      title={props.title}
      okText="確認發布"
      cancelText="取消"
      onCancel={props.onCancel}
      onOk={() => props.onConfirm(reason.trim())}
      okButtonProps={{ disabled: !check.canPublish || needReason, loading: props.loading }}
      width={560}
    >
      {props.serverError && <Alert type="error" showIcon message={props.serverError} style={{ marginBottom: 12 }} />}
      {props.serverIssues && props.serverIssues.length > 0 && <IssueList issues={props.serverIssues} />}
      {!check.canPublish ? (
        <>
          <Alert type="error" showIcon message="有阻擋的規則沒有通過，不能發布" style={{ marginBottom: 12 }} />
          <IssueList issues={check.blocking} />
        </>
      ) : check.needsReason ? (
        <>
          <Alert type="warning" showIcon message="班表有警告，請填寫原因才能發布；原因會存入操作紀錄。" style={{ marginBottom: 12 }} />
          <IssueList issues={check.warnings} />
          <Typography.Text strong>發布原因</Typography.Text>
          <Input.TextArea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：今天訂單較多，已與司機確認"
            maxLength={1000}
            data-testid="publish-reason"
          />
        </>
      ) : (
        <Alert type="success" showIcon message="全部規則通過。發布後會產生派車單。" />
      )}
    </Modal>
  );
}
