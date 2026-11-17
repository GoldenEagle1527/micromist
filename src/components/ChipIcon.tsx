export function ChipIcon({ className = "chip-ic" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <g className="ic-pads">
        <rect x="10.2" y="3.6" width="2.6" height="4.2" rx="0.4" />
        <rect x="14.7" y="3.6" width="2.6" height="4.2" rx="0.4" />
        <rect x="19.2" y="3.6" width="2.6" height="4.2" rx="0.4" />
        <rect x="10.2" y="24.2" width="2.6" height="4.2" rx="0.4" />
        <rect x="14.7" y="24.2" width="2.6" height="4.2" rx="0.4" />
        <rect x="19.2" y="24.2" width="2.6" height="4.2" rx="0.4" />
        <rect x="3.6" y="10.2" width="4.2" height="2.6" rx="0.4" />
        <rect x="3.6" y="14.7" width="4.2" height="2.6" rx="0.4" />
        <rect x="3.6" y="19.2" width="4.2" height="2.6" rx="0.4" />
        <rect x="24.2" y="10.2" width="4.2" height="2.6" rx="0.4" />
        <rect x="24.2" y="14.7" width="4.2" height="2.6" rx="0.4" />
        <rect x="24.2" y="19.2" width="4.2" height="2.6" rx="0.4" />
      </g>
      <rect className="ic-body" x="7" y="7" width="18" height="18" rx="2.4" />
      <rect className="ic-die" x="12.2" y="12.2" width="7.6" height="7.6" rx="1" />
      <circle className="ic-dot" cx="10.4" cy="10.4" r="1.05" />
    </svg>
  );
}

export function CardFx() {
  return (
    <span className="fx" aria-hidden="true">
      <i className="c tl" />
      <i className="c tr" />
      <i className="c bl" />
      <i className="c br" />
      <svg
        className="traces"
        viewBox="0 0 400 220"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path d="M62 34 H292" fill="none" />
        <path d="M292 34 V68 H348" fill="none" />
        <path d="M112 34 V14" fill="none" />
        <circle cx="148" cy="34" r="2" />
        <circle cx="220" cy="34" r="2" />
        <circle cx="292" cy="34" r="2" />
        <circle cx="348" cy="68" r="2" />
      </svg>
    </span>
  );
}
