/**
 * The app's only loading indicator (TDD §12.4): a ring of 8 dashes, slowly turning. Kumo's `Loader` animates with
 * SVG `<animate>`, which CSS can't restyle, so we draw our own. Still when the user prefers reduced motion.
 * `label={null}` when words next to it already say what's loading, so screen readers don't hear it twice.
 */
export function DashedLoader({ size = 16, label = "Loading", className = "" }: { size?: number; label?: string | null; className?: string }) {
  return (
    <svg
      {...(label === null ? { "aria-hidden": true } : { role: "status", "aria-label": label })}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      className={`shrink-0 animate-spin [animation-duration:1.4s] motion-reduce:animate-none ${className}`}
    >
      {/* Circumference of r=9 is 56.5: 8 dashes of 3.6 with gaps of 3.47. */}
      <circle cx="12" cy="12" r="9" strokeDasharray="3.6 3.47" />
    </svg>
  );
}
