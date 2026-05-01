import Image from "next/image";

/** Renders the same icon as primary buttons – replace public/Lei_Logos.png to change both. */
export default function DumbbellIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <Image
      src="/Lei_Logos.png"
      alt=""
      width={16}
      height={16}
      className={className}
      aria-hidden
    />
  );
}
