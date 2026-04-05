interface Props {
  title: string;
  items: string[];
}

export function JobSection({ title, items }: Props) {
  if (!items.length) return null;
  return (
    <section className="border-b border-ink/10 py-6 last:border-b-0 last:pb-0">
      <h2 className="mb-4 text-lg font-extrabold tracking-tight text-ink">{title}</h2>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/85">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
