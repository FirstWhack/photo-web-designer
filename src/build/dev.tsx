import { useMemo, useState, type CSSProperties } from 'react';
import { plus, plusPlan, spider, triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';
import type { ResolvedDesign } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';
import type { MeasureOrigin, TemplatePdfOptions } from '@/contracts/ui';
import { CoordTable } from './CoordTable';
import { CutList } from './CutList';
import { Walkthrough } from './Walkthrough';
import { devPlan } from './devPlan';
import { exportTemplatePdf, templateLayout } from './pdf';
import { PlanSheet } from './PlanSheet';
import type { PlanPaper } from './drawing';
import { denseFixture } from './devDense';

type Key = 'triangle' | 'plus' | 'spider' | 'dense';
const dense = denseFixture();
const FIXTURES: Record<Key, { resolved: ResolvedDesign; plan: BuildPlan; report?: Report }> = {
  triangle: { resolved: triangle, plan: trianglePlan, report: triangleReport },
  plus: { resolved: plus, plan: plusPlan },
  spider: { resolved: spider, plan: devPlan(spider) },
  dense: { resolved: dense, plan: devPlan(dense) },
};
const ORIGINS: MeasureOrigin[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const bar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'center',
  padding: 12,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

/** Isolated dev page: open /?dev=build. */
export default function BuildDev() {
  const [key, setKey] = useState<Key>('triangle');
  const [paper, setPaper] = useState<TemplatePdfOptions['paper']>('letter');
  const [origin, setOrigin] = useState<MeasureOrigin>('top-left');
  const [busy, setBusy] = useState(false);
  const [sheetPaper, setSheetPaper] = useState<PlanPaper>('tabloid');
  const f = FIXTURES[key];
  const opts: TemplatePdfOptions = { paper, margin: 10, origin, title: `${key} fixture` };
  const layout = useMemo(() => templateLayout(f.resolved, { paper, margin: 10, origin }), [f, paper, origin]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const preview = async () => {
    const blob = await exportTemplatePdf(f.resolved, opts);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await exportTemplatePdf(f.resolved, opts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key}-template-${paper}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={bar}>
        <strong>Build dev</strong>
        <label>
          Fixture{' '}
          <select value={key} onChange={(e) => setKey(e.target.value as Key)}>
            {Object.keys(FIXTURES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Paper{' '}
          <select value={paper} onChange={(e) => setPaper(e.target.value as TemplatePdfOptions['paper'])}>
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label>
          Origin{' '}
          <select value={origin} onChange={(e) => setOrigin(e.target.value as MeasureOrigin)}>
            {ORIGINS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={download} disabled={busy} style={{ padding: '8px 14px' }}>
          {busy ? 'Building…' : 'Download template PDF'}
        </button>
        <button type="button" onClick={preview} style={{ padding: '8px 14px' }}>
          {previewUrl ? 'Refresh preview' : 'Preview PDF'}
        </button>
        <span style={{ color: 'var(--text-muted)' }}>
          {layout.pageCount} pages ({layout.layout.rows}×{layout.layout.cols} {layout.layout.orientation} tiles)
        </span>
      </div>
      <label>
        Drawing paper{' '}
        <select value={sheetPaper} onChange={(e) => setSheetPaper(e.target.value as PlanPaper)}>
          {(['tabloid', 'a3', 'letter', 'a4'] as const).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <PlanSheet resolved={f.resolved} plan={f.plan} report={f.report} origin={origin} title={`${key} fixture`} paper={sheetPaper} />
      {previewUrl && (
        <iframe title="Template preview" src={previewUrl} style={{ width: '100%', height: '80vh', border: '1px solid var(--border)' }} />
      )}
      <Walkthrough resolved={f.resolved} plan={f.plan} storageKey={`dev-build-walk-${key}`} />
      <CutList resolved={f.resolved} plan={f.plan} report={f.report} />
      <CoordTable resolved={f.resolved} origin={origin} />
    </div>
  );
}
