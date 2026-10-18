const box = { border: "1px solid var(--border-default)", borderRadius: 6, background: "var(--surface-white)", padding: 12 } as const;
const inp = { padding: "5px 8px", border: "1px solid var(--border-strong)", borderRadius: 4, fontSize: 13, minWidth: 0 } as const;
const btn = { padding: "5px 12px", border: "1px solid var(--x-primary)", background: "var(--x-primary)", color: "#fff", borderRadius: 4, fontSize: 13, cursor: "pointer" } as const;
const btn2 = { ...btn, background: "var(--surface-white)", color: "var(--x-primary)" } as const;
export const ui = { box, inp, btn, btn2 };
