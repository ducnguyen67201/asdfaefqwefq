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
  },
  vi: {
    encouraging: 'Tiếp tục nhé',
    waiting: 'Trong lúc chờ',
    celebrating: 'Làm tốt lắm',
  },
};

export function classroomPetMoodLabel(
  language: AppLanguage,
  mood: CompanionPetMood,
): string {
  return MOOD_LABELS[language][mood];
}

export function ClassroomPetNudge({
  nudge,
}: {
  nudge: CompanionPetNudgeProjection;
}) {
  return (
    <aside
      aria-labelledby="classroom-pet-nudge-title classroom-pet-nudge-mood"
      aria-live="polite"
      className={`guidance-callout classroom-pet-nudge classroom-pet-nudge--${nudge.mood} guidance-callout--${nudge.side}`}
      role="status"
    >
      <div className="guidance-callout__header">
        <span className="guidance-callout__avatar" aria-hidden="true">
          T
        </span>
        <span className="guidance-callout__name" id="classroom-pet-nudge-title">
          Tro pet
        </span>
        <span
          className="guidance-callout__status"
          id="classroom-pet-nudge-mood"
        >
          {classroomPetMoodLabel(nudge.language, nudge.mood)}
        </span>
      </div>
      <p className="classroom-pet-nudge__message">{nudge.message}</p>
    </aside>
  );
}
