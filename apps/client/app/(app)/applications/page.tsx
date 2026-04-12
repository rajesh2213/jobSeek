import type { Metadata } from "next";
import { ApplicationsPageClient } from "./ApplicationsPageClient";

export const metadata: Metadata = {
  title: "Applications | JobSeek",
  description: "Track your job applications and status",
};

export default function ApplicationsPage() {
  return <ApplicationsPageClient />;
}
