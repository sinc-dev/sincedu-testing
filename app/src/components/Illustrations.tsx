// On-theme inline SVG illustrations (no external assets). Colors pull from the
// theme CSS variables so they stay in sync with the palette.

export function HeroPicker({ className }: { className?: string }) {
  return (
    <svg className={className} width="360" height="232" viewBox="0 0 360 232" fill="none" role="img" aria-label="Picking an element on a page">
      {/* browser window */}
      <rect x="8" y="14" width="344" height="204" rx="14" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M8 40 h344" stroke="var(--border)" strokeWidth="2" />
      <circle cx="30" cy="27" r="3.5" fill="var(--border)" />
      <circle cx="44" cy="27" r="3.5" fill="var(--border)" />
      <circle cx="58" cy="27" r="3.5" fill="var(--border)" />
      <rect x="84" y="21" width="220" height="12" rx="6" fill="var(--muted)" />

      {/* page content skeleton */}
      <rect x="28" y="60" width="150" height="12" rx="6" fill="var(--muted)" />
      <rect x="28" y="82" width="300" height="8" rx="4" fill="var(--muted)" />
      <rect x="28" y="98" width="280" height="8" rx="4" fill="var(--muted)" />

      {/* highlighted (picked) element */}
      <rect x="26" y="126" width="200" height="64" rx="10" fill="var(--accent)" fillOpacity="0.35" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="6 5" />
      <rect x="40" y="142" width="90" height="10" rx="5" fill="var(--primary)" fillOpacity="0.55" />
      <rect x="40" y="160" width="150" height="8" rx="4" fill="var(--primary)" fillOpacity="0.3" />

      {/* crosshair on the element */}
      <g stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="226" cy="190" r="11" fill="var(--card)" />
        <circle cx="226" cy="190" r="3.5" fill="var(--primary)" stroke="none" />
        <path d="M226 173 v6 M226 201 v6 M209 190 h6 M243 190 h6" />
      </g>

      {/* note popover at the cursor */}
      <g>
        <rect x="238" y="120" width="104" height="74" rx="10" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
        <rect x="250" y="132" width="64" height="7" rx="3.5" fill="var(--muted-foreground)" fillOpacity="0.5" />
        <rect x="250" y="146" width="80" height="20" rx="6" fill="var(--muted)" />
        <rect x="296" y="172" width="34" height="13" rx="6.5" fill="var(--primary)" />
      </g>
    </svg>
  );
}

function StepFrame({ children }: { children: React.ReactNode }) {
  return (
    <span className="step-icon" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

export function IconPick() {
  return (
    <StepFrame>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
    </StepFrame>
  );
}

export function IconNote() {
  return (
    <StepFrame>
      <path d="M4 5h16v11H9l-4 4v-4H4z" />
      <path d="M8 9h8M8 12.5h5" />
    </StepFrame>
  );
}

export function IconCapture() {
  return (
    <StepFrame>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <circle cx="12" cy="12.5" r="3" />
      <path d="M8 6l1.5-2h5L16 6" />
    </StepFrame>
  );
}

export function IconReview() {
  return (
    <StepFrame>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </StepFrame>
  );
}

export function EmptyReports({ className }: { className?: string }) {
  return (
    <svg className={className} width="120" height="100" viewBox="0 0 120 100" fill="none" role="img" aria-label="No reports yet">
      <rect x="22" y="16" width="76" height="60" rx="10" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M22 32 h76" stroke="var(--border)" strokeWidth="2" />
      <rect x="34" y="44" width="40" height="7" rx="3.5" fill="var(--muted)" />
      <rect x="34" y="58" width="52" height="6" rx="3" fill="var(--muted)" />
      <g stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="86" cy="70" r="10" fill="var(--card)" />
        <circle cx="86" cy="70" r="3" fill="var(--primary)" stroke="none" />
        <path d="M86 55 v5 M86 80 v5 M71 70 h5 M101 70 h5" />
      </g>
    </svg>
  );
}
