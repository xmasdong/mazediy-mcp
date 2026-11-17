#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { generateMaze, randomSeed, toAscii, toGridRows, toSvg, type Mask } from './maze.js';
import { countryMask, findCountry, GEOMETRIC_SHAPES, geometricMask, searchCountries } from './shapes.js';
import { printableThemes, searchPrintableMazes } from './catalog.js';

const VERSION = '1.0.1';
const SITE = 'https://mazediy.com';
const utm = (path: string) => `${SITE}${path}${path.includes('?') ? '&' : '?'}utm_source=mcp&utm_medium=mazediy-mcp`;

const server = new McpServer({ name: 'mazediy-mcp', version: VERSION });

server.registerTool(
  'generate_maze',
  {
    title: 'Generate a maze',
    description:
      'Generate a printable maze as SVG, ASCII text or JSON. Shapes: rectangle, circle, heart, star, diamond, triangle, hexagon, or the outline of any country (pass `country`). Every maze has exactly one solution; set show_solution for an answer key. The same seed always gives the same maze.',
    inputSchema: {
      shape: z.enum([...GEOMETRIC_SHAPES, 'country']).default('rectangle').describe('Maze outline. Use "country" together with the `country` field.'),
      country: z.string().optional().describe('Country name, ISO code or alias, e.g. "Italy", "JP", "USA". Implies shape "country".'),
      size: z.number().int().min(5).max(96).default(20).describe('Cells along the longer side. 10-15 suits young children, 20-30 older kids, 40+ adults.'),
      width: z.number().int().min(5).max(96).optional().describe('Rectangle only: cells across. Overrides size.'),
      height: z.number().int().min(5).max(96).optional().describe('Rectangle only: cells down. Overrides size.'),
      seed: z.number().int().min(0).max(2 ** 31 - 1).optional().describe('Reuse a seed to regenerate the same maze.'),
      show_solution: z.boolean().default(false).describe('Draw the solution path (answer key).'),
      format: z.enum(['svg', 'ascii', 'json']).default('svg').describe('svg for printing, ascii for chat (best at size 25 or less), json for programs.'),
    },
  },
  async ({ shape, country, size, width, height, seed, show_solution, format }) => {
    let mask: Mask;
    let label: string;
    if (country || shape === 'country') {
      const match = country ? findCountry(country) : undefined;
      if (!match) {
        return {
          isError: true,
          content: [{ type: 'text', text: country ? `No country matches "${country}". Use list_countries to find the name.` : 'Pass a country name in `country`.' }],
        };
      }
      mask = countryMask(match, size);
      label = `${match.name} maze`;
    } else {
      const w = shape === 'rectangle' ? width ?? size : size;
      const h = shape === 'rectangle' ? height ?? size : size;
      mask = geometricMask(shape as (typeof GEOMETRIC_SHAPES)[number], w, h);
      label = `${shape} maze`;
    }

    const maze = generateMaze(mask, seed ?? randomSeed());
    const cells = maze.open.filter(v => v >= 0).length;
    const summary = {
      title: label,
      width: maze.width,
      height: maze.height,
      cells,
      seed: maze.seed,
      start: maze.start,
      end: maze.end,
      solution_length: maze.solution.length,
    };
    const more = `More printable mazes, and mazes made from your own photo or name: ${utm('/maze-maker')}`;

    if (format === 'json') {
      const data = { ...summary, encoding: 'grid rows: one hex digit per cell = open sides (N=1,E=2,S=4,W=8), "." = outside', grid: toGridRows(maze), solution: maze.solution };
      return { content: [{ type: 'text', text: JSON.stringify(data) }, { type: 'text', text: more }], structuredContent: data };
    }
    if (format === 'ascii') {
      const text = toAscii(maze, show_solution);
      return {
        content: [{ type: 'text', text: `${label} (${maze.width}x${maze.height}, seed ${maze.seed}). S = start, E = end${show_solution ? ', ** = solution' : ''}.\n\n${text}` }, { type: 'text', text: more }],
        structuredContent: summary,
      };
    }
    const svg = toSvg(maze, { showSolution: show_solution, title: label });
    return {
      content: [
        { type: 'text', text: `${label} (${maze.width}x${maze.height}, seed ${maze.seed}). Green dot = start, red dot = end. Save the SVG below as a .svg file to print it.` },
        { type: 'text', text: svg },
        { type: 'text', text: more },
      ],
      structuredContent: summary,
    };
  },
);

server.registerTool(
  'list_countries',
  {
    title: 'List country shapes',
    description: 'List the countries available for country-shaped mazes. Filter by part of a name or code, or by continent (Africa, Asia, Europe, North America, South America, Oceania, Antarctica).',
    inputSchema: {
      query: z.string().optional(),
      continent: z.string().optional(),
    },
  },
  async ({ query, continent }) => {
    const countries = searchCountries(query, continent);
    return {
      content: [{ type: 'text', text: countries.length ? JSON.stringify(countries) : 'No matching countries.' }],
      structuredContent: { count: countries.length, countries },
    };
  },
);

server.registerTool(
  'find_printable_mazes',
  {
    title: 'Find ready-made printable mazes',
    description:
      'Search 2,000+ free printable mazes on MazeDIY (animals, dinosaurs, holidays, vehicles, food, US states and more). Each result links to a page with a print-ready maze and its answer key. Leave the query empty to list themes.',
    inputSchema: {
      query: z.string().default('').describe('What the maze should look like, e.g. "dinosaur", "christmas tree", "Texas".'),
      theme: z.string().optional().describe('Limit to one theme, e.g. "Animal Mazes".'),
      limit: z.number().int().min(1).max(30).default(10),
    },
  },
  async ({ query, theme, limit }) => {
    if (!query.trim() && !theme) {
      const themes = printableThemes();
      return {
        content: [{ type: 'text', text: `Themes: ${themes.map(t => `${t.theme} (${t.count})`).join(', ')}. Browse all: ${utm('/printable-mazes')}` }],
        structuredContent: { themes },
      };
    }
    const results = searchPrintableMazes(query, theme, limit).map(item => ({ ...item, url: utm(new URL(item.url).pathname) }));
    return {
      content: [{
        type: 'text',
        text: results.length
          ? JSON.stringify(results)
          : `No ready-made maze matches "${query}". Use generate_maze, or make one from a photo at ${utm('/picture-maze')}.`,
      }],
      structuredContent: { count: results.length, results },
    };
  },
);

await server.connect(new StdioServerTransport());
