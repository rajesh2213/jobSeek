export function BlogAuthor({ name }: { name: string }) {
  return (
    <footer className="mt-12 border-t border-line pt-8">
      <p className="text-xs font-bold uppercase tracking-wider text-ink/45">Author</p>
      <p className="mt-2 text-sm font-semibold text-ink">{name}</p>
    </footer>
  );
}
