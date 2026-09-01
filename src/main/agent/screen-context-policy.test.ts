import { describe, expect, it } from 'vitest';

import {
  requestReferencesVisibleContext,
  shouldObserveInitialScreenContext,
} from './screen-context-policy';

describe('initial screen context policy', () => {
  it.each([
    'Help me work on this assignment.',
    'Làm sao làm bài tập Scratch này?',
    'Explain what is currently visible.',
    'Giải thích nội dung trên màn hình.',
  ])('recognizes visible-context references: %s', (request) => {
    expect(requestReferencesVisibleContext(request)).toBe(true);
    expect(shouldObserveInitialScreenContext(request)).toBe(true);
  });

  it.each([
    'Create me a simple sheet for tracking money.',
    'Fill in this form with my details.',
    'Đúng rồi, đang mở Google Sheets nè, tạo trên Google Sheets.',
  ])('captures visible application work: %s', (request) => {
    expect(shouldObserveInitialScreenContext(request)).toBe(true);
  });

  it.each([
    'What is a spreadsheet?',
    'Explain how Google Sheets formulas work.',
    'Open Gmail and read the latest email.',
    'Create a list of vegetables.',
    'Write an email draft for my manager.',
  ])('keeps self-contained or navigation-first work on the text path: %s', (request) => {
    expect(shouldObserveInitialScreenContext(request)).toBe(false);
  });
});
