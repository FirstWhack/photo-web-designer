import { useEffect, useMemo, useState } from 'react';
import type { ResolvedDesign } from '@/contracts/design';
import type { BuildPlan, Report } from '@/contracts/plan';
import type { MeasureOrigin, TemplatePdfOptions } from '@/contracts/ui';
import {
  CoordTable,
  CutList,
  PAPER_LABEL,
  PlanSheet,
  Walkthrough,
  exportPlanPdf,
  exportTemplatePdf,
  templateLayout,
  type PlanPaper,
} from '@/build';
import { Scene } from '@/canvas';
import { Button, Field, Note, Segmented, Tabs, Icon } from '@/panels';
import { downloadBlob, planHash, slug, walkHighlight, walkScreens } from './util';
import s from './App.module.css';

export type BuildTab = 'drawing' | 'cut' | 'coords' | 'template' | 'walk';

const DRAW_PAPERS: PlanPaper[] = ['tabloid', 'a3', 'letter', 'a4'];
const ZOOMS = ['1', '1.5', '2', '3'] as const;
type Zoom = (typeof ZOOMS)[number];

const ORIGINS: { value: MeasureOrigin; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

/** Above this many sheets, the paper template is more trouble than it's worth. */
export const MANY_SHEETS = 20;

const EMPTY_SEL = { nails: [], edges: [], pins: [] };

/** Reads the walkthrough's saved position (it persists `{ sig, index }` under its storage key). */
function readWalkIndex(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { index?: number };
    return Number.isInteger(v.index) ? (v.index as number) : 0;
  } catch {
    return 0;
  }
}

