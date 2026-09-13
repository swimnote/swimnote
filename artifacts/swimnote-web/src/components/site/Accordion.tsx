import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Accordion Item ────────────────────────────────────────────────────────────
export interface AccordionItem {
  q: string;
  a: string | React.ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
}

export function Accordion({ items }: AccordionProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((item, i) => {
        const open = openIdx === i;
        return (
          <div
            key={i}
            style={{ borderBottom: "1px solid var(--ds-border-light)" }}
          >
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              aria-expanded={open}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                width: "100%",
                padding: "16px 0",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                gap: 16,
              }}
            >
              <span
                style={{
                  fontSize: "var(--ds-text-body)",
                  fontWeight: "var(--ds-fw-medium)",
                  color: open ? "var(--ds-n-900)" : "var(--ds-text-primary)",
                  lineHeight: 1.5,
                }}
              >
                {item.q}
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  marginTop: 2,
                  transition: "transform 0.2s ease",
                  transform: open ? "rotate(180deg)" : "none",
                }}
              >
                <path
                  d="M4.5 6.75 9 11.25l4.5-4.5"
                  stroke="var(--ds-n-500)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      paddingBottom: 20,
                      fontSize: "var(--ds-text-body-sm)",
                      color: "var(--ds-text-secondary)",
                      lineHeight: 1.7,
                    }}
                  >
                    {item.a}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Tabbed FAQ with role tabs ─────────────────────────────────────────────────
export interface FAQGroup {
  label: string;
  items: AccordionItem[];
}

interface TabbedFAQProps {
  groups: FAQGroup[];
  accentColor?: string;
}

export function TabbedFAQ({ groups, accentColor = "var(--ds-n-900)" }: TabbedFAQProps) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div>
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 8,
          borderBottom: "1px solid var(--ds-border-light)",
        }}
        role="tablist"
      >
        {groups.map((g, i) => {
          const active = activeTab === i;
          return (
            <button
              key={g.label}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(i)}
              style={{
                padding: "10px 16px",
                background: "none",
                border: "none",
                borderBottom: active ? `2px solid ${accentColor}` : "2px solid transparent",
                cursor: "pointer",
                fontSize: "var(--ds-text-body-sm)",
                fontWeight: active ? "var(--ds-fw-semibold)" : "var(--ds-fw-regular)",
                color: active ? "var(--ds-n-900)" : "var(--ds-n-400)",
                transition: "var(--ds-transition-color)",
                marginBottom: -1,
                whiteSpace: "nowrap",
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <Accordion items={groups[activeTab].items} />
    </div>
  );
}
