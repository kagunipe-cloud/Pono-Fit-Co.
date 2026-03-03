"use client";

/** PR badge types: Reps PR, 1RM PR (Auto 1RM), or 1RM PR (My 1RM) */
export type PRBadgeType = "Reps" | "Auto 1RM" | "My 1RM";

const DEFAULT_BADGE_IMAGE = "/PR_Badge.png";

type PRBadgeProps = {
  type: PRBadgeType;
  /** Path to badge image. Defaults to /PR_Badge.png */
  badgeImageSrc?: string;
  size?: "sm" | "md";
};

/**
 * Displays a PR badge with label underneath.
 * One badge design; label shows "Reps", "Auto 1RM", or "My 1RM".
 * Drop badge image in public/ and pass badgeImageSrc="/your-badge.png" when ready.
 */
export function PRBadge({ type, badgeImageSrc = DEFAULT_BADGE_IMAGE, size = "sm" }: PRBadgeProps) {
  const isSm = size === "sm";
  const dim = isSm ? "w-6 h-6" : "w-8 h-8";
  const textSize = isSm ? "text-[10px]" : "text-xs";

  return (
    <div className="flex flex-col items-center gap-0.5">
      {badgeImageSrc ? (
        <img
          src={badgeImageSrc}
          alt={`${type} PR`}
          className={`${dim} object-contain`}
        />
      ) : (
        <div
          className={`${dim} rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center`}
          title={`${type} PR`}
        >
          <span className="text-amber-700 font-bold text-xs">PR</span>
        </div>
      )}
      <span className={`${textSize} font-medium text-stone-600`}>{type}</span>
    </div>
  );
}
