import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

/** Landing page: no sidebar — full-bleed marketing layout. */
export default function SmallGroupTrainingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
