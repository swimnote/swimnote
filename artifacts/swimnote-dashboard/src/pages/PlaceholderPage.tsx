type PlaceholderPageProps = {
  title: string;
};

export default function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div style={{ padding: "32px" }}>
      <h1
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: "var(--text-strong)",
          marginBottom: "12px",
        }}
      >
        {title}
      </h1>
      <div
        style={{
          fontSize: "14px",
          color: "var(--text-muted)",
        }}
      >
        다음 구현 단계에서 연결됩니다.
      </div>
    </div>
  );
}
