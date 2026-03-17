"use client";

import { createContext, useContext, useEffect, useState } from "react";

const DEFAULT_TZ = "Pacific/Honolulu";
const DEFAULT_OPEN_MIN = 6;
const DEFAULT_OPEN_MAX = 22;

type SettingsContextValue = { timezone: string; openHourMin: number; openHourMax: number };

const SettingsContext = createContext<SettingsContextValue>({
  timezone: DEFAULT_TZ,
  openHourMin: DEFAULT_OPEN_MIN,
  openHourMax: DEFAULT_OPEN_MAX,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState<string>(DEFAULT_TZ);
  const [openHourMin, setOpenHourMin] = useState(DEFAULT_OPEN_MIN);
  const [openHourMax, setOpenHourMax] = useState(DEFAULT_OPEN_MAX);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { timezone?: string; open_hour_min?: number; open_hour_max?: number } | null) => {
        if (data?.timezone) setTimezone(data.timezone);
        if (typeof data?.open_hour_min === "number") setOpenHourMin(data.open_hour_min);
        if (typeof data?.open_hour_max === "number") setOpenHourMax(data.open_hour_max);
      })
      .catch(() => {});
  }, []);

  return (
    <SettingsContext.Provider value={{ timezone, openHourMin, openHourMax }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useAppTimezone(): string {
  return useContext(SettingsContext).timezone;
}

export function useOpenHours(): { openHourMin: number; openHourMax: number } {
  const { openHourMin, openHourMax } = useContext(SettingsContext);
  return { openHourMin, openHourMax };
}
