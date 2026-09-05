export interface ClassroomVoiceBinding {
  selectionId: string | null;
  taskId: string | null;
  interactionId: string | null;
}
export function sameClassroomVoiceDestination(
  captured: ClassroomVoiceBinding | undefined,
  current: ClassroomVoiceBinding,
): boolean {
  return Boolean(
    captured &&
    captured.selectionId === current.selectionId &&
    captured.taskId === current.taskId &&
    captured.interactionId === current.interactionId,
  );
}
