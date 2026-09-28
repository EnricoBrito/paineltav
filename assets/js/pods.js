/* ==========================================================
   PodArt — gera a ilustração (SVG, fundo transparente) de cada
   produto quando o campo "imagem" do JSON estiver vazio.
   Modelos: slim · box · tela · caneta · frasco
   ========================================================== */
window.PodArt = (function () {
  'use strict';

  const FONT = "'Arial Black','Helvetica Neue',Arial,sans-serif";
  const cache = new Map();

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hex2rgb(h) {
    h = String(h || '#8b2cf5').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  const dark = (c, t) => mix(c, '#000000', t);
  const light = (c, t) => mix(c, '#ffffff', t);

  // pseudo-aleatório estável por produto (mesmo desenho sempre)
  function rng(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507), h = Math.imul(h ^ (h >>> 13), 3266489909), (h ^= h >>> 16) >>> 0) / 4294967296);
  }

  // texto que nunca estoura a largura disponível
  function fitText(str, { x, y, size, max, weight = 900, spacing = 0, fill = '#fff', opacity = 1, anchor = 'middle', transform = '' }) {
    const s = esc(str);
    const est = str.length * (size * 0.7 + spacing);
    const fit = est > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '';
    const tr = transform ? ` transform="${transform}"` : '';
    return `<text x="${x}" y="${y}"${tr} text-anchor="${anchor}" font-family="${FONT}" font-weight="${weight}" font-size="${size}" letter-spacing="${spacing}" fill="${fill}" fill-opacity="${opacity}"${fit}>${s}</text>`;
  }

  function defs(c1, c2) {
    return `<defs>
      <linearGradient id="gb" x1="0" x2="1">
        <stop offset="0" stop-color="#030205"/><stop offset=".12" stop-color="#2d2836"/>
        <stop offset=".24" stop-color="#131118"/><stop offset=".62" stop-color="#0b0a0f"/>
        <stop offset=".86" stop-color="#27222f"/><stop offset="1" stop-color="#040306"/>
      </linearGradient>
      <linearGradient id="gc" x1="0" y1="0" x2=".35" y2="1">
        <stop offset="0" stop-color="${light(c2, 0.1)}"/><stop offset=".42" stop-color="${c1}"/>
        <stop offset="1" stop-color="${dark(c1, 0.6)}"/>
      </linearGradient>
      <linearGradient id="gs" x1="0" x2="1">
        <stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".16" stop-color="#fff" stop-opacity=".22"/>
        <stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity=".1"/>
        <stop offset="1" stop-color="#000" stop-opacity=".65"/>
      </linearGradient>
      <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff" stop-opacity=".6"/>
        <stop offset=".8" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gm" x1="0" x2="1">
        <stop offset="0" stop-color="#3a3642"/><stop offset=".2" stop-color="#e9e4f2"/>
        <stop offset=".45" stop-color="#8d8799"/><stop offset=".8" stop-color="#d7d1e2"/><stop offset="1" stop-color="#2b2831"/>
      </linearGradient>
      <filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>
      <filter id="bl2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>`;
  }

  // estrelinhas/brilhos decorativos
  function sparks(r, n, box, color) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = box.x + r() * box.w, y = box.y + r() * box.h, s = 3 + r() * 6, o = 0.35 + r() * 0.5;
      out += `<path d="M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28}Z" fill="${color}" fill-opacity="${o.toFixed(2)}"/>`;
    }
    return out;
  }

  /* ---------- modelos ---------- */

  function slim(p, brand, c1, c2, r) {
    const body = 'M72 140 Q72 110 102 110 H138 Q168 110 168 140 V420 Q168 450 138 450 H102 Q72 450 72 420 Z';
    const curve = 'M126 110 C112 200 136 300 118 450';
    return `
      <path d="M96 26 Q96 16 108 16 H132 Q144 16 144 26 L152 102 Q152 108 146 108 H94 Q88 108 88 102 Z" fill="url(#gb)"/>
      <rect x="101" y="22" width="6" height="78" rx="3" fill="url(#gh)" opacity=".4"/>
      <rect x="84" y="104" width="72" height="9" rx="3" fill="#1d1924"/>
      <clipPath id="cb"><path d="${body}"/></clipPath>
      <path d="${body}" fill="url(#gb)"/>
      <g clip-path="url(#cb)">
        <path d="M60 110 H126 C112 200 136 300 118 450 H60 Z" fill="url(#gc)"/>
        ${sparks(r, 7, { x: 80, y: 150, w: 32, h: 260 }, light(c2, 0.55))}
        <path d="${curve}" stroke="${c2}" stroke-width="7" fill="none" opacity=".7" filter="url(#bl)"/>
        <path d="${curve}" stroke="${light(c2, 0.4)}" stroke-width="1.6" fill="none"/>
        <rect x="60" y="100" width="120" height="360" fill="url(#gs)"/>
      </g>
      ${fitText(brand.toUpperCase(), { x: 0, y: 0, size: 19, max: 250, spacing: 4, opacity: 0.92, transform: 'translate(152 282) rotate(-90)' })}
      <rect x="80" y="128" width="7" height="300" rx="3.5" fill="url(#gh)" opacity=".45"/>
      <rect x="163.5" y="136" width="2.4" height="280" rx="1.2" fill="${c2}" opacity=".6"/>
      <rect x="104" y="438" width="32" height="4" rx="2" fill="${c2}" filter="url(#bl)"/>
      <rect x="106" y="439" width="28" height="2.4" rx="1.2" fill="${light(c2, 0.5)}"/>`;
  }

  function box(p, brand, c1, c2, r, withScreen) {
    const body = 'M52 148 Q52 112 88 112 H152 Q188 112 188 148 V406 Q188 442 152 442 H88 Q52 442 52 406 Z';
    const wave = 'M40 318 C90 296 140 346 200 306';
    const screen = withScreen ? `
      <rect x="86" y="352" width="68" height="44" rx="10" fill="#030305" stroke="${c2}" stroke-opacity=".6" stroke-width="1.4"/>
      <rect x="96" y="364" width="24" height="12" rx="3" fill="none" stroke="${c2}" stroke-width="1.6"/>
      <rect x="120" y="367.5" width="2.5" height="5" rx="1" fill="${c2}"/>
      <rect x="98.5" y="366.5" width="16" height="7" rx="1.5" fill="${c2}"/>
      <text x="128" y="375" font-family="${FONT}" font-weight="900" font-size="11" fill="${light(c2, 0.35)}">98%</text>
      <g fill="${c1}">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${97 + i * 8}" y="383" width="5" height="4" rx="1" opacity="${i < 5 ? 1 : 0.3}"/>`).join('')}</g>
      <rect x="86" y="352" width="68" height="44" rx="10" fill="${c2}" opacity=".12" filter="url(#bl)"/>` : `
      <circle cx="120" cy="392" r="5" fill="${c2}" filter="url(#bl)"/><circle cx="120" cy="392" r="2.4" fill="${light(c2, 0.6)}"/>`;
    return `
      <path d="M102 52 Q102 40 114 40 H126 Q138 40 138 52 L145 110 H95 Z" fill="url(#gb)"/>
      <rect x="106" y="46" width="5" height="58" rx="2.5" fill="url(#gh)" opacity=".35"/>
      <rect x="88" y="104" width="64" height="10" rx="4" fill="#1b1720"/>
      <clipPath id="cb"><path d="${body}"/></clipPath>
      <g clip-path="url(#cb)">
        <rect x="40" y="100" width="160" height="360" fill="url(#gc)"/>
        ${[0, 1, 2, 3].map(() => `<circle cx="${60 + r() * 120}" cy="${210 + r() * 90}" r="${8 + r() * 22}" fill="#fff" fill-opacity="${(0.05 + r() * 0.08).toFixed(2)}"/>`).join('')}
        ${sparks(r, 5, { x: 64, y: 216, w: 110, h: 80 }, '#ffffff')}
        <path d="${wave} V460 H40 Z" fill="#09070d"/>
        <path d="${wave}" stroke="${c2}" stroke-width="8" fill="none" opacity=".75" filter="url(#bl)"/>
        <path d="${wave}" stroke="${light(c2, 0.45)}" stroke-width="1.8" fill="none"/>
        ${screen}
        <rect x="40" y="100" width="160" height="360" fill="url(#gs)"/>
      </g>
      ${fitText(brand.toUpperCase(), { x: 120, y: 178, size: 22, max: 116, spacing: 1.5 })}
      ${fitText(String(p.info || '').toUpperCase(), { x: 120, y: 198, size: 9, max: 104, weight: 700, spacing: 2.5, opacity: 0.85 })}
      <rect x="61" y="128" width="7" height="292" rx="3.5" fill="url(#gh)" opacity=".42"/>
      <rect x="183" y="132" width="2.4" height="284" rx="1.2" fill="${c2}" opacity=".5"/>`;
  }

  function caneta(p, brand, c1, c2, r) {
    const body = 'M94 118 Q94 92 120 92 Q146 92 146 118 V422 Q146 448 120 448 Q94 448 94 422 Z';
    return `
      <path d="M106 30 Q106 18 120 18 Q134 18 134 30 L139 96 H101 Z" fill="url(#gb)"/>
      <rect x="110" y="26" width="4.5" height="64" rx="2.2" fill="url(#gh)" opacity=".4"/>
      <clipPath id="cb"><path d="${body}"/></clipPath>
      <path d="${body}" fill="url(#gb)"/>
      <g clip-path="url(#cb)">
        <rect x="90" y="152" width="60" height="196" fill="url(#gc)"/>
        ${sparks(r, 4, { x: 100, y: 170, w: 40, h: 160 }, light(c2, 0.6))}
        <rect x="90" y="146" width="60" height="7" fill="url(#gm)"/>
        <rect x="90" y="347" width="60" height="7" fill="url(#gm)"/>
        <rect x="90" y="414" width="60" height="6" fill="${c2}" filter="url(#bl)"/>
        <rect x="90" y="415.5" width="60" height="3" fill="${light(c2, 0.5)}"/>
        <rect x="90" y="90" width="60" height="360" fill="url(#gs)"/>
      </g>
      ${fitText(brand.toUpperCase(), { x: 0, y: 0, size: 16, max: 180, spacing: 3, transform: 'translate(126 250) rotate(-90)' })}
      <rect x="100" y="112" width="5" height="318" rx="2.5" fill="url(#gh)" opacity=".5"/>`;
  }

  function frasco(p, brand, c1, c2, r) {
    const bottle = 'M104 162 H136 Q176 170 176 206 V430 Q176 452 154 452 H86 Q64 452 64 430 V206 Q64 170 104 162 Z';
    return `
      <path d="M112 24 Q112 14 120 14 Q128 14 128 24 L131 54 H109 Z" fill="url(#gb)"/>
      <rect x="94" y="50" width="52" height="92" rx="10" fill="url(#gb)"/>
      ${Array.from({ length: 8 }, (_, i) => `<rect x="${99 + i * 6}" y="56" width="1.6" height="80" fill="#fff" opacity=".07"/>`).join('')}
      <rect x="98" y="56" width="5" height="78" rx="2.5" fill="url(#gh)" opacity=".4"/>
      <rect x="90" y="136" width="60" height="14" rx="4" fill="#211b29"/>
      <rect x="104" y="150" width="32" height="14" fill="#15111b"/>
      <clipPath id="cb"><path d="${bottle}"/></clipPath>
      <path d="${bottle}" fill="#0c0911"/>
      <g clip-path="url(#cb)">
        <rect x="60" y="196" width="120" height="260" fill="${c1}" opacity=".32"/>
        <rect x="60" y="196" width="120" height="3" fill="${light(c2, 0.4)}" opacity=".7"/>
        <rect x="60" y="232" width="120" height="184" fill="url(#gc)"/>
        ${sparks(r, 5, { x: 76, y: 330, w: 88, h: 40 }, '#ffffff')}
        <rect x="60" y="232" width="120" height="2" fill="#fff" opacity=".35"/>
        <rect x="60" y="414" width="120" height="2" fill="#000" opacity=".4"/>
        <rect x="60" y="150" width="120" height="310" fill="url(#gs)"/>
      </g>
      ${fitText(brand.toUpperCase(), { x: 120, y: 274, size: 16, max: 94, spacing: 1 })}
      <rect x="92" y="286" width="56" height="1.6" fill="#fff" opacity=".55"/>
      ${fitText(String(p.sabor || '').toUpperCase(), { x: 120, y: 312, size: 12, max: 96, weight: 800, spacing: 1.2 })}
      ${fitText(String(p.info || '').toUpperCase(), { x: 120, y: 402, size: 8.5, max: 90, weight: 700, spacing: 2, opacity: 0.85 })}
      <rect x="72" y="212" width="6" height="220" rx="3" fill="url(#gh)" opacity=".5"/>
      <rect x="171" y="214" width="2" height="212" rx="1" fill="${c2}" opacity=".5"/>`;
  }

  function svg(p, brandName) {
    const c1 = p.cor || '#8b2cf5';
    const c2 = p.cor2 || light(c1, 0.35);
    const r = rng(p.id || p.sabor || 'x');
    const brand = brandName || p.marca || '';
    let inner;
    switch (p.modelo) {
      case 'box': inner = box(p, brand, c1, c2, r, false); break;
      case 'tela': inner = box(p, brand, c1, c2, r, true); break;
      case 'caneta': inner = caneta(p, brand, c1, c2, r); break;
      case 'frasco': inner = frasco(p, brand, c1, c2, r); break;
      default: inner = slim(p, brand, c1, c2, r);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 480" width="240" height="480">${defs(c1, c2)}${inner}</svg>`;
  }

  function src(p, brandName) {
    if (p.imagem) return p.imagem;
    const key = p.id + '|' + brandName;
    if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(p, brandName)));
    return cache.get(key);
  }

  return { svg, src, mix, light, dark };
})();
