export interface GridGeometry {
  columns: number;
  cellSize: number;
  columnGap: number;
  rowGap: number;
  padding: number;
}

/** Coordinates are relative to the list's content, not the screen. */
export function photoIndexAt(x: number, y: number, count: number, grid: GridGeometry) {
  x -= grid.padding;
  y -= grid.padding;
  if (x < 0 || y < 0) return -1;
  const column = Math.floor(x / (grid.cellSize + grid.columnGap));
  const row = Math.floor(y / (grid.cellSize + grid.rowGap));
  if (column >= grid.columns ||
      x % (grid.cellSize + grid.columnGap) >= grid.cellSize ||
      y % (grid.cellSize + grid.rowGap) >= grid.cellSize) return -1;
  const index = row * grid.columns + column;
  return index < count ? index : -1;
}

export function edgeScrollSpeed(y: number, height: number, zone = 56) {
  if (height <= 0 || y < 0 || y > height) return 0;
  const edge = Math.min(zone, height / 3);
  if (y < edge) return -600 * (1 - y / edge);
  if (y > height - edge) return 600 * (1 - (height - y) / edge);
  return 0;
}

/** Sample the path so fast moves don't skip cells crossed between touch events. */
export function samplePhotoPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  visit: (x: number, y: number) => void,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
  for (let i = 1; i <= steps; i++) {
    visit(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
  }
}

export class PhotoDragSession {
  private visited = new Set<string>();
  readonly selecting: boolean;

  constructor(firstId: string, selected: ReadonlySet<string>) {
    this.selecting = !selected.has(firstId);
  }

  visit(id: string | null | undefined) {
    if (!id || this.visited.has(id)) return false;
    this.visited.add(id);
    return true;
  }

  apply(selected: Set<string>, id: string, limit = Infinity): Set<string> {
    if (this.selecting ? selected.has(id) || selected.size >= limit : !selected.has(id)) return selected;
    const next = new Set(selected);
    if (this.selecting) next.add(id);
    else next.delete(id);
    return next;
  }
}
