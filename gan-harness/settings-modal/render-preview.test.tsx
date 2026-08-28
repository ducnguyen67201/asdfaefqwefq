import { readFileSync, writeFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '../../src/renderer/SettingsPage';
import type { CompanionCustomizationStatus } from '../../src/shared/contracts';

const companionStatus: CompanionCustomizationStatus = {
  appearance: { kind: 'default' },
  candidate: null,
  quota: {
    limit: 5,
    periodEndsAt: '2026-09-01T00:00:00.000Z',
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    remaining: 3,
    used: 2,
  },
  savedCompanions: [],
  state: 'available',
  summary: 'Companion generation is available.',
};

function navigationIcon(
  name: 'agent' | 'history' | 'insights' | 'settings',
): string {
  const paths = {
    agent:
      '<path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z"/><path d="M8.5 12h7M12 8.5v7"/>',
    history:
      '<path d="M4.5 6.5h10M4.5 12h7M4.5 17.5h5"/><path d="M18.5 10v4.5l2.5 1.5"/><circle cx="18.5" cy="14.5" r="4"/>',
    insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7.4 7.4 0 0 0 .1-1Z"/>',
  } as const;

  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]}</svg>`;
}

function previewAppShell(brandMarkDataUrl: string): string {
  return `<main class="app-shell preview-app-shell" aria-hidden="true">
    <aside class="sidebar" id="primary-sidebar">
      <div class="preview-window-controls" aria-hidden="true">
        <i class="preview-window-control preview-window-control--close"></i>
        <i class="preview-window-control preview-window-control--minimize"></i>
        <i class="preview-window-control preview-window-control--zoom"></i>
      </div>
      <div class="sidebar-chrome">
        <button aria-label="Collapse sidebar" class="sidebar-toggle" type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="4"/><path d="M9 4v16"/></svg>
        </button>
      </div>
      <div class="brand">
        <img alt="" aria-hidden="true" class="brand-mark" draggable="false" src="${brandMarkDataUrl}" />
        <div class="brand-copy"><strong>Tro Free</strong><span>Weekly usage · 100% left</span></div>
      </div>
      <button aria-label="New task" class="new-task-button" type="button">
        <span aria-hidden="true">＋</span><span class="sidebar-item-label">New task</span>
      </button>
      <nav aria-label="Workspace">
        <span class="nav-label">Workspace</span>
        <button aria-label="Agent" aria-current="page" class="nav-item nav-item--active" type="button">
          ${navigationIcon('agent')}<span class="sidebar-item-label">Agent</span>
        </button>
        <button aria-label="History" class="nav-item" type="button">
          ${navigationIcon('history')}<span class="sidebar-item-label">History</span><span class="nav-count">0</span>
        </button>
        <button aria-label="Insights" class="nav-item" type="button">
          ${navigationIcon('insights')}<span class="sidebar-item-label">Insights</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <nav aria-label="Settings">
          <button aria-label="Settings" aria-expanded="true" aria-haspopup="dialog" class="nav-item nav-item--active" type="button">
            ${navigationIcon('settings')}<span class="sidebar-item-label">Settings</span>
          </button>
        </nav>
        <div class="sidebar-footer">
          <span class="safety-indicator" aria-hidden="true"></span>
          <div><strong>Bounded by default</strong><span>Approval gates enabled</span></div>
        </div>
        <div class="sidebar-account" title="alex@tro.app">
          <span class="account-avatar" aria-hidden="true">A</span>
          <span class="sidebar-account__identity"><strong>Alex Morgan</strong><span>alex@tro.app</span></span>
          <button aria-label="Sign out" class="sidebar-account__sign-out" title="Sign out" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10"/><path d="M14.5 8.5 18 12l-3.5 3.5M18 12H9"/></svg><span>Sign out</span>
          </button>
        </div>
      </div>
    </aside>
    <section class="workspace">
      <header class="topbar">
        <div class="topbar-title"><span class="topbar-kicker">Agent</span><strong>Ready for a task</strong></div>
        <div class="topbar-actions"></div>
      </header>
      <div class="content-grid" id="task">
        <section class="task-column">
          <section class="agent-stage">
            <div class="hero-copy"><p class="eyebrow">Your task</p><h1>What should we accomplish?</h1><p>Describe the outcome. Tro will plan the work, use the right tools, and pause at important boundaries.</p></div>
            <div class="agent-stage__map" aria-hidden="true">
              <div class="agent-stage__orbit agent-stage__orbit--outer"></div><div class="agent-stage__orbit agent-stage__orbit--inner"></div>
              <span class="agent-stage__node agent-stage__node--scope">Outcome first</span><span class="agent-stage__node agent-stage__node--act">Act</span><span class="agent-stage__node agent-stage__node--verify">Success looks like</span>
              <span class="agent-stage__core"><img alt="" class="brand-mark agent-stage__mark" src="${brandMarkDataUrl}"/><i></i></span>
            </div>
          </section>
          <form class="task-composer">
            <label for="preview-task-request">Describe the outcome</label>
            <div class="voice-status"><span class="voice-indicator" aria-hidden="true"></span><span>Voice ready</span><span class="voice-shortcuts"><span class="voice-shortcut"><span class="voice-shortcut__label">Dictate</span><span class="voice-shortcut__key"><kbd>⌘</kbd><kbd>⌃</kbd></span></span></span></div>
            <textarea id="preview-task-request" placeholder="Type a task, or hold Dictation to add text without sending…" rows="4"></textarea>
            <div class="execution-profile-picker"><button aria-pressed="true" type="button"><strong>Everyday</strong><span>Apps, research, and routine desktop work</span></button><button aria-pressed="false" type="button"><strong>Workspace</strong><span>Code and files in a selected project</span></button></div>
            <div class="composer-footer"><span>Tro asks before high-impact or expanded-scope actions.</span><button class="primary-button" disabled type="submit">Start task <span aria-hidden="true">→</span></button></div>
          </form>
          <div class="examples" aria-label="Example tasks"><button type="button">Open YouTube for me</button><button type="button">Organize my Downloads folder</button><button type="button">Compare three note-taking apps</button><button type="button">Fix the failing tests in my project</button></div>
        </section>
        <aside class="context-column">
          <section class="usage-overview">
            <div class="usage-overview__heading"><div><p class="eyebrow">Plan &amp; weekly usage</p><h2>Tro Free</h2></div><strong class="usage-overview__percent">100% left</strong></div>
            <div aria-label="Weekly usage" aria-valuemax="100" aria-valuemin="0" aria-valuenow="100" class="usage-overview__progress" role="progressbar"><span style="width:100%"></span></div>
            <p class="usage-overview__detail">50 of 50 messages left</p>
          </section>
          <section class="context-overview"><p class="eyebrow">Current app session</p><div class="context-overview__metric"><strong>0</strong><span>finished tasks</span></div><h2>Ready for a task</h2><div class="context-overview__guardrails"><span>Bounded by default</span><span>Approval gates enabled</span><span>Tools selected at runtime</span></div></section>
        </aside>
      </div>
    </section>
  </main>`;
}

describe('settings modal visual preview', () => {
  it('renders the fixed General ledger over the current workspace', () => {
    const css = readFileSync(
      new URL('../../src/index.css', import.meta.url),
      'utf8',
    );
    const brandMarkDataUrl = `data:image/png;base64,${readFileSync(
      new URL('../../src/assets/trocode-logo.png', import.meta.url),
    ).toString('base64')}`;
    const appShell = previewAppShell(brandMarkDataUrl);
    const markup = renderToStaticMarkup(
      createElement(SettingsPage, {
        appLanguage: 'en',
        autonomyMode: 'balanced',
        appUpdateError: null,
        appUpdateStatus: {
          currentVersion: '0.1.8',
          message: 'Tro is up to date.',
          phase: 'up_to_date',
          targetVersion: null,
        },
        classroomPetEnabled: true,
        companionBusy: null,
        companionError: null,
        companionStatus,
        error: null,
        hasChanges: false,
        isActivatingMembership: false,
        isLoadingOrganization: false,
        isSaving: false,
        isUpdatingApp: false,
        membershipError: null,
        membershipStatus: {
          expiresAt: null,
          plan: 'free',
          referenceCode: null,
          required: true,
          state: 'active',
          summary: 'Free plan active.',
        },
        muteSystemAudioWhileSpeaking: false,
        onActivateCompanion: vi.fn(),
        onActivateMembership: vi.fn(),
        onActivateSavedCompanion: vi.fn(),
        onAppLanguageChange: vi.fn(),
        onAutonomyModeChange: vi.fn(),
        onCheckForUpdates: vi.fn(),
        onClassroomPetEnabledChange: vi.fn(),
        onClose: vi.fn(),
        onGenerateCompanion: vi.fn(),
        onLanguageChange: vi.fn(),
        onMuteSystemAudioWhileSpeakingChange: vi.fn(),
        onOpenOrganization: vi.fn(),
        onRefreshOrganization: vi.fn(),
        onRestartAndInstall: vi.fn(),
        onSave: vi.fn(),
        onUseDefaultCompanion: vi.fn(),
        organization: null,
        organizationError: null,
        primaryLanguage: 'en',
        saveMessage: null,
        systemAudioMuteSupported: true,
      }),
    ).replace('<dialog', '<dialog data-ready="true"');

    expect(appShell).toContain('class="app-shell preview-app-shell"');
    expect(appShell).toContain('class="preview-window-controls"');
    expect(appShell).toContain('class="sidebar-toggle"');
    expect(appShell).toContain('class="brand-mark"');
    expect(appShell).toContain('<strong>Tro Free</strong>');
    expect(appShell).toContain('Weekly usage · 100% left');
    expect(appShell).toContain('class="new-task-button"');
    expect(appShell).toContain('>New task</span>');
    expect(appShell).toContain('<span class="nav-label">Workspace</span>');
    expect(appShell).toContain('aria-label="History"');
    expect(appShell).toContain('<span class="nav-count">0</span>');
    expect(appShell).toContain('aria-label="Settings" aria-expanded="true"');
    expect(appShell).toContain('Bounded by default');
    expect(appShell).toContain('class="sidebar-account"');
    expect(appShell).toContain('class="workspace"');
    expect(appShell).toContain('class="agent-stage"');

    writeFileSync(
      new URL('./preview.html', import.meta.url),
      `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <style>${css}</style><style>
      body { min-width: 0; }
      .preview-app-shell { position:relative; }
      .preview-window-controls { position:fixed; z-index:6; top:15px; left:16px; display:flex; gap:8px; }
      .preview-window-control { width:12px; height:12px; border:1px solid rgba(0,0,0,.12); border-radius:50%; box-shadow:inset 0 0 0 .5px rgba(255,255,255,.2); }
      .preview-window-control--close { background:#ff5f57; }
      .preview-window-control--minimize { background:#febc2e; }
      .preview-window-control--zoom { background:#28c840; }
      .preview-app-shell button, .preview-app-shell textarea { pointer-events:none; }
      @media (max-width:1020px) {
        .preview-window-controls { left:13px; gap:7px; }
        .preview-window-control { width:11px; height:11px; }
      }
      </style></head><body>${appShell}${markup}<script>
      const previewDialog = document.querySelector('.settings-dialog');
      if (previewDialog instanceof HTMLDialogElement) previewDialog.showModal();
      </script></body></html>`,
    );
  });
});
