/** The Plugent logo: the socket mark and the name. Navy drawing on light, light drawing on dark. */
export function Logo({ className = "h-6" }: { className?: string }) {
  return (
    <span className="inline-flex" role="img" aria-label="Plugent">
      {/* biome-ignore lint/performance/noImgElement: a fixed SVG, nothing to optimise */}
      <img src="/logo-navy.svg" alt="" className={`logo-on-light w-auto ${className}`} />
      {/* biome-ignore lint/performance/noImgElement: a fixed SVG, nothing to optimise */}
      <img src="/logo-light.svg" alt="" className={`logo-on-dark w-auto ${className}`} />
    </span>
  );
}
