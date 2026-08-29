import type {
  AppLanguage,
  CompanionPetMood,
  CompanionPetNudge as CompanionPetNudgeProjection,
} from '../shared/contracts';

const MOOD_LABELS: Readonly<
  Record<AppLanguage, Record<CompanionPetMood, string>>
> = {
  en: {
    encouraging: 'Keep going',
    waiting: 'While you wait',
    celebrating: 'Nice work',
    thinking: 'Thinking',
    working: 'On it',
    verifying: 'Checking',
  },
  vi: {
    encouraging: 'Tiếp tục nhé',
    waiting: 'Trong lúc chờ',
    celebrating: 'Làm tốt lắm',
    thinking: 'Đang suy nghĩ',
    working: 'Đang làm',
    verifying: 'Đang kiểm tra',
  },
};

export function companionPetMoodLabel(
  language: AppLanguage,
  mood: CompanionPetMood,
): string {
  return MOOD_LABELS[language][mood];
}

export function CompanionPetNudge({
  nudge,
}: {
  nudge: CompanionPetNudgeProjection;
}) {
  return (
    <aside
      aria-labelledby="companion-pet-nudge-title companion-pet-nudge-mood"
      aria-live="polite"
      className={`guidance-callout companion-pet-nudge companion-pet-nudge--${nudge.mood} guidance-callout--${nudge.side}`}
      role="status"
    >
      <span
        className="companion-pet-nudge__identity"
        id="companion-pet-nudge-title"
      >
        Tro pet
      </span>
      <span
        className="companion-pet-nudge__mood"
        id="companion-pet-nudge-mood"
      >
        {companionPetMoodLabel(nudge.language, nudge.mood)}
      </span>
      <p className="companion-pet-nudge__message">{nudge.message}</p>
    </aside>
  );
}
