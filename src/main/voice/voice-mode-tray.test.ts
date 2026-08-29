import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceModeTrayImage,
  synchronizeVoiceModeTray,
  voiceModeTrayVisual,
} from './voice-mode-tray';

describe('voice mode tray presentation', () => {
  it('maps Write my words to teal and Ask Tro to gold with text cues', () => {
    expect(voiceModeTrayVisual('dictation')).toMatchObject({
      accent: '#32c7c7',
      tooltip: 'Tro — Write my words',
    });
    expect(voiceModeTrayVisual('task')).toMatchObject({
      accent: '#f2c94c',
      tooltip: 'Tro — Ask Tro',
    });
  });

  it('builds distinct 36px PNGs as 18px high-density tray images', () => {
    const dictationImage = { kind: 'dictation-tray-image' };
    const taskImage = { kind: 'task-tray-image' };
    const createFromBuffer = vi.fn(
      (buffer: Buffer, options: { scaleFactor: number }) => {
        void buffer;
        void options;
        return createFromBuffer.mock.calls.length === 1
          ? dictationImage
          : taskImage;
      },
    );

    expect(
      createVoiceModeTrayImage({ createFromBuffer }, 'dictation'),
    ).toBe(dictationImage);
    expect(createVoiceModeTrayImage({ createFromBuffer }, 'task')).toBe(
      taskImage,
    );

    const [dictationPng, dictationOptions] =
      createFromBuffer.mock.calls[0] ?? [];
    const [taskPng, taskOptions] = createFromBuffer.mock.calls[1] ?? [];
    for (const png of [dictationPng, taskPng]) {
      expect(png?.subarray(1, 4).toString()).toBe('PNG');
      expect(png?.readUInt32BE(16)).toBe(36);
      expect(png?.readUInt32BE(20)).toBe(36);
    }
    expect(dictationPng?.equals(taskPng ?? Buffer.alloc(0))).toBe(false);
    expect(dictationOptions).toEqual({ scaleFactor: 2 });
    expect(taskOptions).toEqual({ scaleFactor: 2 });
  });

  it('updates both the image and non-color tooltip', () => {
    const image = { kind: 'task-image' };
    const tray = { setImage: vi.fn(), setToolTip: vi.fn() };
    const imageFactory = { createFromBuffer: vi.fn(() => image) };

    synchronizeVoiceModeTray(tray, imageFactory, 'task');

    expect(tray.setImage).toHaveBeenCalledWith(image);
    expect(tray.setToolTip).toHaveBeenCalledWith('Tro — Ask Tro');
  });
});
