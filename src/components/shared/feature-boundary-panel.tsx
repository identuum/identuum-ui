interface FeatureBoundaryPanelProps {
  title: string;
  body: string;
  tone?: "neutral" | "warning" | "error";
}

const toneClasses = {
  neutral: "border-stone-200 text-stone-700",
  warning: "border-amber-200 text-amber-700",
  error: "border-red-100 text-red-700",
} as const;

export function FeatureBoundaryPanel({ title, body, tone = "neutral" }: FeatureBoundaryPanelProps) {
  return (
    <div className={`rounded-[1.5rem] border bg-white px-6 py-6 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">{body}</p>
    </div>
  );
}
