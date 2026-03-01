interface PlacementIndicatorProps {
  componentName: string;
  onCancel: () => void;
}

/**
 * Floating pill shown when a component is selected from the spotlight/sidebar
 * and is waiting to be placed on the canvas by clicking.
 */
export function PlacementIndicator({ componentName, onCancel }: PlacementIndicatorProps) {
  return (
    <div className="absolute top-[52px] left-[10px] z-50" role="status" aria-live="polite">
      {/* Rotating border wrapper */}
      <div
        className="relative rounded-full p-[2px]"
        data-placement-border
        style={{
          background:
            'conic-gradient(from var(--angle), hsl(var(--primary)) 0deg, transparent 60deg, transparent 300deg, hsl(var(--primary)) 360deg)',
          animation: 'rotate-border 2s linear infinite',
        }}
      >
        {/* Inner pill */}
        <div className="bg-background px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
          <span className="text-xs font-medium text-foreground whitespace-nowrap">
            Click to place: <span className="text-primary font-semibold">{componentName}</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="hover:bg-muted rounded-full p-0.5 transition-colors"
            aria-label="Cancel placement"
          >
            <svg
              className="h-3.5 w-3.5 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
      {/* Keyframe animation with CSS property */}
      <style>{`
        @property --angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes rotate-border {
          from { --angle: 0deg; }
          to { --angle: 360deg; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-placement-border] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
