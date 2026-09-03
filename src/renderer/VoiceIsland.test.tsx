import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VoiceIslandContent } from './VoiceIsland';

describe('VoiceIslandContent', () => {
  it('identifies Dictation by label, destination, icon, and mode class', () => {
    const markup = renderToStaticMarkup(
      <VoiceIslandContent
        activity={{
          appLanguage: 'en',
          destination: { kind: 'application', label: 'Notes' },
          mode: 'dictation',
          phase: 'listening',
          transcript: 'Private words',
        }}
      />,
    );
    expect(markup).toContain('voice-island--dictation');
    expect(markup).toContain('Dictating');
    expect(markup).toContain('To Notes');
    expect(markup).toContain('role="status"');
  });

  it('identifies Task without relying on the yellow mode color', () => {
    const markup = renderToStaticMarkup(
      <VoiceIslandContent
        activity={{
          appLanguage: 'en',
          destination: { kind: 'task', label: 'Tro task' },
          mode: 'task',
          phase: 'listening',
          transcript: '',
        }}
      />,
    );
    expect(markup).toContain('voice-island--task');
    expect(markup).toContain('Giving Tro a task');
    expect(markup).toContain('To Tro task');
  });

  it('uses an alert for failures and omits sensitive transcript text', () => {
    const markup = renderToStaticMarkup(
      <VoiceIslandContent
        activity={{
          appLanguage: 'en',
          destination: { kind: 'application', label: 'Editor' },
          message: 'Text kept in your Tro draft.',
          mode: 'dictation',
          phase: 'error',
          transcript: 'do not render me',
        }}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Text kept in your Tro draft.');
    expect(markup).not.toContain('do not render me');
  });

  it('confirms the selected mode without showing a listening meter', () => {
    const markup = renderToStaticMarkup(
      <VoiceIslandContent
        activity={{
          appLanguage: 'en',
          destination: { kind: 'task', label: 'Tro task' },
          mode: 'task',
          phase: 'mode_selected',
          transcript: '',
        }}
      />,
    );

    expect(markup).toContain('voice-island--mode_selected');
    expect(markup).toContain('Ask Tro selected');
    expect(markup).toContain('Ready for your next voice shortcut.');
    expect(markup).not.toContain('voice-island__meter');
  });

  it('keeps the accepted Task transcript visible during the agent handoff', () => {
    const markup = renderToStaticMarkup(
      <VoiceIslandContent
        activity={{
          appLanguage: 'en',
          destination: { kind: 'task', label: 'Tro task' },
          mode: 'task',
          phase: 'complete',
          transcript: 'Show me how to finish this Scratch task.',
        }}
      />,
    );

    expect(markup).toContain('Voice Task sent');
    expect(markup).toContain('Show me how to finish this Scratch task.');
    expect(markup).not.toContain('voice-island__meter');
  });
});
