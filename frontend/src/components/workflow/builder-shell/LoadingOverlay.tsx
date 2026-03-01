export function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
      <svg
        className="animate-spin h-8 w-8 text-muted-foreground"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        ></path>
      </svg>
      <p className="mt-3 text-sm text-muted-foreground">Loading workflow…</p>
    </div>
  );
}
