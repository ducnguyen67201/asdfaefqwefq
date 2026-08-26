import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  labelledBy: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
}

export function Modal({
  labelledBy,
  children,
  className,
  onClose,
  open,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
