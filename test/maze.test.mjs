import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, verifyMaze, toSvg, toAscii, toGridRows } from '../dist/maze.js';
import { GEOMETRIC_SHAPES, geometricMask, countryShapes, countryMask, findCountry } from '../dist/shapes.js';
import { searchPrintableMazes, printableThemes } from '../dist/catalog.js';

test('every geometric shape gives a perfect, solvable maze', () => {
  for (const shape of GEOMETRIC_SHAPES) {
    for (const size of [5, 20, 60]) {
      const maze = generateMaze(geometricMask(shape, size, size), 42);
      const check = verifyMaze(maze);
      assert.ok(check.perfect && check.solutionValid, `${shape} ${size}`);
      assert.ok(maze.solution.length > 0, `${shape} ${size} has a path`);
    }
  }
});

test('every country gives a perfect, solvable maze at small and full size', () => {
  const all = countryShapes();
  assert.ok(all.length > 200);
  for (const country of all) {
    for (const size of [20, undefined]) {
      const maze = generateMaze(countryMask(country, size), 7);
      const check = verifyMaze(maze);
      assert.ok(check.perfect && check.solutionValid, `${country.id} ${size ?? 'full'}`);
    }
  }
});

test('same seed, same maze', () => {
  const a = generateMaze(geometricMask('heart', 25, 25), 123);
  const b = generateMaze(geometricMask('heart', 25, 25), 123);
  assert.deepEqual(toGridRows(a), toGridRows(b));
  assert.equal(a.solution, b.solution);
});

test('country lookup by name, code and alias', () => {
  for (const [q, id] of [['Italy', 'italy'], ['JP', 'japan'], ['usa', 'united-states-of-america'], ['UK', 'united-kingdom'], ['China', 'china'], ['Taiwan', 'china'], ['Hong Kong', 'china'], ['Côte d’Ivoire', 'ivory-coast'], ['DEU', 'germany'], ['brazil', 'brazil']]) {
    assert.equal(findCountry(q)?.id, id, q);
  }
  assert.equal(findCountry('Atlantis'), undefined);
});

test('renderers produce output', () => {
  const maze = generateMaze(geometricMask('rectangle', 8, 6), 1);
  const svg = toSvg(maze, { showSolution: true, title: 'x' });
  assert.match(svg, /^<svg[^>]+viewBox/);
  assert.match(svg, /<polyline/);
  const ascii = toAscii(maze, true);
  assert.equal(ascii.split('\n').length, 6 * 2 + 1);
  assert.match(ascii, /S/);
  assert.match(ascii, /E/);
});

test('printable catalog search', () => {
  assert.ok(printableThemes().length > 20);
  const dino = searchPrintableMazes('dinosaur', undefined, 5);
  assert.ok(dino.length > 0 && dino.every(d => d.url.startsWith('https://mazediy.com/')));
  assert.ok(searchPrintableMazes('Texas')[0].name === 'Texas');
});
