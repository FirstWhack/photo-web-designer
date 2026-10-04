import { useState } from 'react';
import { fixtures } from '@/contracts/fixtures';
import { Scene } from './Scene';

/** Isolated dev page: open /?dev=canvas. Canvas agent owns and extends this. */
export default function CanvasDev() {
  const [name, setName] = useState<keyof typeof fixtures>('combo');
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <select value={name} onChange={(e) => setName(e.target.value as keyof typeof fixtures)}>
        {Object.keys(fixtures).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Scene resolved={fixtures[name]} selection={{ nails: [], edges: [], pins: [] }} tool="select" activeGroupId="" />
      </div>
    </div>
  );
}
