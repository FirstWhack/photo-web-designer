import type { SceneProps } from '@/contracts/ui';

/** Wave-0 stub: plain lines + dots, read-only. Replace with the real scene. */
export function Scene({ resolved, className }: SceneProps) {
  const byId = new Map(resolved.nails.map((n) => [n.id, n]));
  const color = new Map(resolved.groups.map((g) => [g.id, g.color]));
  const { width, height } = resolved.wall;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%' }}>
      <rect width={width} height={height} fill="#f4efe6" />
      {resolved.edges.map((e) => {
        const a = byId.get(e.a)!;
        const b = byId.get(e.b)!;
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color.get(e.groupId)} strokeWidth={0.25} />;
      })}
      {resolved.nails.map((n) => (
        <circle key={n.id} cx={n.x} cy={n.y} r={0.4} fill="#555" />
      ))}
    </svg>
  );
}
