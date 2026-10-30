type BrandMarkProps = { className?: string; decorative?: boolean };

export function BrandMark({ className, decorative = false }: BrandMarkProps) {
  const a11y = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Orion Terminal" };
  return (
    <svg className={className} viewBox="-118 -66 236 132" fill="currentColor" {...a11y}>
      <path fillRule="evenodd" d="M-55-56H55L81-30V30L55 56H-55L-81 30V-30ZM-45.5-28V28H45.5V-28Z" />
      <path d="M-118-66h33v33h-33Z" />
      <path d="M85 33h33v33h-33Z" />
    </svg>
  );
}
