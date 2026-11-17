# MazeDIY maze dataset

Licensed CC BY 4.0. Credit: MazeDIY (https://mazediy.com).

## Grid encoding (`shape-mazes.jsonl`, `country-mazes.jsonl`, `us-state-mazes.jsonl`)

One JSON object per line. `grid` has one string per row, one character per cell:

- `.` is outside the shape.
- A hex digit `0`-`f` is a cell inside the shape. Its bits are the open sides: N=1, E=2, S=4, W=8. A cell with value `6` is open to the east and south.

`x` runs left to right and `y` top to bottom, starting at 0. `start` and `end` are `[x, y]`. `solution` is the route from start to end as a string of `N`, `E`, `S`, `W` moves.

| Field | Meaning |
|---|---|
| `id` | `shape-<collection>-<slug>`, `country-<slug>` or `us-state-<slug>` |
| `name` | Shape, country or state name |
| `theme`, `keyword` | Shapes only: collection (e.g. Animal Mazes) and search phrase |
| `iso_a2`, `iso_a3`, `continent` | Countries only, from Natural Earth (`iso_a2` is null where none exists) |
| `width`, `height`, `cells` | Grid size and number of cells inside the shape |
| `seed` | Countries only: regenerates the same maze with this package |
| `perfect` | `true` when there is exactly one path between any two cells. The US state mazes are hand-tuned printables with a few loops, so they are `false`. |
| `solution_length` | Number of moves in the shortest solution |
| `page_url`, `image_url`, `solution_image_url` | Shapes and US states: the printable page, maze image and answer key on mazediy.com. For shapes the image shows exactly this maze. |

Python example:

```python
import json
N, E, S, W = 1, 2, 4, 8
with open("country-mazes.jsonl") as f:
    maze = json.loads(next(f))
grid = maze["grid"]
x, y = maze["start"]
cell = int(grid[y][x], 16)
print(maze["name"], "start cell open to the east:", bool(cell & E))
```

## Country outlines (`country-shapes.json`)

`countries[].rows` holds one string per row of run lengths separated by `.`, alternating outside and inside and starting with outside. For example `3.4.2` means 3 outside cells, 4 inside, 2 outside.

## Printable maze index (`printable-mazes.json`)

`items[]` has `name`, `theme`, `keyword`, `url` (print page), `image_url` and `solution_image_url` for 2,145 printable mazes on mazediy.com.
