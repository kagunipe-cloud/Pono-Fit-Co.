"use client";

import { createContext, useContext, useEffect, useState } from "react";

const DEFAULT_TZ = "Pacific/Honolulu";

type SettingsContextValue = { timezone: string };

const SettingsContext = createContext<SettingsContextValue>({ timezone: DEFAULT_TZ });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState<string>(DEFAULT_TZ);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { timezone?: string } | null) => {
        if (data?.timezone) setTimezone(data.timezone);
      })
      .catch(() => {});
  }, []);

  return (
    <SettingsContext.Provider value={{ timezone }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useAppTimezone(): string {
  return useContext(SettingsContext).timezone;
}
