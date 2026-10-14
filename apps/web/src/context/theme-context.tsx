'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const STORAGE_KEY = 'greenhouse_theme_preference';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyTheme(preference: ThemePreference, systemIsDark: boolean): 'light' | 'dark' {
  const resolved = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initial: ThemePreference = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    setThemeState(initial);
    setResolvedTheme(applyTheme(initial, media.matches));

    const handleSystemChange = (event: MediaQueryListEvent) => {
      if ((window.localStorage.getItem(STORAGE_KEY) || 'system') === 'system') {
        setResolvedTheme(applyTheme('system', event.matches));
      }
    };
    media.addEventListener('change', handleSystemChange);
    return () => media.removeEventListener('change', handleSystemChange);
  }, []);

  const setTheme = useCallback((preference: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, preference);
    setThemeState(preference);
    setResolvedTheme(applyTheme(preference, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
