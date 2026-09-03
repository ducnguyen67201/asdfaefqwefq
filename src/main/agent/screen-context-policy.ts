const VISIBLE_CONTEXT_PHRASES = [
  'on screen',
  'on the screen',
  'on my screen',
  'currently visible',
  'currently open',
  'in front of me',
  'trên màn hình',
  'đang hiển thị',
  'đang mở',
  'trước mặt',
] as const;

const VISUAL_ACTION_PATTERN =
  /\b(?:add|change|create|edit|enter|fill|format|make|select|type|update)\b|(?:^|\s)(?:chọn|điền|định dạng|nhập|sửa|tạo)(?:$|[\s.,!?;:])/u;
const VISUAL_ARTIFACT_PATTERN =
  /\b(?:document|email|form|google\s+sheets?|message|presentation|sheets?|slides?|spreadsheet|table|workbook|worksheet)\b|(?:^|\s)(?:bảng tính|biểu mẫu|tin nhắn|tài liệu|trang tính|trình chiếu)(?:$|[\s.,!?;:])/u;
const NAVIGATION_FIRST_PATTERN =
  /^\s*(?:go\s+to|launch|navigate\s+to|open)\b|^\s*(?:mở|truy cập)(?:$|\s)/u;

function normalizeRequest(request: string): string {
  return request.normalize('NFKC').toLocaleLowerCase();
}

export function requestReferencesVisibleContext(request: string): boolean {
  const normalized = normalizeRequest(request);
  if (VISIBLE_CONTEXT_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  return (
    /\b(?:this|that|these|those)\b/u.test(normalized) ||
    /(?:^|\s)(?:này|đó|kia)(?:$|[\s.,!?;:])/u.test(normalized)
  );
}

/** Selects tasks whose first model turn must be grounded in the current screen. */
export function shouldObserveInitialScreenContext(
  request: string,
  preference: 'auto' | 'required' | 'disabled' = 'auto',
): boolean {
  if (preference === 'disabled') return false;
  if (preference === 'required') return true;
  if (requestReferencesVisibleContext(request)) return true;
  const normalized = normalizeRequest(request);
  if (NAVIGATION_FIRST_PATTERN.test(normalized)) return false;
  return (
    VISUAL_ACTION_PATTERN.test(normalized) &&
    VISUAL_ARTIFACT_PATTERN.test(normalized)
  );
}
