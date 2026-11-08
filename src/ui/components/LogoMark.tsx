import type { SVGProps } from 'react';

// The "Lens" mark (SOW-0026): a magnifier holding a check, for finding openings and verifying them.
// One colour through currentColor so the tile's foreground sets it in both themes; src/ui/favicon.svg
// repeats the same paths on a fixed tile.
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="14" cy="14" r="8.6" strokeWidth="2.6" />
      <path d="M20.6 20.6 26.6 26.6" strokeWidth="3.2" />
      <path d="M10.2 14.3 13 17.1 18.1 11.6" strokeWidth="2.7" />
    </svg>
  );
}
