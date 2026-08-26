import { useEffect, useId, useRef, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import {
  MAX_COMPANION_IMAGE_BYTES,
  type AppLanguage,
  type CompanionCustomizationStatus,
  type GenerateCompanionImageRequest,
} from '../shared/contracts';

import { appLocale, translate } from './app-language';

export type CompanionCustomizationBusy =
  | 'loading'
  | 'generating'
  | 'activating'
  | 'resetting'
  | null;

interface CompanionCustomizationCardProps {
  appLanguage: AppLanguage;
  busy: CompanionCustomizationBusy;
  error: string | null;
  onActivate(candidateId: string): Promise<void>;
  onGenerate(request: GenerateCompanionImageRequest): Promise<boolean>;
  onUseDefault(): Promise<void>;
  status: CompanionCustomizationStatus | null;
}

interface SelectedSource {
  file: File;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Tro could not read this image.'));
    reader.onload = () => {
      const result = reader.result;
      const prefix = `data:${file.type};base64,`;
      if (typeof result !== 'string' || !result.startsWith(prefix)) {
        reject(new Error('Tro could not read this image.'));
        return;
      }
      resolve(result.slice(prefix.length));
    };
    reader.readAsDataURL(file);
  });
}

function firstFile(files: FileList | readonly File[]): File | null {
  return Array.from(files)[0] ?? null;
}

function firstClipboardImage(items: DataTransferItemList): File | null {
  const imageItem = Array.from(items).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  return imageItem?.getAsFile() ?? null;
}

