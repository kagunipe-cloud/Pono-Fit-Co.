import { UsageTracker } from "@/components/UsageTracker";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UsageTracker />
      {children}
    </>
  );
}
