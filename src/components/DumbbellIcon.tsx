/** Renders the same icon as primary buttons – replace public/Lei_Logo.png to change both. */
export default function DumbbellIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <img
      src="/Lei_Logo.png"
      alt=""
      className={className}
      aria-hidden
    />
  );
}
