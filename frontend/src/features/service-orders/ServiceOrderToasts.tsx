import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { ServiceOrderToastType } from './types';

export interface ServiceOrderToast {
  id: string;
  message: string;
  type: ServiceOrderToastType;
}

interface ServiceOrderToastsProps {
  toasts: ServiceOrderToast[];
  onDismiss: (id: string) => void;
}

export function ServiceOrderToasts({ toasts, onDismiss }: ServiceOrderToastsProps) {
  return (
    <div className="os-toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => {
        const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info;
        return (
          <div key={toast.id} className={`os-toast os-toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
            <Icon size={20} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Fechar aviso">
              <X size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
