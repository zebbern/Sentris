interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

const FADE_SLIDE_KEYFRAMES = `
@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

let keyframesInjected = false;

function injectKeyframes() {
  if (keyframesInjected) return;
  const style = document.createElement('style');
  style.textContent = FADE_SLIDE_KEYFRAMES;
  document.head.appendChild(style);
  keyframesInjected = true;
}

/**
 * Subtle page transition wrapper using opacity + y-translate.
 * Duration kept at 150ms to avoid CLS and feel snappy.
 * No layout animations — only transform + opacity.
 * Uses CSS animation instead of framer-motion for smaller bundle.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  injectKeyframes();

  return (
    <div style={{ animation: 'fadeSlideIn 150ms ease-out' }} className={className}>
      {children}
    </div>
  );
}
