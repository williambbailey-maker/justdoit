/**
 * The swoosh mark. The viewBox is cropped to the path's real bounds
 * (measured: x -0.1, y 7.8, w 24.1, h 8.4) so `height` is the height you
 * actually see, with no dead space above or below.
 */
export const MARK_PATH =
  "M24 7.8 6.442 15.276c-1.456.616-2.679.925-3.668.925-1.12 0-1.933-.392-2.437-1.177-.317-.504-.462-1.143-.434-1.918.028-.775.234-1.606.616-2.492.31-.72.837-1.63 1.583-2.729-.43.696-.734 1.36-.91 1.99-.174.63-.24 1.19-.196 1.68.045.49.196.9.455 1.23.26.33.62.55 1.08.66.46.11.98.11 1.56 0 .58-.11 1.22-.32 1.92-.63L24 7.8z";

const RATIO = 24.1 / 8.4;

export default function Mark({
  height,
  color = "var(--fg)",
  className,
}: {
  height: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="-0.1 7.8 24.1 8.4"
      height={height}
      width={Math.round(height * RATIO)}
      fill={color}
      className={className}
      role="img"
      aria-label="swoosh"
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
