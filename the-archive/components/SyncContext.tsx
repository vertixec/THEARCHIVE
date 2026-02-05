'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type SyncStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'SYNCING';

type SyncContextType = {
  status: SyncStatus;
  setStatus: (status: SyncStatus) => void;
};

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('SYNCING');

  return (
    <SyncContext.Provider value={{ status, setStatus }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used within a SyncProvider');
  return context;
}
