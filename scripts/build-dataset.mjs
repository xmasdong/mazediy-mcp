// Build data/country-mazes.jsonl: one perfect maze per country outline.
// Seeds are fixed per country so the dataset is reproducible.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { generateMaze, verifyMaze, toGridRows } from '../dist/maze.js';
import { countryShapes, countryMask } from '../dist/shapes.js';

const seedFor = id => createHash('sha256').update(id).digest().readUInt32BE(0) & 0x7fffffff;
const lines = [];
for (const country of countryShapes()) {
  const seed = seedFor(country.id);
  const maze = generateMaze(countryMask(country), seed);
  const check = verifyMaze(maze);
  if (!check.perfect || !check.solutionValid) throw new Error(`${country.id} failed verification`);
  lines.push(JSON.stringify({
    id: `country-${country.id}`,
    type: 'country',
    name: country.name,
    iso_a2: country.iso_a2,
    iso_a3: country.iso_a3,
    continent: country.continent,
    width: maze.width,
    height: maze.height,
    cells: maze.open.filter(v => v >= 0).length,
    seed,
    start: maze.start,
    end: maze.end,
    perfect: true,
    solution_length: maze.solution.length,
    solution: maze.solution,
    grid: toGridRows(maze),
  }));
}
writeFileSync(new URL('../data/country-mazes.jsonl', import.meta.url), lines.join('\n') + '\n');
console.log(`${lines.length} country mazes written`);
