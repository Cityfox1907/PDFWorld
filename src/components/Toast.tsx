import { useStore } from '../state/store';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info;
  // Errors must be announced immediately (assertive); everything else stays polite.
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={17} />
      <span>{toast.message}</span>
    </div>
  );
}
