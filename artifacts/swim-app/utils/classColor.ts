const COLORS = ["#4EA7D8","#2E9B6F","#E4A93A","#D96C6C","#8B5CF6","#EC4899","#06B6D4","#84CC16"];

export function classColor(id: string, storedColor?: string | null): string {
  if (storedColor && storedColor !== "#FFFFFF" && storedColor !== "#ffffff") {
    return storedColor;
  }
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}
