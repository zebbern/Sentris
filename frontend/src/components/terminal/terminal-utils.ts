/**
 * Decodes a base64-encoded payload string into a Uint8Array.
 * Returns an empty Uint8Array if decoding fails or if running in a non-browser environment.
 */
export function decodePayload(payload: string): Uint8Array {
  if (typeof window === 'undefined' || typeof atob !== 'function') {
    return new Uint8Array(0);
  }
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/** Terminal theme colors — dark background used for both light and dark app themes. */
export const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
} as const;

/** Standard terminal blue selection color (works well on dark background). */
export const TERMINAL_SELECTION_COLOR = '#264f78';

/**
 * Generates a CSS stylesheet string for xterm.js selection styling.
 * Uses a consistent selection color for both light and dark app themes.
 */
export function generateSelectionCSS(selectionBg: string = TERMINAL_SELECTION_COLOR): string {
  return `
      .xterm .xterm-selection {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top {
        border-top-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom {
        border-bottom-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-left {
        border-left-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-right {
        border-right-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-left,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-right,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-left,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-right {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-left::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-right::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-left::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-right::before {
        background-color: ${selectionBg} !important;
      }
    `;
}
