/** Renders the same icon as primary buttons – replace public/pineapple.svg to change both. */
export default function DumbbellIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <img
      src="/pineapple.svg"
      alt=""
      className={className}
      aria-hidden
    />
  );
}
