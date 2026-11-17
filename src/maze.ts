/**
 * Perfect-maze generation inside any cell mask, with solving and rendering.
 * A perfect maze has exactly one path between any two cells.
 */

export type Cell = [x: number, y: number];

export interface Mask {
  width: number;
  height: number;
  /** cells[y * width + x] is true when the cell belongs to the shape. */
  cells: boolean[];
}

export interface Maze {
  width: number;
  height: number;
  seed: number;
  /** Open passages per cell: N=1, E=2, S=4, W=8. -1 = outside the shape. */
  open: number[];
  start: Cell;
  end: Cell;
  /** Moves from start to end as a string of N/E/S/W. */
  solution: string;
}

const N = 1, E = 2, S = 4, W = 8;
const DIRS: Array<[bit: number, dx: number, dy: number, letter: string, back: number]> = [
  [N, 0, -1, 'N', S],
  [E, 1, 0, 'E', W],
  [S, 0, 1, 'S', N],
  [W, -1, 0, 'W', E],
];

/** mulberry32: small, fast and identical on every platform for a given seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Keep only the largest 4-connected region so every cell is reachable. */
export function largestRegion(mask: Mask): Mask {
  const { width, height, cells } = mask;
  const region = new Int32Array(cells.length).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || region[i] !== -1) continue;
    let size = 0;
    const stack = [i];
    region[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % width, y = (c - x) / width;
      for (const [, dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (cells[n] && region[n] === -1) { region[n] = id; stack.push(n); }
      }
    }
    if (size > bestSize) { best = id; bestSize = size; }
    id++;
  }
  return { width, height, cells: Array.from(region, r => r === best) };
}

