'use client';

import { useEffect, useState, createContext, useContext, ReactNode } from 'react';

type ToastContextType = {
  showToast: (msg: string) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

function ToastItem({ msg, onRemove }: { msg: string; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Next frame: trigger enter transition
    const frame = requestAnimationFrame(() => setVisible(true));

    const hideTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(onRemove, 300);
    }, 2500);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div
      className={`bg-black border border-acid px-8 py-4 shadow-2xl transition-[opacity,transform] duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <span className="font-mono text-[10px] text-acid uppercase font-bold tracking-[0.3em]">
        {msg}
      </span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  const showToast = (msg: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg }]);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-10 left-0 right-0 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} msg={toast.msg} onRemove={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
