/* Tool illustrations (static, shipped with the site — safe to inject). */
'use strict';

const NPI_ICONS = (() => {
  const P = {
    screwdriver: `<rect x="46" y="8" width="8" height="46" rx="2" fill="#C7CCD1" stroke="#15171A" stroke-width="2"/>
      <rect x="46" y="8" width="3" height="46" fill="#fff" opacity=".45"/>
      <path d="M50 8 L44 2 L56 2 Z" fill="#8A9199" stroke="#15171A" stroke-width="1.5"/>
      <rect x="34" y="52" width="32" height="34" rx="6" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      <rect x="34" y="52" width="32" height="10" rx="4" fill="#FFC72C"/>
      <path d="M41 66v16M50 66v16M59 66v16" stroke="#15171A" stroke-width="1.4" opacity=".35"/>`,
    hammer: `<rect x="45" y="30" width="10" height="60" rx="4" fill="#8A9199" stroke="#15171A" stroke-width="2"/>
      <rect x="45" y="30" width="4" height="60" fill="#C7CCD1"/>
      <rect x="44" y="64" width="12" height="26" rx="4" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <path d="M20 14 h60 v20 h-24 v10 h-12 v-10 h-24 z" fill="#15171A" stroke="#15171A" stroke-width="2"/>
      <rect x="20" y="14" width="60" height="7" fill="#3a3d40"/>
      <circle cx="50" cy="24" r="3" fill="#FFC72C"/>`,
    wrench: `<path d="M25 20 a15 15 0 1 0 12 24 l30 30 8 -8 -30 -30 a15 15 0 0 0 -20 -16z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      <circle cx="30" cy="30" r="6" fill="#15171A"/>
      <rect x="60" y="60" width="14" height="14" transform="rotate(45 67 67)" fill="#FFC72C" stroke="#15171A" stroke-width="1.5"/>`,
    tape: `<rect x="18" y="22" width="48" height="48" rx="9" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <circle cx="42" cy="46" r="15" fill="#15171A"/><circle cx="42" cy="46" r="9" fill="#C7CCD1"/>
      <circle cx="42" cy="46" r="3" fill="#15171A"/>
      <rect x="60" y="60" width="32" height="7" rx="1" fill="#C7CCD1" stroke="#15171A" stroke-width="1.5"/>
      <path d="M66 60v3M72 60v4M78 60v3M84 60v4" stroke="#15171A" stroke-width="1"/>`,
    pliers: `<path d="M35 10 L20 45 L28 50 L42 18 Z" fill="#8A9199" stroke="#15171A" stroke-width="2"/>
      <path d="M65 10 L80 45 L72 50 L58 18 Z" fill="#8A9199" stroke="#15171A" stroke-width="2"/>
      <circle cx="50" cy="52" r="7" fill="#15171A"/><circle cx="50" cy="52" r="2.5" fill="#C7CCD1"/>
      <path d="M30 55 L18 88 L28 92 L42 60 Z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      <path d="M70 55 L82 88 L72 92 L58 60 Z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>`,
    knife: `<path d="M12 56 L68 40 L68 52 L18 64 Z" fill="#C7CCD1" stroke="#15171A" stroke-width="2"/>
      <path d="M12 56 L68 40 L68 44 Z" fill="#fff" opacity=".5"/>
      <rect x="66" y="30" width="22" height="36" rx="6" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <rect x="70" y="38" width="14" height="4" fill="#15171A"/><rect x="70" y="47" width="14" height="4" fill="#15171A"/>`,
    level: `<rect x="8" y="42" width="84" height="17" rx="3" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <rect x="8" y="42" width="84" height="4" fill="#C79A1E"/>
      <rect x="40" y="45" width="20" height="11" rx="5" fill="#d9f2b5" stroke="#15171A" stroke-width="1.5"/>
      <circle cx="50" cy="50.5" r="3.4" fill="#7AB51D"/>
      <circle cx="22" cy="50.5" r="5" fill="#fff" stroke="#15171A" stroke-width="1.2"/>
      <circle cx="78" cy="50.5" r="5" fill="#fff" stroke="#15171A" stroke-width="1.2"/>`,
    saw: `<path d="M14 40 L70 40 L70 62 L14 56 Z" fill="#C7CCD1" stroke="#15171A" stroke-width="2"/>
      <path d="M14 56 l4 5 4-4 4 5 4-4 4 5 4-4 4 5 4-4 4 5 4-4 4 5 4-4 4 5 2-3" fill="none" stroke="#15171A" stroke-width="1.5"/>
      <path d="M68 32 h18 a6 6 0 0 1 6 6 v24 a6 6 0 0 1 -6 6 h-18 z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      <rect x="74" y="42" width="12" height="14" rx="5" fill="#15171A"/>`,
    drill: `<rect x="22" y="26" width="52" height="24" rx="8" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <rect x="74" y="32" width="10" height="12" fill="#3a3d40" stroke="#15171A" stroke-width="2"/>
      <path d="M84 36 h12 v4 h-12z" fill="#C7CCD1" stroke="#15171A" stroke-width="1.2"/>
      <path d="M38 50 L34 82 h20 L56 50 Z" fill="#15171A"/>
      <rect x="28" y="80" width="32" height="12" rx="3" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>`,
    chisel: `<path d="M44 8 h12 v50 l-6 8 l-6 -8 z" fill="#C7CCD1" stroke="#15171A" stroke-width="2" transform="rotate(180 50 50)"/>
      <rect x="40" y="10" width="20" height="40" rx="5" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      <rect x="40" y="10" width="20" height="8" rx="4" fill="#FFC72C"/>`
  };
  const KEYS = Object.keys(P);
  const svg = (key, cls = '') => NPI.trusted(
    `<svg class="tool-svg ${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g>${P[key] || P.wrench}</g></svg>`);
  return { svg, KEYS, raw: P };
})();
