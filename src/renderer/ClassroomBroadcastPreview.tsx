import { useEffect, useState } from 'react';

import type {
  AppLanguage,
  BroadcastDraftProjection,
  ClassroomBroadcastDraft,
} from '../shared/contracts';
export function ClassroomBroadcastPreview({
  taskId,
  appLanguage,
}: {
  taskId: string | null;
  appLanguage: AppLanguage;
}) {
  const [projection, setProjection] = useState<BroadcastDraftProjection | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vi = appLanguage === 'vi';
  useEffect(() => {
    if (!taskId || !window.tro.onClassroomBroadcastDraftsChanged) return;
    let active = true;
    const apply = (next: BroadcastDraftProjection) => {
      if (active && next.taskId === taskId)
        setProjection((current) =>
          !current || current.taskId!==next.taskId || next.revision > current.revision ? next : current,
        );
    };
    const stop = window.tro.onClassroomBroadcastDraftsChanged(apply);
    void window.tro
      .getClassroomBroadcastDrafts({ taskId })
      .then(apply)
      .catch(() => undefined);
    return () => {
      active = false;
      stop();
    };
  }, [taskId]);
  const act = async (
    draft: ClassroomBroadcastDraft,
    action: 'confirm' | 'cancel' | 'reconcile',
  ) => {
    if (busy) return;
    setBusy(draft.draftId);
    setError(null);
    try {
      const input = {
        taskId: draft.taskId,
        draftId: draft.draftId,
        revision: draft.revision,
      };
      if (action === 'confirm')
        await window.tro.confirmClassroomBroadcast(input);
      else if (action === 'cancel')
        await window.tro.cancelClassroomBroadcast(input);
      else await window.tro.reconcileClassroomBroadcast(input);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Broadcast unavailable.',
      );
    } finally {
      setBusy(null);
    }
  };
  const visible =
    (projection?.taskId===taskId ? projection : null)?.drafts.filter(
      (d) => !['cancelled', 'stale', 'expired'].includes(d.state),
    ) ?? [];
  if (!visible.length) return null;
  return (
    <section
      className="classroom-broadcast-cards"
      aria-label={vi ? 'Bản xem trước gửi đến lớp' : 'Class broadcast previews'}
    >
      {visible.map((draft) => (
        <article className="classroom-broadcast-card" key={draft.draftId}>
          <p className="eyebrow">
            {draft.binding.spaceName} · {draft.binding.sessionTitle}
          </p>
          <h3>
            {draft.payload.kind === 'assignment'
              ? `${vi ? 'Bài tập' : 'Assignment'} ${draft.payload.number} — ${draft.payload.title}`
              : vi
                ? 'Chỉ dẫn cho lớp'
                : 'Class instruction'}
          </h3>
          <p className="classroom-broadcast-copy">
            {draft.payload.instruction}
          </p>
          {draft.payload.kind === 'open_url' && <p>{draft.payload.url}</p>}
          <p>
            {vi
              ? 'Dành cho học sinh đã tham gia phiên học này, kể cả người tham gia sau khi gửi.'
              : 'For students joined to this session, including later joiners while the class is live.'}
          </p>
          {draft.payload.kind === 'assignment' &&
            draft.payload.studentAction === 'explain' && (
              <p>
                {vi
                  ? 'Mỗi học sinh bắt đầu phần giải thích riêng, dùng bài tập và màn hình của mình.'
                  : 'Request an individual explanation using each student’s assignment and own screen. Students start it unless they opted in for this session.'}
              </p>
            )}
          <small>
            {vi
              ? 'Giáo viên và học sinh cần phiên bản Tro hỗ trợ tính năng này.'
              : 'Teacher and students need a compatible Tro build.'}
          </small>
          <p role="status">
            {draft.state === 'sent'
              ? vi
                ? 'Đã lưu thông báo lớp.'
                : 'Broadcast saved.'
              : draft.state === 'prepared'
                ? vi
                  ? 'Sẵn sàng để bạn duyệt và gửi.'
                  : 'Ready for your review.'
                : draft.state === 'sending'
                  ? vi
                    ? 'Đang lưu; không gửi lại.'
                    : 'Saving; do not send another copy.'
                  : (draft.error ?? draft.state)}
          </p>
          <div className="classroom-broadcast-actions">
            {draft.state === 'prepared' && (
              <>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void act(draft, 'cancel')}
                  type="button"
                >
                  {vi ? 'Hủy' : 'Cancel'}
                </button>
                <button
                  className="primary-button"
                  disabled={Boolean(busy)}
                  onClick={() => void act(draft, 'confirm')}
                  type="button"
                >
                  {vi ? 'Gửi đến lớp' : 'Broadcast to class'}
                </button>
              </>
            )}
            {['sending', 'unknown'].includes(draft.state) && (
              <button
                disabled={Boolean(busy)}
                onClick={() => void act(draft, 'reconcile')}
                type="button"
              >
                {vi ? 'Kiểm tra trạng thái lưu' : 'Check save receipt'}
              </button>
            )}
          </div>
          {draft.state === 'sent' &&
            draft.payload.kind === 'assignment' &&
            draft.payload.studentAction === 'explain' && (
              <ExplanationSummary draft={draft} vi={vi} />
            )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function ExplanationSummary({
  draft,
  vi,
}: {
  draft: ClassroomBroadcastDraft;
  vi: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (!draft.receipt) return;
          void window.tro
            .getClassroomGuidanceSummary({
              spaceId: draft.binding.spaceId,
              sessionId: draft.binding.sessionId,
              broadcastId: draft.receipt.broadcast.id,
            })
            .then((result) =>
              setText(
                Object.entries(result.counts)
                  .map(([key, count]) => `${key}: ${count}`)
                  .join(' · '),
              ),
            )
            .catch(() =>
              setText(
                vi ? 'Chưa tải được trạng thái.' : 'Status is unavailable.',
              ),
            );
        }}
      >
        {vi ? 'Xem hoạt động giải thích' : 'View explanation activity'}
      </button>
      {text && (
        <p role="status">
          {text}
          <br />
          {vi
            ? 'Đây là trạng thái phần giải thích, không phải kết quả học tập.'
            : 'Explanation activity; these counts do not measure delivery or assignment completion.'}
        </p>
      )}
    </div>
  );
}
