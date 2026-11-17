import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP server answers over stdio', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/index.js', import.meta.url).pathname] }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['find_printable_mazes', 'generate_maze', 'list_countries']);

    const svg = await client.callTool({ name: 'generate_maze', arguments: { country: 'France', size: 30, seed: 5, show_solution: true } });
    assert.ok(!svg.isError);
    assert.match(svg.content[1].text, /^<svg/);
    assert.equal(svg.structuredContent.seed, 5);

    const ascii = await client.callTool({ name: 'generate_maze', arguments: { shape: 'heart', size: 12, format: 'ascii' } });
    assert.match(ascii.content[0].text, /\+--/);

    const json = await client.callTool({ name: 'generate_maze', arguments: { shape: 'rectangle', width: 10, height: 7, format: 'json', seed: 9 } });
    assert.equal(json.structuredContent.grid.length, 7);

    const missing = await client.callTool({ name: 'generate_maze', arguments: { country: 'Atlantis' } });
    assert.ok(missing.isError);

    const countries = await client.callTool({ name: 'list_countries', arguments: { continent: 'Europe' } });
    assert.ok(countries.structuredContent.count > 30);

    const found = await client.callTool({ name: 'find_printable_mazes', arguments: { query: 'unicorn' } });
    assert.ok(found.structuredContent.results[0].url.includes('utm_source=mcp'));
  } finally {
    await client.close();
  }
});