/** Trim empty rows and columns around the shape. */
export function cropMask(mask: Mask): Mask {
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  mask.cells.forEach((inside, i) => {
    if (!inside) return;
    const x = i % mask.width, y = (i - x) / mask.width;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  if (maxX < 0 || (minX === 0 && minY === 0 && maxX === mask.width - 1 && maxY === mask.height - 1)) return mask;
  const width = maxX - minX + 1, height = maxY - minY + 1;
  const cells = new Array<boolean>(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = mask.cells[(y + minY) * mask.width + x + minX];
  return { width, height, cells };
}

function bfs(maze: { width: number; open: number[] }, from: number) {
  const dist = new Int32Array(maze.open.length).fill(-1);
  const prev = new Int32Array(maze.open.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  let far = from;
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    if (dist[c] > dist[far]) far = c;
    const x = c % maze.width, y = (c - x) / maze.width;
    for (const [bit, dx, dy] of DIRS) {
      if (!(maze.open[c] & bit)) continue;
      const n = (y + dy) * maze.width + (x + dx);
      if (dist[n] === -1) { dist[n] = dist[c] + 1; prev[n] = c; queue.push(n); }
    }
  }
  return { far, prev };
}

function pathLetters(width: number, prev: Int32Array, from: number, to: number): string {
  const steps: string[] = [];
  for (let c = to; c !== from; c = prev[c]) {
    const p = prev[c];
    const dx = (c % width) - (p % width), dy = Math.floor(c / width) - Math.floor(p / width);
    steps.push(dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');
  }
  return steps.reverse().join('');
}

/**
 * Carve a perfect maze with a randomized depth-first search, then put the
 * start and end at the two ends of the longest path so the solution is long.
 */
export function generateMaze(input: Mask, seed: number): Maze {
  // Resizing can cut a one-cell causeway; keep the main landmass and drop the empty margin.
  const mask = cropMask(largestRegion(input));
  const { width, height, cells } = mask;
  const random = seededRandom(seed);
  const open = cells.map(inside => (inside ? 0 : -1));
  const first = cells.indexOf(true);
  if (first === -1) throw new Error('The shape has no cells.');

  const visited = new Uint8Array(cells.length);
  const stack = [first];
  visited[first] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % width, y = (c - x) / width;
    const options: Array<[number, number, number]> = [];
    for (const [bit, dx, dy, , back] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (cells[n] && !visited[n]) options.push([n, bit, back]);
    }
    if (!options.length) { stack.pop(); continue; }
    const [n, bit, back] = options[Math.floor(random() * options.length)];
    open[c] |= bit;
    open[n] |= back;
    visited[n] = 1;
    stack.push(n);
  }

  const a = bfs({ width, open }, first).far;
  const { far: b, prev } = bfs({ width, open }, a);
  return {
    width,
    height,
    seed,
    open,
    start: [a % width, Math.floor(a / width)],
    end: [b % width, Math.floor(b / width)],
    solution: pathLetters(width, prev, a, b),
  };
}

/** Check a maze: every shape cell reachable, a single path, and the solution valid. */
export function verifyMaze(maze: Maze): { perfect: boolean; solutionValid: boolean } {
  const { width, open } = maze;
  const inside = open.filter(v => v >= 0).length;
  let passages = 0;
  for (const v of open) if (v > 0) passages += [N, E, S, W].filter(b => v & b).length;
  const startIndex = maze.start[1] * width + maze.start[0];
  const reached = bfs(maze, startIndex);
  let x = maze.start[0], y = maze.start[1], solutionValid = true;
  for (const step of maze.solution) {
    const dir = DIRS.find(d => d[3] === step)!;
    if (!(open[y * width + x] & dir[0])) { solutionValid = false; break; }
    x += dir[1]; y += dir[2];
  }
  solutionValid &&= x === maze.end[0] && y === maze.end[1];
  const reachedCount = Array.from(reached.prev).filter(p => p !== -1).length + 1;
  return { perfect: passages / 2 === inside - 1 && reachedCount === inside, solutionValid };
}

/** One row per line, one hex digit per cell (the open-passage bits), "." outside. */
export function toGridRows(maze: Maze): string[] {
  const rows: string[] = [];
  for (let y = 0; y < maze.height; y++) {
    let row = '';
    for (let x = 0; x < maze.width; x++) {
      const v = maze.open[y * maze.width + x];
      row += v < 0 ? '.' : v.toString(16);
    }
    rows.push(row);
  }
  return rows;
}

function solutionCells(maze: Maze): Cell[] {
  const cells: Cell[] = [[...maze.start]];
  let [x, y] = maze.start;
  for (const step of maze.solution) {
    const dir = DIRS.find(d => d[3] === step)!;
    x += dir[1]; y += dir[2];
    cells.push([x, y]);
  }
  return cells;
}

/** Walls as merged horizontal and vertical runs, in grid-line coordinates. */
function wallRuns(maze: Maze): Array<[number, number, number, number]> {
  const { width, height, open } = maze;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && open[y * width + x] >= 0;
  const runs: Array<[number, number, number, number]> = [];
  // Horizontal wall on the top edge of (x, y): between (x, y-1) and (x, y).
  for (let y = 0; y <= height; y++) {
    let startX = -1;
    for (let x = 0; x <= width; x++) {
      const a = inside(x, y - 1), b = inside(x, y);
      const wall = x < width && (a || b) && !(a && b && (open[y * width + x] & N));
      if (wall && startX < 0) startX = x;
      if (!wall && startX >= 0) { runs.push([startX, y, x, y]); startX = -1; }
    }
  }
  for (let x = 0; x <= width; x++) {
    let startY = -1;
    for (let y = 0; y <= height; y++) {
      const a = inside(x - 1, y), b = inside(x, y);
      const wall = y < height && (a || b) && !(a && b && (open[y * width + x] & W));
      if (wall && startY < 0) startY = y;
      if (!wall && startY >= 0) { runs.push([x, startY, x, y]); startY = -1; }
    }
  }
  return runs;
}

/** Printable SVG. The entrance and exit are marked with dots, not gaps in the wall. */
export function toSvg(maze: Maze, options: { showSolution?: boolean; cellSize?: number; title?: string } = {}): string {
  const c = options.cellSize ?? Math.max(6, Math.min(24, Math.floor(720 / Math.max(maze.width, maze.height))));
  const pad = c;
  const w = maze.width * c + pad * 2, h = maze.height * c + pad * 2;
  const stroke = Math.max(1, Math.round(c / 6));
  const walls = wallRuns(maze).map(([x0, y0, x1, y1]) => `M${x0 * c + pad} ${y0 * c + pad}${x0 === x1 ? `V${y1 * c + pad}` : `H${x1 * c + pad}`}`).join('');
  const centre = ([x, y]: Cell) => [x * c + pad + c / 2, y * c + pad + c / 2];
  const [sx, sy] = centre(maze.start), [ex, ey] = centre(maze.end);
  const r = Math.max(2, c * 0.3);
  const solution = options.showSolution
    ? `<polyline fill="none" stroke="#d43" stroke-width="${Math.max(1.5, c / 4)}" stroke-linecap="round" stroke-linejoin="round" points="${solutionCells(maze).map(cell => centre(cell).join(',')).join(' ')}"/>`
    : '';
  const title = options.title ? `<title>${options.title.replace(/[<&>]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${title}<rect width="${w}" height="${h}" fill="#fff"/>${solution}<path d="${walls}" fill="none" stroke="#111" stroke-width="${stroke}" stroke-linecap="square"/><circle cx="${sx}" cy="${sy}" r="${r}" fill="#2a7"/><circle cx="${ex}" cy="${ey}" r="${r}" fill="#d43"/></svg>`;
}

/** Text maze for chat replies: S = start, E = end, * = solution. */
export function toAscii(maze: Maze, showSolution = false): string {
  const { width, height, open } = maze;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && open[y * width + x] >= 0;
  const onPath = new Set(showSolution ? solutionCells(maze).map(([x, y]) => y * width + x) : []);
  const lines: string[] = [];
  for (let y = 0; y <= height; y++) {
    let top = '', mid = '';
    for (let x = 0; x <= width; x++) {
      const corner = inside(x - 1, y - 1) || inside(x, y - 1) || inside(x - 1, y) || inside(x, y);
      top += corner ? '+' : ' ';
      if (x < width) {
        const a = inside(x, y - 1), b = inside(x, y);
        top += (a || b) && !(a && b && (open[y * width + x] & N)) ? '--' : '  ';
      }
      if (y < height) {
        const a = inside(x - 1, y), b = inside(x, y);
        mid += (a || b) && !(a && b && (open[y * width + x] & W)) ? '|' : ' ';
        if (x < width) {
          const i = y * width + x;
          const isStart = x === maze.start[0] && y === maze.start[1];
          const isEnd = x === maze.end[0] && y === maze.end[1];
          mid += !inside(x, y) ? '  ' : isStart ? 'S ' : isEnd ? 'E ' : onPath.has(i) ? '**' : '  ';
        }
      }
    }
    lines.push(top.trimEnd());
    if (y < height) lines.push(mid.trimEnd());
  }
  return lines.join('\n');
}
