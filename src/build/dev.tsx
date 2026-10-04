import { triangle, trianglePlan, triangleReport } from '@/contracts/fixtures';
import { CoordTable } from './CoordTable';
import { CutList } from './CutList';
import { Walkthrough } from './Walkthrough';

/** Isolated dev page: open /?dev=build. Build agent owns and extends this. */
export default function BuildDev() {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 24 }}>
      <Walkthrough resolved={triangle} plan={trianglePlan} />
      <CutList resolved={triangle} plan={trianglePlan} report={triangleReport} />
      <CoordTable resolved={triangle} origin="top-left" />
    </div>
  );
}
