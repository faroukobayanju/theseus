export function SplitKeelMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#111827" />
      <path d="M10 16H29V24H14L10 16Z" fill="#F59E0B" />
      <path d="M16 28H29V36H20L16 28Z" fill="#F59E0B" />
      <path d="M35 16H54L44 36H35V16Z" fill="#22D3EE" />
      <path d="M23 41H41L32 53L23 41Z" fill="#10B981" />
    </svg>
  );
}
