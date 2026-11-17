import { readFileSync } from 'node:fs';

export interface PrintableMaze {
  name: string;
  theme: string;
  keyword: string;
  url: string;
  image_url: string;
  solution_image_url: string | null;
}

let items: PrintableMaze[] | undefined;

export function printableMazes(): PrintableMaze[] {
  items ??= (JSON.parse(readFileSync(new URL('../data/printable-mazes.json', import.meta.url), 'utf8')) as {
    items: PrintableMaze[];
  }).items;
  return items;
}

export function printableThemes(): Array<{ theme: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of printableMazes()) counts.set(item.theme, (counts.get(item.theme) ?? 0) + 1);
  return [...counts].map(([theme, count]) => ({ theme, count })).sort((a, b) => a.theme.localeCompare(b.theme));
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w && w !== 'maze' && w !== 'mazes');

/** Rank by how many query words appear in the name, keyword or theme. */
export function searchPrintableMazes(query: string, theme?: string, limit = 10): PrintableMaze[] {
  const q = words(query);
  const scored = printableMazes()
    .filter(item => !theme || item.theme.toLowerCase().includes(theme.toLowerCase()))
    .map(item => {
      const name = words(item.name), keyword = words(item.keyword), themeWords = words(item.theme);
      let score = 0;
      for (const w of q) {
        const stem = w.replace(/s$/, '');
        if (name.some(n => n === w || n.replace(/s$/, '') === stem)) score += 3;
        else if (keyword.some(k => k.replace(/s$/, '') === stem)) score += 2;
        else if (themeWords.some(t => t.replace(/s$/, '') === stem)) score += 1;
      }
      return { item, score };
    })
    .filter(r => q.length === 0 || r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map(r => r.item);
}