export function BuildView({
  resolved,
  plan,
  report,
  designName,
  createdAt,
  tab,
  onTab,
  showScene,
}: {
  resolved: ResolvedDesign;
  plan: BuildPlan;
  report: Report;
  designName: string;
  createdAt: number;
  tab: BuildTab;
  onTab: (t: BuildTab) => void;
  showScene: boolean;
}) {
  const [origin, setOrigin] = useState<MeasureOrigin>('top-left');
  const [paper, setPaper] = useState<TemplatePdfOptions['paper']>('letter');
  const [drawPaper, setDrawPaper] = useState<PlanPaper>('tabloid');
  const [zoom, setZoom] = useState<Zoom>('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `photo-web:walk:${createdAt}:${planHash(plan)}`;

  // Follow the walkthrough's position so the big scene can highlight the current step.
  const [walkIndex, setWalkIndex] = useState(0);
  useEffect(() => {
    if (tab !== 'walk' || !showScene) return;
    const tick = () => setWalkIndex(readWalkIndex(storageKey));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [storageKey, tab, showScene]);
  const screens = useMemo(() => walkScreens(plan), [plan]);
  const highlight = tab === 'walk' ? walkHighlight(plan, screens[Math.min(walkIndex, screens.length - 1)]) : undefined;

  const opts: TemplatePdfOptions = { paper, margin: 10, origin, title: designName };
  const layout = useMemo(() => templateLayout(resolved, { paper, margin: 10, origin }), [resolved, paper, origin]);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportTemplatePdf(resolved, opts);
      downloadBlob(blob, `${slug(designName)}-template-${paper}.pdf`);
    } catch (e) {
      setError((e as Error).message || 'Could not build the PDF');
    } finally {
      setBusy(false);
    }
  };

  const downloadDrawing = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportPlanPdf(resolved, plan, { paper: drawPaper, origin, title: designName, report });
      downloadBlob(blob, `${slug(designName)}-drawing-${drawPaper}.pdf`);
    } catch (e) {
      setError((e as Error).message || 'Could not build the PDF');
    } finally {
      setBusy(false);
    }
  };

  const empty = plan.runs.length === 0 && resolved.nails.length === 0;
  // The drawing already shows the whole design; give it the full width.
  const sceneShown = showScene && tab !== 'drawing';

  return (
    <div className={s.buildLayout} data-scene={sceneShown || undefined}>
      <div className={s.buildMain}>
        <Tabs<BuildTab>
          label="Build guides"
          value={tab}
          onChange={onTab}
          tabs={[
            { value: 'drawing', label: 'Drawing', icon: 'frame' },
            { value: 'cut', label: 'Cut & shop', icon: 'scissors' },
            { value: 'coords', label: 'Nail positions', icon: 'ruler' },
            { value: 'template', label: 'Paper template (1:1)', icon: 'printer' },
            { value: 'walk', label: 'Step-by-step (optional)', icon: 'steps' },
          ]}
        />
        <div className={s.buildContent}>
          {empty ? (
            <div className={s.buildEmpty}>
              <Icon name="nail" size={28} />
              <p>Nothing to build yet. Design a web in Explore or Refine, then come back for step-by-step instructions.</p>
            </div>
          ) : tab === 'drawing' ? (
            <div className={s.drawingTab}>
              <div className={s.drawingBar}>
                <Field label="Paper">
                  <Segmented
                    label="Drawing paper"
                    value={drawPaper}
                    options={DRAW_PAPERS.map((p) => ({ value: p, label: PAPER_LABEL[p] }))}
                    onChange={setDrawPaper}
                  />
                </Field>
                <Field label="Datum (measure from)">
                  <Segmented label="Drawing datum" value={origin} options={ORIGINS} onChange={setOrigin} />
                </Field>
                <Field label="Zoom">
                  <Segmented
                    label="Drawing zoom"
                    value={zoom}
                    options={ZOOMS.map((z) => ({ value: z, label: z === '1' ? 'Fit' : `${z}×` }))}
                    onChange={setZoom}
                  />
                </Field>
                <Button variant="primary" icon="download" onClick={downloadDrawing} disabled={busy}>
                  {busy ? 'Building PDF…' : 'Download drawing PDF'}
                </Button>
              </div>
              {error && <Note tone="warn">{error}</Note>}
              <div className={s.drawingScroll} data-testid="drawing-scroll">
                <div style={{ width: `${Number(zoom) * 100}%` }}>
                  <PlanSheet resolved={resolved} plan={plan} report={report} origin={origin} title={designName} paper={drawPaper} />
                </div>
              </div>
            </div>
          ) : tab === 'walk' ? (
            <Walkthrough resolved={resolved} plan={plan} storageKey={storageKey} />
          ) : tab === 'cut' ? (
            <CutList resolved={resolved} plan={plan} report={report} />
          ) : tab === 'coords' ? (
            <div className={s.buildStack}>
              <Field label="Measure from">
                <Segmented full label="Measure from" value={origin} options={ORIGINS} onChange={setOrigin} />
              </Field>
              <CoordTable resolved={resolved} origin={origin} />
            </div>
          ) : (
            <div className={s.buildStack}>
              <div className={s.templateIntro}>
                <h2 className={s.h2}>Paper template</h2>
                <p className={s.mutedText}>
                  A 1:1 printout of every nail. Tape the sheets to the wall using the registration marks, then nail straight
                  through the dots. Print at 100% (no “fit to page”) and check the calibration square with a ruler.
                </p>
              </div>
              <div className={s.templateOpts}>
                <Field label="Paper">
                  <Segmented
                    full
                    label="Paper"
                    value={paper}
                    options={[
                      { value: 'letter', label: 'US Letter' },
                      { value: 'a4', label: 'A4' },
                    ]}
                    onChange={setPaper}
                  />
                </Field>
                <Field label="Measure from">
                  <Segmented full label="Template origin" value={origin} options={ORIGINS} onChange={setOrigin} />
                </Field>
              </div>
              <div className={s.sheetCount} data-many={layout.pageCount > MANY_SHEETS || undefined}>
                <strong data-testid="sheet-count">{layout.pageCount}</strong>
                <span>
                  sheets · {layout.layout.rows} × {layout.layout.cols} tiles ({layout.layout.orientation}) + an assembly map
                </span>
              </div>
              {layout.pageCount > MANY_SHEETS && (
                <Note tone="warn">
                  {layout.pageCount} sheets: consider the coordinate table instead. Measuring from a corner with a tape is quicker
                  than taping up that much paper.
                </Note>
              )}
              <div>
                <Button variant="primary" icon="download" onClick={download} disabled={busy}>
                  {busy ? 'Building PDF…' : 'Download PDF'}
                </Button>
              </div>
              {error && <Note tone="warn">{error}</Note>}
            </div>
          )}
        </div>
      </div>
      {sceneShown && !empty && (
        <div className={s.buildScene} aria-label="Design preview">
          <Scene
            resolved={resolved}
            selection={EMPTY_SEL}
            tool="pan"
            activeGroupId={resolved.groups[0]?.id ?? ''}
            plan={plan}
            showNailLabels
            showPins={false}
            highlight={highlight}
          />
        </div>
      )}
    </div>
  );
}
