import { combo } from '@/contracts/fixtures';
import { Scene } from '@/canvas';

/** Wave-0 stub: shows a fixture through the canvas stub. Replaced by the ui-shell agent. */
export function App() {
  return (
    <div style={{ height: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Photo Web Designer (wave 0 skeleton)</h1>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Scene resolved={combo} selection={{ nails: [], edges: [], pins: [] }} tool="select" activeGroupId="g-jute" />
      </div>
    </div>
  );
}
