import { useCallback, useState } from "react";
import { cn } from "../lib/cn";
import { makeId } from "../lib/config";
import { IconX } from "./Icons";

export type Toast = { id: string; type: "error" | "success" | "info"; title: string; message: string; exiting?: boolean };

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-[420px]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm",
            toast.exiting ? "animate-[toast-out_200ms_ease-in_forwards]" : "animate-[toast-in_300ms_ease-out_both]",
            toast.type === "error" && "bg-red-50 border-red-200 text-red-900",
            toast.type === "success" && "bg-emerald-50 border-emerald-200 text-emerald-900",
            toast.type === "info" && "bg-white border-zinc-200 text-zinc-900",
          )}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{toast.title}</p>
            <p className="text-xs mt-0.5 opacity-80 break-words">{toast.message}</p>
          </div>
          <button type="button" className="shrink-0 text-current opacity-40 hover:opacity-100 transition-opacity" onClick={() => onDismiss(toast.id)}>
            <IconX />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((type: Toast["type"], title: string, message: string) => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200);
    }, 8000);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200);
  }, []);
  return { toasts, addToast, dismissToast };
}
