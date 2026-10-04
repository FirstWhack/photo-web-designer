import { describe, expect, it } from 'vitest';
import { sampleDesign } from '@/contracts/fixtures';
import { decodeShareLink, deserializeDesign, encodeShareLink, serializeDesign } from './index';

describe('serialize', () => {
  it('round-trips', () => {
    const d = sampleDesign();
    d.wall.background = { dataUrl: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 72, height: 48, opacity: 0.5 };
    expect(deserializeDesign(serializeDesign(d))).toEqual(d);
  });

  it('throws descriptive errors on invalid input', () => {
    expect(() => deserializeDesign('not json')).toThrow(/not valid JSON/);
    expect(() => deserializeDesign('null')).toThrow(/design must be an object/);
    const d = sampleDesign() as unknown as Record<string, unknown>;
    expect(() => deserializeDesign(JSON.stringify({ ...d, version: 2 }))).toThrow(/version must be 1/);
    expect(() => deserializeDesign(JSON.stringify({ ...d, nails: undefined }))).toThrow(/design\.nails must be an array/);
    const bad = sampleDesign();
    bad.nails[1].x = NaN; // JSON turns NaN into null
    expect(() => deserializeDesign(JSON.stringify(bad))).toThrow(/design\.nails\[1\]\.x must be a finite number/);
    const bad2 = sampleDesign();
    (bad2.layers[0].transform as unknown as Record<string, unknown>).rotation = 'x';
    expect(() => deserializeDesign(JSON.stringify(bad2))).toThrow(/layers\[0\]\.transform\.rotation/);
  });
});

describe('share links', () => {
  it('round-trips without the wall background or photo data', () => {
    const d = sampleDesign();
    d.wall.background = { dataUrl: 'data:image/png;base64,' + 'A'.repeat(5000), x: 0, y: 0, width: 72, height: 48, opacity: 0.5 };
    d.pins[0] = { ...d.pins[0], photo: { dataUrl: 'data:image/png;base64,BBBB', aspect: 1.5 } };
    const hash = encodeShareLink(d);
    expect(hash).toMatch(/^[A-Za-z0-9+\-$]*$/);
    const back = decodeShareLink(hash)!;
    expect(back).not.toBeNull();
    expect(back.wall.background).toBeUndefined();
    expect(back.pins[0].photo).toEqual({ aspect: 1.5 });
    const { background: _bg, ...wall } = d.wall;
    expect({ ...back, pins: d.pins }).toEqual({ ...d, wall });
    expect(decodeShareLink('#' + hash)).toEqual(back);
  });

  it('returns null on garbage', () => {
    expect(decodeShareLink('')).toBeNull();
    expect(decodeShareLink('%%%garbage%%%')).toBeNull();
    expect(decodeShareLink('N4IgdghgtgpiBcIDCB7ANg')).toBeNull();
  });
});
