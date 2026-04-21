interface FlashCardProps {
  summary: string;
  files: string;
  diff: string;
  lines: number;
  category: string;
  index: number;
  total: number;
}

const categoryLabels: Record<string, string> = {
  feature: "ADDITION",
  fix: "CORRECTION",
  refactor: "REORGANISATION",
  test: "VERIFICATION",
  config: "CONFIGURATION",
  docs: "DOCUMENTATION",
  chore: "MAINTENANCE",
};

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+")) {
    return (
      <div className="text-[var(--revue-green)] bg-[rgba(95,186,125,0.05)]">
        {line}
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="text-[var(--revue-red)] bg-[rgba(224,108,96,0.05)]">
        {line}
      </div>
    );
  }
  if (line.startsWith("@@")) {
    return <div className="text-[var(--revue-text-dim)]">{line}</div>;
  }
  if (line.startsWith("diff --git")) {
    return (
      <div className="text-[var(--revue-cyan)] opacity-50 mt-2">{line}</div>
    );
  }
  return <div className="text-[var(--revue-text)]">{line}</div>;
}

export default function FlashCard({
  summary,
  files,
  diff,
  lines,
  category,
  index,
  total,
}: FlashCardProps) {
  const label = categoryLabels[category] || category.toUpperCase();
  const diffLines = diff.split("\n");

  return (
    <div
      className="w-full max-w-4xl mx-auto px-6"
      style={{ animation: "bin-reveal 0.3s ease-out" }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6 pb-3 border-b border-[var(--revue-border)]">
        <div className="flex items-center gap-4">
          <span className="text-[var(--revue-cyan)] text-xs tracking-[0.3em] uppercase">
            Bin {String(index + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
          </span>
          <span className="text-[var(--revue-text-dim)] text-xs">
            {lines} units
          </span>
        </div>
        <span className="text-xs tracking-[0.2em] text-[var(--revue-text-dim)] uppercase border border-[var(--revue-border)] px-3 py-1">
          {label}
        </span>
      </div>

      {/* Summary — the "data" you're refining */}
      <h2
        className="text-lg text-[var(--revue-white)] font-normal mb-1 leading-relaxed"
        style={{ animation: "glow-pulse 4s ease-in-out infinite" }}
      >
        {summary}
      </h2>
      <p className="text-[var(--revue-text-dim)] text-xs tracking-wider mb-6">
        {files}
      </p>

      {/* Diff bin */}
      <div className="bg-[var(--revue-panel)] border border-[var(--revue-border)] p-4 overflow-auto max-h-[55vh]">
        <pre className="text-sm leading-relaxed">
          {diffLines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      </div>
    </div>
  );
}
