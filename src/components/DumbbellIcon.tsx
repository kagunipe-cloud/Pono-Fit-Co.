/** Renders the same icon as primary buttons – replace public/Lei_Logos.png to change both. */
export default function DumbbellIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <img
      src="/Lei_Logos.png"
      alt=""
      className={className}
      aria-hidden
    />
  );
}
