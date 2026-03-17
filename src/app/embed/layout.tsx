export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[180px] min-w-[260px] bg-white p-4 flex items-center justify-center rounded-lg">
      {children}
    </div>
  );
}
