type Props = {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "confirm",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-panel border border-line rounded w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-line">
          <h3 className="font-medium">{title}</h3>
        </div>
        <div className="px-4 py-3 text-sm text-muted">{body}</div>
        <div className="px-4 py-3 border-t border-line flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm font-mono text-muted hover:text-ink"
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            className={
              "px-4 py-1.5 rounded font-mono text-sm " +
              (danger ? "bg-bad text-bg" : "bg-accent text-bg")
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
