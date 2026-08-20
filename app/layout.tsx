import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seal Beach Aquatics Schedule",
  description: "Staff scheduling for Seal Beach Aquatics",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const page = <html lang="en"><body>{children}</body></html>;
  // Keep the scheduling preview deployable before the Clerk Marketplace keys are attached.
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{page}</ClerkProvider> : page;
}
