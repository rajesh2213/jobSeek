import type { Metadata } from "next";
import { Container } from "../../components/ui/Container";

export const metadata: Metadata = {
  title: "Saved searches | JobSeek",
};

export default function SavedSearchesPage() {
  return (
    <Container width="jobs" className="py-10">
      <h1 className="font-sans text-2xl font-semibold text-ink">Saved searches</h1>
      <p className="mt-3 text-sm text-ink-muted">Coming soon.</p>
    </Container>
  );
}
