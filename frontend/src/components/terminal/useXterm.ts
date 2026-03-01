import { useEffect, useRef, useState } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useThemeStore } from '@/store/themeStore';
import { logger } from '@/lib/logger';
import { TERMINAL_THEME, generateSelectionCSS } from './terminal-utils';

export interface UseXtermResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  terminalRef: React.RefObject<Terminal | null>;
  fitAddonRef: React.RefObject<FitAddon | null>;
  isTerminalReady: boolean;
  isXtermLoaded: boolean;
  xtermError: string | null;
  terminalReadyRef: React.RefObject<boolean>;
}

/**
 * Hook that manages xterm.js terminal initialization, fit addon, theme syncing,
 * and resize handling. Recreates the terminal when `terminalKey` changes.
 */
export function useXterm(terminalKey: number): UseXtermResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalReadyRef = useRef<boolean>(false);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isXtermLoaded, setIsXtermLoaded] = useState(false);
  const [xtermError, setXtermError] = useState<string | null>(null);

  const theme = useThemeStore((state) => state.theme);
  const isDarkMode = theme === 'dark';

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;

    (async () => {
      // Dynamically import xterm to reduce initial bundle size
      let XtermTerminal: typeof Terminal;
      let XtermFitAddon: typeof FitAddon;

      try {
        const [xtermModule, fitModule] = await Promise.all([
          import('xterm'),
          import('xterm-addon-fit'),
        ]);
        XtermTerminal = xtermModule.Terminal;
        XtermFitAddon = fitModule.FitAddon;
      } catch (err) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : 'Failed to load terminal';
          setXtermError(message);
          logger.error('[NodeTerminalPanel] Failed to load xterm:', err);
        }
        return;
      }

      if (disposed) return;
      setIsXtermLoaded(true);
      setXtermError(null);

      // Ensure container has dimensions before opening terminal
      // This prevents xterm.js from trying to access undefined dimensions
      const ensureContainerReady = (callback: () => void) => {
        const container = containerRef.current;
        if (!container) return;

        // Check if container has dimensions
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          callback();
          return;
        }

        // If no dimensions yet, wait for next frame and try again
        requestAnimationFrame(() => {
          ensureContainerReady(callback);
        });
      };

      ensureContainerReady(() => {
        if (disposed) return;
        const container = containerRef.current;
        if (!container) return;

        const term = new XtermTerminal({
          convertEol: false,
          fontSize: 12,
          disableStdin: true,
          cursorBlink: false,
          allowProposedApi: true,
          allowTransparency: false,
          macOptionIsMeta: false,
          macOptionClickForcesSelection: false,
          rightClickSelectsWord: false,
          windowsMode: false,
          theme: { ...TERMINAL_THEME },
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        });

        term.options.macOptionIsMeta = false;
        term.options.macOptionClickForcesSelection = false;
        term.options.rightClickSelectsWord = false;

        const fitAddon = new XtermFitAddon();
        term.loadAddon(fitAddon);

        try {
          term.open(container);
        } catch (error: unknown) {
          logger.warn('[NodeTerminalPanel] Failed to open terminal:', error);
          // If opening fails, dispose and return early
          term.dispose();
          return;
        }

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;
        terminalReadyRef.current = false;
        setIsTerminalReady(false);

        // Wait for terminal to be fully initialized before fitting
        // Use requestAnimationFrame to ensure DOM and terminal render service are ready
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (fitAddonRef.current && containerRef.current && terminalRef.current === term) {
              try {
                fitAddonRef.current.fit();
                terminalReadyRef.current = true;
                setIsTerminalReady(true);
              } catch (error: unknown) {
                logger.warn('[NodeTerminalPanel] Failed to fit terminal on mount', error);
                // Mark as ready anyway to allow rendering
                terminalReadyRef.current = true;
                setIsTerminalReady(true);
              }
            }
          });
        });
      });
    })();

    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (_error: unknown) {
          // Ignore resize errors during terminal recreation
        }
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      terminalReadyRef.current = false;
      setIsTerminalReady(false);
      if (terminalRef.current) {
        terminalRef.current.dispose();
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalKey]);

  // Update terminal theme when dark mode changes (without recreating terminal)
  useEffect(() => {
    if (!terminalRef.current || !containerRef.current) return;

    terminalRef.current.options.theme = { ...TERMINAL_THEME };

    // Update selection color via CSS (xterm.js doesn't support selection in theme)
    const styleId = 'xterm-selection-style';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = generateSelectionCSS();
  }, [isDarkMode]);

  return {
    containerRef,
    terminalRef,
    fitAddonRef,
    isTerminalReady,
    isXtermLoaded,
    xtermError,
    terminalReadyRef,
  };
}
