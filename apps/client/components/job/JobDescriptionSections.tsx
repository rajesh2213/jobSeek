import { parseJobDescription } from "../../lib/jobDescriptionParser";

interface SectionProps {
  title: string;
  items: string[];
}

function Section({ title, items }: SectionProps) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-base font-extrabold tracking-tight text-ink">{title}</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/80">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

interface Props {
  description: string | null | undefined;
}

export function JobDescriptionSections({ description }: Props) {
  if (!description?.trim()) {
    return <p className="text-sm text-ink/60">No description available.</p>;
  }
  const parsed = parseJobDescription(description);
  if (!parsed.intro && !parsed.responsibilities.length) {
    return <p className="text-sm leading-relaxed text-ink/80">{description}</p>;
  }
  return (
    <div className="space-y-6 leading-relaxed">
      {parsed.intro ? (
        <section className="space-y-2">
          <h3 className="text-base font-extrabold tracking-tight text-ink">Overview</h3>
          <p className="text-sm leading-relaxed text-ink/80">{parsed.intro}</p>
        </section>
      ) : null}
      <Section title="Responsibilities" items={parsed.responsibilities} />
      <Section title="Requirements" items={parsed.requirements} />
      <Section title="Benefits" items={parsed.benefits} />
      <Section title="Additional Details" items={parsed.others} />
    </div>
  );
}