function LocalImagePreview({ file, label }: { file: File; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    let bitmap: ImageBitmap | null = null;
    void createImageBitmap(file)
      .then((decoded) => {
        if (!active) {
          decoded.close();
          return;
        }
        bitmap = decoded;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const scale = Math.max(
          canvas.width / decoded.width,
          canvas.height / decoded.height,
        );
        const width = decoded.width * scale;
        const height = decoded.height * scale;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          decoded,
          (canvas.width - width) / 2,
          (canvas.height - height) / 2,
          width,
          height,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [file]);

  return (
    <canvas
      aria-label={label}
      height={132}
      ref={canvasRef}
      role="img"
      width={132}
    />
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect height="15" rx="2.5" stroke="currentColor" width="18" x="3" y="4.5" />
      <circle cx="8.25" cy="9.25" fill="currentColor" r="1.25" />
      <path d="m5.5 17 4.25-4.25 2.7 2.7 2.25-2.25 3.8 3.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect height="10" rx="2.5" stroke="currentColor" width="14" x="5" y="10" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeLinecap="round" />
      <circle cx="12" cy="15" fill="currentColor" r="1.25" />
    </svg>
  );
}

export function CompanionCustomizationCard({
  appLanguage,
  busy,
  error,
  onActivate,
  onGenerate,
  onUseDefault,
  status,
}: CompanionCustomizationCardProps) {
  const inputId = useId();
  const sourceHelpId = `${inputId}-source-help`;
  const promptHelpId = `${inputId}-prompt-help`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [selectedSource, setSelectedSource] =
    useState<SelectedSource | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const isBusy = busy !== null;
  const quota = status?.quota ?? null;
  const hasPrompt = prompt.trim().length > 0;
  const canGenerate =
    status?.state === 'available' &&
    quota !== null &&
    quota.remaining > 0 &&
    selectedSource !== null &&
    hasPrompt &&
    !isBusy;
  const resetDate = quota
    ? new Intl.DateTimeFormat(appLocale(appLanguage), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(quota.periodEndsAt))
    : null;

  const selectSource = (file: File | null): void => {
    setIsDragging(false);
    if (!file) {
      setLocalError(t('Choose a PNG or JPEG image.'));
      return;
    }
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setLocalError(t('Choose a PNG or JPEG image.'));
      return;
    }
    if (file.size === 0 || file.size > MAX_COMPANION_IMAGE_BYTES) {
      setLocalError(t('Choose an image no larger than 5 MiB.'));
      return;
    }
    setLocalError(null);
    setSelectedSource({ file });
  };

  const openImagePicker = (): void => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const submitGeneration = async (): Promise<void> => {
    if (!canGenerate || !selectedSource) return;
    setLocalError(null);
    try {
      const succeeded = await onGenerate({
        imageBase64: await readFileAsBase64(selectedSource.file),
        mimeType: selectedSource.file.type as 'image/png' | 'image/jpeg',
        prompt: prompt.trim(),
        requestId: crypto.randomUUID(),
      });
      if (succeeded) {
        setSelectedSource(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (generationError) {
      setLocalError(
        generationError instanceof Error
          ? t(generationError.message)
          : t('Tro could not read this image.'),
      );
    }
  };

  const activeImageUrl =
    status?.appearance.kind === 'custom'
      ? status.appearance.assetUrl
      : cursorBuddyUrl;
  const generateLabel =
    busy === 'generating'
      ? t('Creating your preview…')
      : !selectedSource
        ? t('Add an image to continue')
        : !hasPrompt
          ? t('Describe a style to continue')
          : t('Generate preview');

  return (
    <section
      aria-busy={isBusy}
      aria-labelledby="companion-customization-heading"
      className="settings-card companion-customization-card"
    >
      <div className="companion-customization-card__header">
        <div>
          <p className="eyebrow">{t('Personalization')}</p>
          <h2 id="companion-customization-heading">{t('Custom companion')}</h2>
          <p className="settings-help companion-customization-card__intro">
            {t(
              'Start with any picture, choose a style, then preview your tiny cursor companion.',
            )}
          </p>
        </div>
        {quota && (
          <div
            aria-label={t('{remaining} of {limit} left this month', {
              limit: quota.limit,
              remaining: quota.remaining,
            })}
            className={`companion-quota-meter${quota.remaining === 0 ? ' companion-quota-meter--empty' : ''}`}
            role="status"
          >
            <span aria-hidden="true" className="companion-quota-meter__pips">
              {Array.from({ length: quota.limit }, (_, index) => (
                <span
                  className={index < quota.remaining ? 'is-available' : undefined}
                  key={index}
                />
              ))}
            </span>
            <span>
              {t('{remaining} of {limit} left this month', {
                limit: quota.limit,
                remaining: quota.remaining,
              })}
            </span>
          </div>
        )}
      </div>

      {!status || busy === 'loading' ? (
        <div className="companion-customization-card__loading" role="status">
          <span className="companion-customization-card__loading-orb" />
          <span>{t('Getting your companion ready…')}</span>
        </div>
      ) : (
        <>
          <div aria-live="polite" className="companion-customization-current">
            <div className="companion-customization-preview companion-customization-preview--current">
              <img alt="" src={activeImageUrl} />
              <span className="companion-customization-active-mark">
                {t('Active')}
              </span>
            </div>
            <div className="companion-customization-current__copy">
              <span className="companion-customization-kicker">
                {t('Following your cursor now')}
              </span>
              <strong>{t('Current companion')}</strong>
              <p>
                {status.appearance.kind === 'custom'
                  ? t('Your custom companion is active.')
                  : t('Tro’s default companion is active.')}
              </p>
              {status.appearance.kind === 'custom' && (
                <button
                  className="companion-customization-reset"
                  disabled={isBusy}
                  onClick={() => void onUseDefault()}
                  type="button"
                >
                  {busy === 'resetting'
                    ? t('Restoring…')
                    : t('Use default companion')}
                </button>
              )}
            </div>
          </div>

          {status.state !== 'available' ? (
            <div
              className={`companion-customization-notice companion-customization-notice--${status.state}`}
              role={status.state === 'error' ? 'alert' : 'status'}
            >
              <span aria-hidden="true" className="companion-customization-notice__mark">
                !
              </span>
              <span>
                <strong>{t('Generation unavailable')}</strong>
                <small>{t(status.summary)}</small>
              </span>
            </div>
          ) : quota?.remaining === 0 ? (
            <div
              className="companion-customization-notice companion-customization-notice--limit"
              role="status"
            >
              <span aria-hidden="true" className="companion-customization-notice__mark">
                5
              </span>
              <span>
                <strong>{t('All previews used this month')}</strong>
                <small>
                  {t(
                    'You can create more on {date}. Your current companion stays active.',
                    { date: resetDate ?? '' },
                  )}
                </small>
              </span>
            </div>
          ) : (
            <div className="companion-customization-generator">
              <ol className="companion-customization-steps">
                <li className="companion-customization-step">
                  <div className="companion-customization-step__heading">
                    <span aria-hidden="true" className="companion-customization-step__number">
                      1
                    </span>
                    <span>
                      <strong>{t('Choose a picture')}</strong>
                      <small>
                        {t(
                          'A pet, drawing, character, or anything that feels like you.',
                        )}
                      </small>
                    </span>
                  </div>

                  <input
                    accept="image/png,image/jpeg"
                    className="companion-customization-file-input"
                    disabled={isBusy}
                    id={inputId}
                    onChange={(event) =>
                      selectSource(firstFile(event.target.files ?? []))
                    }
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    aria-describedby={sourceHelpId}
                    className={`companion-customization-dropzone${selectedSource ? ' companion-customization-dropzone--selected' : ''}${isDragging ? ' companion-customization-dropzone--dragging' : ''}`}
                    disabled={isBusy}
                    onClick={openImagePicker}
                    onDragEnter={() => setIsDragging(true)}
                    onDragLeave={() => setIsDragging(false)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      selectSource(firstFile(event.dataTransfer.files));
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      selectSource(firstClipboardImage(event.clipboardData.items));
                    }}
                    type="button"
                  >
                    <span className="companion-customization-source-preview">
                      {selectedSource ? (
                        <LocalImagePreview
                          file={selectedSource.file}
                          label={t('Selected source')}
                        />
                      ) : (
                        <ImageIcon />
                      )}
                    </span>
                    <span className="companion-customization-dropzone__copy">
                      <strong>
                        {selectedSource
                          ? t('Picture ready')
                          : t('Drop, paste, or click to choose')}
                      </strong>
                      <small id={sourceHelpId}>
                        {selectedSource ? (
                          <>
                            {selectedSource.file.name}
                            <span aria-hidden="true"> · </span>
                            {t('Click to choose another')}
                          </>
                        ) : (
                          t('PNG or JPEG · up to 5 MiB')
                        )}
                      </small>
                    </span>
                    <span aria-hidden="true" className="companion-customization-dropzone__action">
                      {selectedSource ? t('Change') : t('Browse')}
                    </span>
                  </button>
                  {localError && (
                    <p className="companion-customization-inline-error" role="alert">
                      {localError}
                    </p>
                  )}
                </li>

                <li className="companion-customization-step">
                  <div className="companion-customization-step__heading">
                    <span aria-hidden="true" className="companion-customization-step__number">
                      2
                    </span>
                    <span>
                      <strong>{t('Describe the vibe')}</strong>
                      <small id={promptHelpId}>
                        {t('Try a style, mood, and a few colors.')}
                      </small>
                    </span>
                  </div>

                  <label className="companion-customization-prompt">
                    <span className="companion-customization-prompt__label">
                      {t('Your idea')}
                    </span>
                    <textarea
                      aria-describedby={promptHelpId}
                      disabled={isBusy}
                      maxLength={400}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={t(
                        'A cheerful pixel-art fox in sunny yellow and orange',
                      )}
                      rows={3}
                      value={prompt}
                    />
                    <small>
                      {t('{count} of 400 characters', { count: prompt.length })}
                    </small>
                  </label>
                </li>
              </ol>

              <div className="companion-customization-action-panel">
                <div className="companion-customization-action-panel__copy">
                  <strong>{t('Ready for a first look?')}</strong>
                  <span>
                    {t(
                      '{used} of {limit} previews used · resets {date}',
                      {
                        date: resetDate ?? '',
                        limit: quota?.limit ?? 5,
                        used: quota?.used ?? 0,
                      },
                    )}
                  </span>
                </div>
                <button
                  className="primary-button companion-customization-generate"
                  disabled={!canGenerate}
                  onClick={() => void submitGeneration()}
                  type="button"
                >
                  {busy === 'generating' && (
                    <span aria-hidden="true" className="companion-customization-spinner" />
                  )}
                  {generateLabel}
                </button>
                {busy === 'generating' && (
                  <p className="companion-customization-progress" role="status">
                    {t('This can take up to 2 minutes. Keep Tro open.')}
                  </p>
                )}
              </div>

              <div className="companion-customization-privacy">
                <span className="companion-customization-privacy__icon">
                  <LockIcon />
                </span>
                <div>
                  <strong>{t('Private by design')}</strong>
                  <p>
                    {t(
                      'Sent once to OpenAI; your source and prompt are not saved by Tro.',
                    )}
                  </p>
                  <details>
                    <summary>{t('Privacy and monthly slots')}</summary>
                    <p>
                      {t(
                        'Your source image and prompt are sent to OpenAI only for this generation; Tro does not save them. A companion you activate stays encrypted on this device. OpenAI may retain images flagged for child-safety review. An uncertain provider outcome may use one monthly slot, and Tro will not retry it automatically.',
                      )}
                    </p>
                  </details>
                </div>
              </div>
            </div>
          )}

          {status.candidate && (
            <div aria-live="polite" className="companion-customization-candidate">
              <div className="companion-customization-candidate__heading">
                <span aria-hidden="true" className="companion-customization-step__number">
                  3
                </span>
                <span>
                  <strong>{t('Meet your new companion')}</strong>
                  <small>{t('Nothing changes until you choose to use it.')}</small>
                </span>
              </div>
              <div className="companion-customization-candidate__body">
                <div className="companion-customization-preview companion-customization-preview--candidate">
                  <img alt="" src={status.candidate.assetUrl} />
                </div>
                <div>
                  <span className="companion-customization-kicker">
                    {t('Preview ready')}
                  </span>
                  <strong>{t('Made for your cursor')}</strong>
                  <p>
                    {t('Preview available until {time}.', {
                      time: new Intl.DateTimeFormat(appLocale(appLanguage), {
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(status.candidate.expiresAt)),
                    })}
                  </p>
                  <button
                    className="primary-button"
                    disabled={isBusy}
                    onClick={() => void onActivate(status.candidate!.id)}
                    type="button"
                  >
                    {busy === 'activating'
                      ? t('Activating…')
                      : t('Use this companion')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div aria-live="polite">
        {error && (
          <p className="settings-feedback settings-feedback--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
