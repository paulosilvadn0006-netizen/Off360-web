import React from "react";

// Official OFF 360 assets (never redraw/distort):
// - off360-banner.png : full circular logo (symbol + OFF360 + slogan) — splash/login/register
// - off360-symbol.png : isolated pin+arrow symbol on navy — nav, headers, small spaces
// - off360-icon.png   : symbol on navy square — PWA icon / favicon

export function Symbol({ size = 40, className = "" }) {
  return (
    <img src="/off360-symbol.png" alt="OFF 360" style={{ width: size, height: size }}
      className={`rounded-full object-cover ${className}`} />
  );
}

// Small horizontal lockup: official symbol + "OFF 360" wordmark (safe for reduced spaces)
export function Logo({ size = 36, showText = true, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Symbol size={size} />
      {showText && <span className="font-display text-lg font-extrabold tracking-tight text-white">OFF <span className="off-gradient-text">360</span></span>}
    </div>
  );
}

// Full circular official logo — do not crop or distort
export function BrandMark({ size = 116 }) {
  return (
    <img src="/off360-banner.png" alt="OFF 360 — Conectando você ao que importa" style={{ width: size, height: size }}
      className="rounded-full object-contain shadow-[0_8px_40px_rgba(255,122,0,0.25)]" />
  );
}
