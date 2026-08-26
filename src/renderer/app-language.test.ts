import { describe, expect, it } from 'vitest';

import { AppLanguageSchema } from '../shared/contracts';

import {
  APP_LANGUAGE_OPTIONS,
  appLanguageLabel,
  appLocale,
  translate,
} from './app-language';

describe('app language', () => {
  it('only exposes interface languages supported by the shared contract', () => {
    expect(
      APP_LANGUAGE_OPTIONS.every(
        (option) => AppLanguageSchema.safeParse(option.code).success,
      ),
    ).toBe(true);
  });

  it('provides native labels and locales', () => {
    expect(appLanguageLabel('en')).toBe('English');
    expect(appLanguageLabel('vi')).toBe('Tiếng Việt');
    expect(appLocale('vi')).toBe('vi-VN');
  });

  it('translates known interface copy and interpolates values', () => {
    expect(translate('vi', 'Settings')).toBe('Cài đặt');
    expect(translate('vi', 'Version {version}', { version: '0.2.0' })).toBe(
      'Phiên bản 0.2.0',
    );
    expect(translate('en', 'Settings')).toBe('Settings');
    expect(
      translate(
        'vi',
        'Your instruction authorizes requested reversible work; Tro still asks for high-impact or expanded-scope actions.',
      ),
    ).not.toContain('Your instruction');
    expect(
      translate('vi', 'Strict mode asks before every mutation or side effect.'),
    ).not.toContain('Strict mode');
  });

  it('translates companion customization states without English fallback', () => {
    const messages = [
      'Custom companion',
      'Generate preview',
      'Use this companion',
      'Use default companion',
      'Monthly limit reached',
      'Generating… this can take up to 2 minutes',
      'Drop, paste, or click to choose',
      'Describe the vibe',
      'Add an image to continue',
      'Private by design',
      'Meet your new companion',
      'Your source image and prompt are sent to OpenAI only for this generation; Tro does not save them. A companion you activate stays encrypted on this device. OpenAI may retain images flagged for child-safety review. An uncertain provider outcome may use one monthly slot, and Tro will not retry it automatically.',
    ];

    for (const message of messages) {
      expect(translate('vi', message)).not.toBe(message);
    }
    expect(
      translate('vi', '{remaining} of {limit} left this month', {
        limit: 5,
        remaining: 3,
      }),
    ).toBe('Còn 3 trên 5 trong tháng này');
  });

  it('translates the role-aware live classroom flow', () => {
    expect(translate('vi', 'Join your class')).toBe('Tham gia lớp học');
    expect(translate('vi', 'Broadcast to class')).toBe('Gửi cho cả lớp');
    expect(translate('vi', 'Ready for review')).toBe('Sẵn sàng để xem xét');
    expect(translate('vi', 'Confirm Complete')).toBe('Xác nhận hoàn tất');
    expect(
      translate('vi', '{count} students in the lobby', { count: 24 }),
    ).toBe('24 học sinh trong phòng chờ');
    expect(
      translate(
        'vi',
        ' Join, Help, Check, submission, and review events only. No continuous cursor, typing, or screen monitoring.',
      ),
    ).not.toContain('continuous cursor');
  });

  it('translates organization settings and seat onboarding copy', () => {
    expect(translate('vi', 'Organization settings')).toBe('Cài đặt tổ chức');
    expect(translate('vi', 'Member')).toBe('Thành viên');
    expect(translate('vi', 'Invite a student or staff member')).toBe(
      'Mời học sinh hoặc nhân viên',
    );
    expect(
      translate('vi', '{assigned} of {maximum}', {
        assigned: 4,
        maximum: 25,
      }),
    ).toBe('4 trên 25');
    expect(translate('vi', 'Open Class workspaces')).toBe(
      'Mở Không gian lớp học',
    );
  });
});
