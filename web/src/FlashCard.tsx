interface FlashCardProps {
  summary: string;
  files: string;
  diff: string;
  lines: number;
  category: string;
  index: number;
  total: number;
}

const categoryColors: Record<string, string> = {
  feature: "text-green-400 bg-green-400/10 border-green-400/30",
  fix: "text-red-400 bg-red-400/10 border-red-400/30",
  refactor: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  test: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  config: "text-purple-400 bg-purple-400/10 border-purple-400/30",
  docs: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
  chore: "text-neutral-400 bg-neutral-400/10 border-neutral-400/30",
};

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+")) {
    return <div className="text-green-400 bg-green-400/5">{line}</div>;
  }
  if (line.startsWith("-")) {
    return <div className="text-red-400 bg-red-400/5">{line}</div>;
  }
  if (line.startsWith("@@")) {
    return <div className="text-cyan-400/60">{line}</div>;
  }
  if (line.startsWith("diff --git")) {
    return <div className="text-neutral-500 font-bold mt-2">{line}</div>;
  }
  return <div className="text-neutral-400">{line}</div>;
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
  const colorClass =
    categoryColors[category] ||
    "text-neutral-400 bg-neutral-400/10 border-neutral-400/30";
  const diffLines = diff.split("\n");

  return (
    <div className="w-full max-w-4xl mx-auto px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-neutral-500 text-sm">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded border ${colorClass}`}
          >
            {category}
          </span>
          <span className="text-neutral-500 text-xs">{lines} lines</span>
        </div>
      </div>

      {/* Summary */}
      <h2 className="text-xl text-white font-medium mb-2">{summary}</h2>
      <p className="text-neutral-500 text-sm mb-6">{files}</p>

      {/* Diff */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 overflow-auto max-h-[60vh]">
        <pre className="text-sm leading-relaxed">
          {diffLines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      </div>
    </div>
  );
}
