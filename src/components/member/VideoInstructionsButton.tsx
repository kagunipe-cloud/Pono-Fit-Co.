"use client";

type Props = {
  loading: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
  className?: string;
};

export default function VideoInstructionsButton({ loading, disabled, onClick, className = "" }: Props) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-base font-bold text-white shadow-md hover:opacity-95 hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 bg-[linear-gradient(90deg,theme(colors.red.500),theme(colors.amber.400),theme(colors.emerald.500),theme(colors.sky.500),theme(colors.violet.500))] ${className}`}
    >
      {loading ? "Loading…" : "Video instructions"}
    </button>
  );
}
