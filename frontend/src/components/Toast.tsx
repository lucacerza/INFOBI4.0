/**
 * Toast Component - Visual notification display
 *
 * Renders toast notifications from the global toastStore.
 * Add <ToastContainer /> once in your app (usually in App.tsx).
 */
import { useToastStore, Toast as ToastType } from '../stores/toastStore';
import { X, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors = {
  success: {
    bg: 'bg-green-50 border-green-200',
    icon: 'text-green-500',
    text: 'text-green-800',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    icon: 'text-red-500',
    text: 'text-red-800',
  },
  warning: {
    bg: 'bg-yellow-50 border-yellow-200',
    icon: 'text-yellow-500',
    text: 'text-yellow-800',
  },
  info: {
    bg: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-500',
    text: 'text-blue-800',
  },
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { removeToast } = useToastStore();
  const Icon = icons[toast.type];
  const color = colors[toast.type];

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg
        ${color.bg}
        animate-slide-in
        max-w-sm w-full
      `}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${color.icon}`} />

      <p className={`flex-1 text-sm font-medium ${color.text}`}>
        {toast.message}
      </p>

      <button
        onClick={() => removeToast(toast.id)}
        className={`flex-shrink-0 p-1 rounded hover:bg-black/5 transition ${color.text}`}
        aria-label="Chiudi"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

// Add CSS animation to index.css or here as inline style
const style = document.createElement('style');
style.textContent = `
  @keyframes slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  .animate-slide-in {
    animation: slide-in 0.3s ease-out;
  }
`;
if (typeof document !== 'undefined' && !document.getElementById('toast-styles')) {
  style.id = 'toast-styles';
  document.head.appendChild(style);
}

export default ToastContainer;
