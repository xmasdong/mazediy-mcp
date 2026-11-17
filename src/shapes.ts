import { readFileSync } from 'node:fs';
import type { Mask } from './maze.js';

export const GEOMETRIC_SHAPES = ['rectangle', 'circle', 'heart', 'star', 'diamond', 'triangle', 'hexagon'] as const;
export type GeometricShape = (typeof GEOMETRIC_SHAPES)[number];

export interface CountryShape {
  id: string;
  name: string;
  iso_a2: string | null;
  iso_a3: string;
  continent: string;
  width: number;
  height: number;
  cells: number;
  rows: string[];
}

let countries: CountryShape[] | undefined;

export function countryShapes(): CountryShape[] {
  countries ??= (JSON.parse(readFileSync(new URL('../data/country-shapes.json', import.meta.url), 'utf8')) as {
    countries: CountryShape[];
  }).countries;
  return countries;
}

const normalize = (s: string) => s.normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();

const ALIASES: Record<string, string> = {
  usa: 'united-states-of-america',
  us: 'united-states-of-america',
  unitedstates: 'united-states-of-america',
  america: 'united-states-of-america',
  uk: 'united-kingdom',
  britain: 'united-kingdom',
  greatbritain: 'united-kingdom',
  england: 'united-kingdom',
  holland: 'netherlands',
  southkorea: 'south-korea',
  korea: 'south-korea',
  northkorea: 'north-korea',
  czechia: 'czech-republic',
  ivorycoast: 'ivory-coast',
  cotedivoire: 'ivory-coast',
  drc: 'democratic-republic-of-the-congo',
  uae: 'united-arab-emirates',
  prc: 'china',
  peoplesrepublicofchina: 'china',
  // Taiwan, Hong Kong and Macau are part of China's outline.
  taiwan: 'china',
  tw: 'china',
  hongkong: 'china',
  hk: 'china',
  macau: 'china',
  macao: 'china',
  mo: 'china',
};

/** Match a country by id, name, ISO code or common alias. */
export function findCountry(query: string): CountryShape | undefined {
  const all = countryShapes();
  const q = normalize(query);
  const alias = ALIASES[q];
  return (
    all.find(c => c.id === (alias ?? query.toLowerCase())) ??
    all.find(c => normalize(c.name) === q || normalize(c.id) === q) ??
    all.find(c => c.iso_a2 && c.iso_a2.toLowerCase() === q) ??
    all.find(c => c.iso_a3.toLowerCase() === q) ??
    all.find(c => normalize(c.name).startsWith(q)) ??
    (q.length >= 4 ? all.find(c => normalize(c.name).includes(q)) : undefined)
  );
}

export function searchCountries(query?: string, continent?: string) {
  const q = query ? normalize(query) : '';
  return countryShapes()
    .filter(c => !continent || c.continent.toLowerCase() === continent.toLowerCase())
    .filter(c => !q || normalize(c.name).includes(q) || normalize(c.id).includes(q) || c.iso_a2?.toLowerCase() === q || c.iso_a3.toLowerCase() === q)
    .map(c => ({ id: c.id, name: c.name, iso_a2: c.iso_a2, continent: c.continent }));
}

function decodeRows(shape: CountryShape): Mask {
  const cells = new Array<boolean>(shape.width * shape.height).fill(false);
  shape.rows.forEach((row, y) => {
    let x = 0, inside = false;
    for (const run of row.split('.').map(Number)) {
      if (inside) for (let i = 0; i < run; i++) cells[y * shape.width + x + i] = true;
      x += run;
      inside = !inside;
    }
  });
  return { width: shape.width, height: shape.height, cells };
}

/**
 * Resample a mask so its longer side has `size` cells. When shrinking, a cell
 * is inside if any source cell under it is, so one-cell causeways to islands
 * survive; when enlarging, cell centres are sampled.
 */
export function resizeMask(mask: Mask, size: number): Mask {
  const scale = size / Math.max(mask.width, mask.height);
  if (Math.abs(scale - 1) < 1e-9) return mask;
  const width = Math.max(1, Math.round(mask.width * scale));
  const height = Math.max(1, Math.round(mask.height * scale));
  const cells = new Array<boolean>(width * height).fill(false);
  if (scale < 1) {
    for (let sy = 0; sy < mask.height; sy++) {
      for (let sx = 0; sx < mask.width; sx++) {
        if (!mask.cells[sy * mask.width + sx]) continue;
        const x = Math.min(width - 1, Math.floor((sx + 0.5) * scale));
        const y = Math.min(height - 1, Math.floor((sy + 0.5) * scale));
        cells[y * width + x] = true;
      }
    }
    return { width, height, cells };
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x + 0.5) / scale));
      const sy = Math.min(mask.height - 1, Math.floor((y + 0.5) / scale));
      cells[y * width + x] = mask.cells[sy * mask.width + sx];
    }
  }
  return { width, height, cells };
}

export function countryMask(shape: CountryShape, size?: number): Mask {
  const mask = decodeRows(shape);
  return size ? resizeMask(mask, size) : mask;
}

// Five-pointed star: outer tips at radius 1, inner corners at 0.42, top tip up.
const STAR: Array<[number, number]> = Array.from({ length: 10 }, (_, k) => {
  const angle = -Math.PI / 2 + (k * Math.PI) / 5;
  const r = k % 2 === 0 ? 1 : 0.42;
  return [r * Math.cos(angle), r * Math.sin(angle) + 0.1];
});

function inPolygon(points: Array<[number, number]>, u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inside(shape: GeometricShape, u: number, v: number): boolean {
  // u, v in [-1, 1], y pointing down.
  switch (shape) {
    case 'rectangle':
      return true;
    case 'circle':
      return u * u + v * v <= 1;
    case 'diamond':
      return Math.abs(u) + Math.abs(v) <= 1;
    case 'triangle':
      return v >= -1 && Math.abs(u) <= (v + 1) / 2;
    case 'hexagon':
      return Math.abs(v) <= 0.866 && Math.abs(u) * 0.866 + Math.abs(v) * 0.5 <= 0.866;
    case 'heart': {
      const x = u * 1.2, y = -v * 1.2 + 0.25;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    }
    case 'star':
      return inPolygon(STAR, u, v);
  }
}

export function geometricMask(shape: GeometricShape, width: number, height: number): Mask {
  const cells = new Array<boolean>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) / width) * 2 - 1;
      const v = ((y + 0.5) / height) * 2 - 1;
      cells[y * width + x] = inside(shape, u, v);
    }
  }
  return { width, height, cells };
}
