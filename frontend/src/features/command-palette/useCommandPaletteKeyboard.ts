import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';

/**
 * Hook to register global keyboard shortcut for Command Palette
 * Should be used once at the app root level
 */
export function useCommandPaletteKeyboard() {
  const toggle = useCommandPaletteStore((s) => s.toggle);
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const close = useCommandPaletteStore((s) => s.close);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      // Use both e.key (case-insensitive) and e.code for keyboard-layout independence
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }

      // Escape to close (backup, also handled in component)
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        close();
        return;
      }
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [toggle, isOpen, close]);
}
