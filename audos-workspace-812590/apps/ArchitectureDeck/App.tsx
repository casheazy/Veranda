import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Printer } from 'lucide-react';

const SLIDE_W = 1280;
const SLIDE_H = 720;

const COLORS = {
  line: 'var(--ad-muted)',
  danger: 'var(--ad-danger)',
};

function Brand() {
  return (
    <div className="ad-brand" aria-label="Veranda">
      <span className="ad-brand-mark">V</span>
      <span>Veranda</span>
    </div>
  );
}

function SlideShell({
  index,
  total,
  course,
  eyebrow,
  dark = false,
  children,
}: {
  index: number;
  total: number;
  course: string;
  eyebrow: string;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`ad-slide ${dark ? 'ad-slide--dark' : ''}`}
      aria-label={`Slide ${index + 1} of ${total}: ${eyebrow}`}
    >
      <div className="ad-orbit" aria-hidden="true" />
      <header className="ad-slide-head">
        <Brand />
        <span className="ad-eyebrow">{eyebrow}</span>
      </header>
      <div className="ad-slide-body">{children}</div>
      <footer className="ad-slide-foot">
        <span>Veranda · AI Architecture &amp; MLOps Blueprint · Abayomi Oshinowo</span>
        <span>
          Course slide {course} · {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </footer>
    </section>
  );
}

function Pill({ tone, children }: { tone: 'danger' | 'warning' | 'success' | 'brand' | 'muted'; children: ReactNode }) {
  return <span className={`ad-pill ad-pill--${tone}`}>{children}</span>;
}

/* ---------- Slide 1: Cover (course slide 49) ---------- */

function CoverSlide() {
  return (
    <div className="ad-cover">
      <p className="ad-kicker">Day 3 · Product Architecture, Software Integration &amp; MLOps</p>
      <h1 className="ad-cover-brand">Veranda</h1>
      <h2 className="ad-cover-title">AI Architecture &amp; MLOps Blueprint</h2>
      <p className="ad-cover-sub">
        How Veranda finds, verifies and explains Lagos rental listings — and how we keep the data and the AI honest.
      </p>
      <div className="ad-cover-author">
        <span className="ad-cover-label">Prepared by</span>
        <strong>Abayomi Oshinowo</strong>
        <span>Founder, Veranda</span>
      </div>
      <div className="ad-cover-meta">
        <span>yourveranda.com</span>
        <span>Lagos v0 · 23 zones</span>
        <span>November 2026</span>
      </div>
    </div>
  );
}

/* ---------- Slide 2: Target architecture (course slide 54) ---------- */

type Point = [number, number];

function Edge({ points, dashed = false, tone = 'line' }: { points: Point[]; dashed?: boolean; tone?: 'line' | 'danger' }) {
  const color = tone === 'danger' ? COLORS.danger : COLORS.line;
  const [x1, y1] = points[points.length - 2];
  const [x2, y2] = points[points.length - 1];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLength = 10;
  const headHalfWidth = 5;
  const bx = x2 - headLength * Math.cos(angle);
  const by = y2 - headLength * Math.sin(angle);
  const left = `${bx + headHalfWidth * Math.sin(angle)},${by - headHalfWidth * Math.cos(angle)}`;
  const right = `${bx - headHalfWidth * Math.sin(angle)},${by + headHalfWidth * Math.cos(angle)}`;
  const shaft = [...points.slice(0, -1), [bx, by] as Point].map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <g>
      <polyline
        points={shaft}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dashed ? '7 6' : undefined}
      />
      <polygon points={`${x2},${y2} ${left} ${right}`} style={{ fill: color }} />
    </g>
  );
}

function Node({
  x,
  y,
  w,
  h,
  title,
  tone = 'default',
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  tone?: 'default' | 'brand' | 'data' | 'external' | 'source';
  children?: ReactNode;
}) {
  return (
    <div className={`ad-node ad-node--${tone}`} style={{ left: x, top: y, width: w, height: h }}>
      <p className="ad-node-title">{title}</p>
      {children}
    </div>
  );
}

function EdgeLabel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <span className="ad-edge-label" style={{ left: x, top: y }}>
      {children}
    </span>
  );
}

function ArchitectureSlide() {
  return (
    <>
      <div className="ad-title-row">
        <div>
          <p className="ad-kicker">Target architecture</p>
          <h2 className="ad-title">One in-space app, one data store, two ingestion sources</h2>
        </div>
        <div className="ad-legend">
          <span><i className="ad-legend-line" /> Live path</span>
          <span><i className="ad-legend-line ad-legend-line--blocked" /> Blocked</span>
          <Pill tone="brand">v0 scope · 23 Lagos zones</Pill>
        </div>
      </div>

      <div className="ad-diagram">
        <svg className="ad-diagram-svg" width={1180} height={490} viewBox="0 0 1180 490" aria-hidden="true">
          <Edge points={[[140, 80], [180, 80]]} />
          <Edge points={[[410, 80], [450, 80]]} />
          <Edge points={[[700, 80], [985, 80]]} />
          <Edge points={[[575, 135], [575, 185]]} />
          <Edge points={[[700, 221], [722, 221]]} dashed tone="danger" />
          <Edge points={[[700, 296], [722, 296]]} />
          <Edge points={[[320, 435], [380, 435]]} />
          <Edge points={[[700, 435], [985, 435]]} />
        </svg>

        <Node x={0} y={40} w={140} h={80} title="Lagos renter">
          <p className="ad-node-sub">Web / mobile browser</p>
        </Node>

        <Node x={180} y={25} w={230} h={110} title="Find & Verify app" tone="brand">
          <p className="ad-node-sub">In-space React app: search, budget &amp; area filters, verification reports, follow-up chat</p>
        </Node>

        <Node x={450} y={25} w={250} h={110} title="Workspace server functions / hooks">
          <p className="ad-node-sub">Server-side layer between the app, WorkspaceDB and external APIs</p>
        </Node>

        <EdgeLabel x={842} y={60}>read / write</EdgeLabel>

        <Node x={985} y={25} w={195} h={465} title="WorkspaceDB" tone="data">
          <div className="ad-table-chip">
            <strong>listings</strong>
            <span>NormalizedListing rows, deduped by external_id</span>
          </div>
          <div className="ad-table-chip">
            <strong>scrape runs</strong>
            <span>One record per scraper run, with run status</span>
          </div>
          <p className="ad-node-sub ad-node-sub--bottom">Read by server functions · written by the scrape hook</p>
        </Node>

        <Node x={180} y={185} w={520} h={120} title="Verification dimensions · per-listing report">
          <div className="ad-chip-row">
            {['Flood', 'Power', 'Network', 'Security', 'Proximity to work'].map((dimension) => (
              <span className="ad-dim-chip" key={dimension}>{dimension}</span>
            ))}
          </div>
        </Node>

        <Node x={722} y={172} w={243} h={98} title="Google Routes API" tone="external">
          <p className="ad-node-sub">Commute times → proximity to work</p>
          <Pill tone="danger">Blocked · fix pending</Pill>
        </Node>

        <Node x={722} y={282} w={243} h={110} title="LLM · gpt-4o-mini" tone="external">
          <p className="ad-node-sub">Report text &amp; listing-grounded Q&amp;A, via the Audos proxy</p>
          <code className="ad-code">/proxy/openai/v1/chat/completions</code>
        </Node>

        <Node x={0} y={380} w={320} h={110} title="Apify scrapers · daily" tone="source">
          <div className="ad-source-row">
            <span>propertypro.ng</span>
            <Pill tone="brand">Primary</Pill>
          </div>
          <div className="ad-source-row">
            <span>nigeriapropertycentre.com</span>
            <Pill tone="muted">Secondary</Pill>
          </div>
        </Node>

        <Node x={380} y={380} w={320} h={110} title="Scrape hook → ingestion">
          <p className="ad-node-sub">
            Server function maps each item to <b>NormalizedListing</b>, dedupes by <b>external_id</b> and records the scrape run
          </p>
        </Node>

        <EdgeLabel x={842} y={414}>upsert listings · log run</EdgeLabel>
      </div>
    </>
  );
}

/* ---------- Slide 3: Failure register (course slide 55) ---------- */

const FAILURES: {
  failure: string;
  impact: string;
  detection: string;
  mitigation: string;
  status: string;
  tone: 'danger' | 'warning' | 'muted';
  note: string;
}[] = [
  {
    failure: 'Google Routes API permission block on commute lookups',
    impact: 'Proximity-to-work cannot return live commute times; the app falls back to a Lagos transit advisory.',
    detection: 'Permission error on Routes API calls from Cloud project 23743393754 (Routes API v2 not enabled / key restriction missing).',
    mitigation: 'Enable Routes API v2 on the project, add it to the API key restrictions, then re-test commutes.',
    status: 'Fix pending',
    tone: 'danger',
    note: 'Owner: founder · Week 1',
  },
  {
    failure: 'nigeriapropertycentre.com returns zero items across all 23 URLs for several consecutive days',
    impact: 'Secondary source adds no listings, so the catalog relies on PropertyPro alone.',
    detection: 'Consecutive daily zero-item runs across 23 zone URLs, treated as a suspected silent failure, not an empty market.',
    mitigation: 'Planned: diagnose and fix the NPC scraper; alert when a source returns 0 items on consecutive days.',
    status: 'Suspected · open',
    tone: 'warning',
    note: 'Owner: founder · Week 1',
  },
  {
    failure: 'PropertyPro runs interrupted (Cloudflare)',
    impact: 'Primary source ingests only partially on affected days, so listings can go stale.',
    detection: 'Apify run ends interrupted / incomplete.',
    mitigation: 'Planned: retry interrupted runs with backoff and flag partial runs in the scrape-run log.',
    status: 'Open',
    tone: 'warning',
    note: 'Owner: founder · Week 1',
  },
  {
    failure: 'Scraper hook marks zero-row runs as successful',
    impact: 'Masks the two failures above: run history looks healthy while no data lands.',
    detection: 'Scrape-run records showing success with 0 rows ingested.',
    mitigation: 'Planned: treat 0-row runs as failed / needs review and store per-source item counts on every run.',
    status: 'Open',
    tone: 'warning',
    note: 'Owner: founder · Week 1',
  },
  {
    failure: 'LLM hallucination in reports (gpt-4o-mini)',
    impact: 'A renter could act on invented facts about a home before paying a year of rent.',
    detection: 'Planned: 50-question AI golden set with a 90% pass threshold as the release gate.',
    mitigation: 'Prompts grounded in the listing record; never invent commute, network or security values; label thin data honestly.',
    status: 'Planned',
    tone: 'muted',
    note: 'Owner: founder · Week 2',
  },
];

function FailureSlide() {
  return (
    <>
      <div className="ad-title-row">
        <div>
          <p className="ad-kicker">Failure register</p>
          <h2 className="ad-title">What breaks, how we notice, and what we do about it</h2>
        </div>
      </div>
      <table className="ad-table ad-table--failures">
        <colgroup>
          <col style={{ width: 210 }} />
          <col style={{ width: 235 }} />
          <col style={{ width: 250 }} />
          <col style={{ width: 290 }} />
          <col style={{ width: 195 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Failure</th>
            <th>Impact</th>
            <th>Detection</th>
            <th>Mitigation</th>
            <th>Owner / status</th>
          </tr>
        </thead>
        <tbody>
          {FAILURES.map((row, i) => (
            <tr key={row.failure}>
              <td className="ad-cell-failure">
                <span className="ad-row-num">{i + 1}</span>
                {row.failure}
              </td>
              <td>{row.impact}</td>
              <td>{row.detection}</td>
              <td>{row.mitigation}</td>
              <td>
                <Pill tone={row.tone}>{row.status}</Pill>
                <span className="ad-cell-note">{row.note}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ---------- Slide 4: Tooling & 2-week backlog (course slide 56) ---------- */

const TOOLING: { layer: string; tool: string; role: string; status?: { label: string; tone: 'danger' | 'muted' } }[] = [
  { layer: 'Experience', tool: 'Audos in-space app', role: 'Find & Verify (React)' },
  { layer: 'Backend', tool: 'Workspace server functions / hooks', role: 'App API layer + scrape hook' },
  { layer: 'Data', tool: 'WorkspaceDB', role: 'listings, scrape runs' },
  { layer: 'Ingestion', tool: 'Apify scrapers, daily', role: 'propertypro.ng (primary), nigeriapropertycentre.com (secondary)' },
  { layer: 'Commute', tool: 'Google Routes API v2', role: 'Proximity to work', status: { label: 'Blocked', tone: 'danger' } },
  { layer: 'LLM', tool: 'gpt-4o-mini via Audos proxy', role: 'Report text + follow-up Q&A' },
  { layer: 'Evaluation', tool: 'AI golden set', role: '50 questions · 90% pass threshold', status: { label: 'Planned', tone: 'muted' } },
  { layer: 'Monitoring', tool: 'Scrape-run log (WorkspaceDB)', role: 'Run status; zero-row detection', status: { label: 'Planned', tone: 'muted' } },
];

const BACKLOG: { week: string; theme: string; items: { days: string; task: string }[] }[] = [
  {
    week: 'Week 1',
    theme: 'Data & integration reliability',
    items: [
      { days: 'Days 1–2', task: 'Harden the scrape hook: zero-row runs fail; store per-source item counts on every run.' },
      { days: 'Day 3', task: 'Enable Routes API v2 on project 23743393754, fix the key restriction, re-test commutes.' },
      { days: 'Day 4', task: 'NPC fix: diagnose zero items across 23 URLs; add a consecutive-zero alert.' },
      { days: 'Day 5', task: 'PropertyPro: retry Cloudflare-interrupted runs and flag partial runs.' },
    ],
  },
  {
    week: 'Week 2',
    theme: 'AI quality gate',
    items: [
      { days: 'Days 6–7', task: 'Write the AI golden set: 50 questions on real listings with expected answers.' },
      { days: 'Day 8', task: 'Baseline gpt-4o-mini against the golden set; log every failure.' },
      { days: 'Day 9', task: 'Fix grounding and prompt gaps; re-run the set.' },
      { days: 'Day 10', task: 'Release gate: ship report changes only at ≥ 90% pass (45 / 50).' },
    ],
  },
];

function ToolingSlide() {
  return (
    <>
      <div className="ad-title-row">
        <div>
          <p className="ad-kicker">Tooling &amp; 2-week backlog</p>
          <h2 className="ad-title">The stack we run on, and the next ten working days</h2>
        </div>
        <div className="ad-legend">
          <Pill tone="muted">All backlog items: planned</Pill>
        </div>
      </div>
      <div className="ad-two-col">
        <table className="ad-table ad-table--tooling">
          <colgroup>
            <col style={{ width: 100 }} />
            <col style={{ width: 190 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Tool</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {TOOLING.map((row) => (
              <tr key={row.layer}>
                <td className="ad-cell-layer">{row.layer}</td>
                <td className="ad-cell-tool">
                  {row.tool}
                  {row.status && <Pill tone={row.status.tone}>{row.status.label}</Pill>}
                </td>
                <td>{row.role}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ad-backlog">
          {BACKLOG.map((week) => (
            <article className="ad-week" key={week.week}>
              <header className="ad-week-head">
                <strong>{week.week}</strong>
                <span>{week.theme}</span>
              </header>
              <ol className="ad-week-list">
                {week.items.map((item) => (
                  <li key={item.days}>
                    <span className="ad-days">{item.days}</span>
                    <span>{item.task}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Slide 5: Rubric & pitfalls (course slide 57) ---------- */

const RUBRIC: { criterion: string; evidence: string; score: string; tone: 'success' | 'warning' | 'danger' }[] = [
  { criterion: 'Target architecture covers app, backend, data, ingestion, AI and external APIs', evidence: 'Slide 2 diagram', score: 'Met', tone: 'success' },
  { criterion: 'Real failure modes with impact, detection, mitigation and owner', evidence: 'Slide 3 · five logged failures', score: 'Met', tone: 'success' },
  { criterion: 'Tooling named for every layer', evidence: 'Slide 4 tooling table', score: 'Met', tone: 'success' },
  { criterion: 'Concrete, time-boxed backlog', evidence: 'Slide 4 · day-by-day, 2 weeks', score: 'Met', tone: 'success' },
  { criterion: 'MLOps: measurable AI evaluation and release gate', evidence: 'Golden set · 50 Qs · 90% pass', score: 'Partial · planned', tone: 'warning' },
  { criterion: 'Monitoring and alerting on the data pipeline', evidence: 'Zero-row + consecutive-zero checks', score: 'Partial · planned', tone: 'warning' },
  { criterion: 'Integrations healthy end to end', evidence: 'Routes API permission block', score: 'Gap · fix pending', tone: 'danger' },
];

const PITFALLS: { pitfall: string; answer: string }[] = [
  { pitfall: '“Run succeeded” is not “data arrived”', answer: 'Count rows per source and fail runs that ingest zero.' },
  { pitfall: 'Mistaking a silent failure for an empty market', answer: 'Consecutive-zero alerts per source (the NPC case).' },
  { pitfall: 'Shipping LLM output without an eval', answer: '50-question golden set; release only at ≥ 90% pass.' },
  { pitfall: 'External API config untested until production', answer: 'Routes API enablement and key check in Week 1.' },
  { pitfall: 'Quoting metrics you do not have', answer: 'Anything unmeasured is labelled “planned”.' },
];

function RubricSlide() {
  return (
    <>
      <div className="ad-title-row">
        <div>
          <p className="ad-kicker">Rubric self-assessment &amp; pitfalls</p>
          <h2 className="ad-title">Where the blueprint stands today</h2>
        </div>
      </div>
      <div className="ad-two-col ad-two-col--rubric">
        <div>
          <table className="ad-table ad-table--rubric">
            <colgroup>
              <col style={{ width: 330 }} />
              <col style={{ width: 230 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Evidence</th>
                <th>Self-assessment</th>
              </tr>
            </thead>
            <tbody>
              {RUBRIC.map((row) => (
                <tr key={row.criterion}>
                  <td className="ad-cell-criterion">{row.criterion}</td>
                  <td>{row.evidence}</td>
                  <td><Pill tone={row.tone}>{row.score}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ad-footnote">Criteria paraphrased from the Day 3 brief; grading follows the official course rubric.</p>
        </div>

        <div className="ad-pitfalls">
          <p className="ad-pitfalls-head">Common pitfalls → how Veranda avoids them</p>
          <ul>
            {PITFALLS.map((item) => (
              <li key={item.pitfall}>
                <strong>{item.pitfall}</strong>
                <span>{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

/* ---------- Deck ---------- */

const SLIDES: { key: string; course: string; eyebrow: string; dark?: boolean; Body: ComponentType }[] = [
  { key: 'cover', course: '49', eyebrow: 'Cover', dark: true, Body: CoverSlide },
  { key: 'architecture', course: '54', eyebrow: 'Target architecture', Body: ArchitectureSlide },
  { key: 'failures', course: '55', eyebrow: 'Failure register', Body: FailureSlide },
  { key: 'tooling', course: '56', eyebrow: 'Tooling & backlog', Body: ToolingSlide },
  { key: 'rubric', course: '57', eyebrow: 'Rubric & pitfalls', Body: RubricSlide },
];

function renderSlide(index: number) {
  const slide = SLIDES[index];
  const Body = slide.Body;
  return (
    <SlideShell index={index} total={SLIDES.length} course={slide.course} eyebrow={slide.eyebrow} dark={slide.dark}>
      <Body />
    </SlideShell>
  );
}

function ScaledStage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      if (width > 0) setScale(width / SLIDE_W);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(frame);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="ad-frame" ref={frameRef}>
      <div className="ad-canvas" style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export default function ArchitectureDeckApp() {
  const total = SLIDES.length;
  const [current, setCurrent] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const printSourceRef = useRef<HTMLDivElement>(null);
  const printCloneRef = useRef<HTMLElement | null>(null);

  const goTo = useCallback((index: number) => {
    setCurrent(Math.max(0, Math.min(total - 1, index)));
  }, [total]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        setCurrent((c) => Math.min(total - 1, c + 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setCurrent((c) => Math.max(0, c - 1));
      } else if (event.key === 'Home') {
        setCurrent(0);
      } else if (event.key === 'End') {
        setCurrent(total - 1);
      } else if (event.key === 'Escape') {
        setPresenting(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [total]);

  // The shell nests apps inside fixed, overflow-hidden panels, which would clip
  // printing to one page. Printing uses a static copy of every slide attached
  // directly to <body>; the print CSS hides everything else.
  const attachPrintCopy = useCallback(() => {
    if (printCloneRef.current || !printSourceRef.current || typeof document === 'undefined') return;
    const clone = printSourceRef.current.cloneNode(true) as HTMLElement;
    clone.className = 'ad-print-copy';
    clone.removeAttribute('aria-hidden');
    document.body.appendChild(clone);
    printCloneRef.current = clone;
  }, []);

  const detachPrintCopy = useCallback(() => {
    printCloneRef.current?.remove();
    printCloneRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('beforeprint', attachPrintCopy);
    window.addEventListener('afterprint', detachPrintCopy);
    return () => {
      window.removeEventListener('beforeprint', attachPrintCopy);
      window.removeEventListener('afterprint', detachPrintCopy);
      detachPrintCopy();
    };
  }, [attachPrintCopy, detachPrintCopy]);

  const handlePrint = () => {
    attachPrintCopy();
    window.print();
  };

  return (
    <div className={`ad-root ${presenting ? 'is-presenting' : ''}`}>
      <style>{DECK_CSS}</style>

      <div className="ad-toolbar">
        <div className="ad-toolbar-title">
          <strong>Architecture Deck</strong>
          <span>AI Architecture &amp; MLOps Blueprint · Day 3</span>
        </div>
        <div className="ad-toolbar-actions">
          <button type="button" className="ad-btn" onClick={() => setPresenting((p) => !p)} aria-pressed={presenting}>
            {presenting ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
            <span>{presenting ? 'Exit present' : 'Present'}</span>
          </button>
          <button type="button" className="ad-btn ad-btn--primary" onClick={handlePrint} aria-label="Print or save the deck as PDF">
            <Printer size={15} aria-hidden="true" />
            <span>Print / Save as PDF</span>
          </button>
        </div>
      </div>

      <div className="ad-stage-wrap" aria-live="polite">
        <ScaledStage>{renderSlide(current)}</ScaledStage>
      </div>

      <nav className="ad-controls" aria-label="Slide navigation">
        <button type="button" className="ad-btn ad-btn--icon" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous slide">
          <ChevronLeft size={18} aria-hidden="true" />
          <span>Prev</span>
        </button>
        <div className="ad-dots">
          {SLIDES.map((slide, i) => (
            <button
              type="button"
              key={slide.key}
              className={`ad-dot ${i === current ? 'is-active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}: ${slide.eyebrow}`}
              aria-current={i === current ? 'true' : undefined}
            />
          ))}
          <span className="ad-counter">{current + 1} / {total}</span>
        </div>
        <button type="button" className="ad-btn ad-btn--icon" onClick={() => goTo(current + 1)} disabled={current === total - 1} aria-label="Next slide">
          <span>Next</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </nav>
      <p className="ad-hint">Use ← → arrow keys to move between slides.</p>

      <div className="ad-print-source" ref={printSourceRef} aria-hidden="true">
        {SLIDES.map((slide, i) => (
          <div className="ad-print-page" key={slide.key}>
            {renderSlide(i)}
          </div>
        ))}
      </div>
    </div>
  );
}

const DECK_CSS = `
.ad-root, .ad-print-copy {
  --ad-primary: var(--space-brand-primary, #c25733);
  --ad-primary-700: var(--space-brand-primary-700, #a34a24);
  --ad-primary-900: var(--space-brand-primary-900, #6f3218);
  --ad-primary-50: var(--space-brand-primary-50, #faf1ea);
  --ad-primary-100: var(--space-brand-primary-100, #f4e0d2);
  --ad-highlight: var(--space-brand-highlight, #e68a5a);
  --ad-contrast: var(--space-brand-contrast, #2d1f16);
  --ad-ink: var(--space-text-primary, #2d1f16);
  --ad-text-2: var(--space-text-secondary, #5c4838);
  --ad-muted: var(--space-text-muted, #8a7360);
  --ad-page: var(--space-surface-page, #faf7f2);
  --ad-page-alt: var(--space-surface-page-alt, #f3ede3);
  --ad-card: var(--space-surface-card, #fffdfa);
  --ad-soft: var(--space-surface-accent-soft, #f8e9dd);
  --ad-border: var(--space-border-default, #e9dfd1);
  --ad-border-strong: var(--space-border-strong, #d9c9b5);
  --ad-success: var(--space-semantic-success, #16a34a);
  --ad-warning: var(--space-semantic-warning, #d97706);
  --ad-danger: var(--space-semantic-danger, #dc2626);
  font-family: var(--space-font-family, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--ad-ink);
}
.ad-root *, .ad-print-copy * { box-sizing: border-box; }
.ad-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  padding: 16px;
  background: var(--ad-page);
}
.ad-root.is-presenting {
  position: fixed;
  inset: 0;
  z-index: 1000;
  justify-content: center;
  padding: 18px 24px;
  background: var(--ad-contrast);
}
.ad-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ad-toolbar-title { display: flex; flex-direction: column; min-width: 0; }
.ad-toolbar-title strong { font-size: 15px; font-weight: 700; }
.ad-toolbar-title span { font-size: 12px; color: var(--ad-muted); }
.ad-root.is-presenting .ad-toolbar-title strong { color: var(--ad-page); }
.ad-root.is-presenting .ad-toolbar-title span, .ad-root.is-presenting .ad-hint, .ad-root.is-presenting .ad-counter { color: color-mix(in srgb, var(--ad-page) 65%, transparent); }
.ad-toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ad-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 36px; padding: 0 14px;
  border: 1px solid var(--ad-border-strong); border-radius: 999px;
  background: var(--ad-card); color: var(--ad-ink);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: transform .15s ease, background .15s ease, opacity .15s ease;
}
.ad-btn:hover:not(:disabled) { transform: translateY(-1px); background: var(--ad-soft); }
.ad-btn:focus-visible, .ad-dot:focus-visible { outline: 3px solid color-mix(in srgb, var(--ad-primary) 40%, transparent); outline-offset: 2px; }
.ad-btn:disabled { opacity: .4; cursor: default; }
.ad-btn--primary { border-color: var(--ad-primary); background: var(--ad-primary); color: var(--space-text-on-primary, #ffffff); }
.ad-btn--primary:hover:not(:disabled) { background: var(--ad-primary-700); }
.ad-stage-wrap { width: 100%; display: flex; justify-content: center; }
.ad-frame {
  position: relative;
  width: 100%;
  max-width: max(320px, calc((100dvh - 250px) * 16 / 9));
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid var(--ad-border);
  box-shadow: 0 18px 50px var(--space-shell-shadow, rgba(45,31,22,.14));
  background: var(--ad-page);
}
.ad-root.is-presenting .ad-frame { max-width: calc((100dvh - 180px) * 16 / 9); border-color: transparent; }
.ad-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.ad-controls { display: flex; align-items: center; justify-content: center; gap: 14px; }
.ad-btn--icon { padding: 0 12px; }
.ad-dots { display: flex; align-items: center; gap: 8px; }
.ad-dot { width: 9px; height: 9px; padding: 0; border: 0; border-radius: 999px; background: var(--ad-border-strong); cursor: pointer; transition: width .2s ease, background .2s ease; }
.ad-dot.is-active { width: 26px; background: var(--ad-primary); }
.ad-counter { margin-left: 6px; min-width: 42px; font-size: 12px; font-weight: 700; color: var(--ad-muted); font-variant-numeric: tabular-nums; }
.ad-hint { margin: 0; text-align: center; font-size: 11px; color: var(--ad-muted); }
.ad-print-source, .ad-print-copy { display: none; }

/* ---- Slide (fixed 1280 x 720 canvas) ---- */
.ad-slide {
  position: relative; isolation: isolate; overflow: hidden;
  display: flex; flex-direction: column;
  width: 1280px; height: 720px;
  padding: 30px 50px 22px;
  background: var(--ad-page); color: var(--ad-ink);
}
.ad-slide--dark { background: var(--ad-contrast); color: var(--ad-page); }
.ad-orbit {
  position: absolute; right: -230px; top: -340px; z-index: -1;
  width: 660px; height: 660px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--ad-primary) 20%, transparent);
  box-shadow: 0 0 0 100px color-mix(in srgb, var(--ad-primary) 5%, transparent), 0 0 0 200px color-mix(in srgb, var(--ad-primary) 3%, transparent);
}
.ad-slide--dark .ad-orbit { border-color: color-mix(in srgb, var(--ad-highlight) 35%, transparent); box-shadow: 0 0 0 100px color-mix(in srgb, var(--ad-highlight) 7%, transparent), 0 0 0 200px color-mix(in srgb, var(--ad-highlight) 4%, transparent); }
.ad-slide-head { display: flex; align-items: center; justify-content: space-between; height: 30px; flex: 0 0 auto; }
.ad-brand { display: inline-flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 800; letter-spacing: -.02em; color: var(--ad-primary); }
.ad-brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50% 50% 7px 7px; background: var(--ad-primary); color: #ffffff; font-size: 14px; }
.ad-slide--dark .ad-brand { color: var(--ad-page); }
.ad-slide--dark .ad-brand-mark { background: var(--ad-highlight); color: var(--ad-contrast); }
.ad-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: var(--ad-primary); }
.ad-slide--dark .ad-eyebrow { color: var(--ad-highlight); }
.ad-slide-body { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 12px 0 10px; }
.ad-slide-foot { display: flex; justify-content: space-between; flex: 0 0 auto; height: 18px; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ad-muted); }
.ad-slide--dark .ad-slide-foot { color: color-mix(in srgb, var(--ad-page) 55%, transparent); }
.ad-kicker { margin: 0 0 4px; font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: var(--ad-primary); }
.ad-title { margin: 0; font-size: 30px; line-height: 1.1; font-weight: 800; letter-spacing: -.03em; }
.ad-title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.ad-legend { display: flex; align-items: center; gap: 14px; font-size: 12px; font-weight: 600; color: var(--ad-text-2); white-space: nowrap; }
.ad-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ad-legend-line { display: inline-block; width: 26px; border-top: 2px solid var(--ad-muted); }
.ad-legend-line--blocked { border-top: 2px dashed var(--ad-danger); }
.ad-pill {
  display: inline-flex; align-items: center; width: max-content; max-width: 100%;
  padding: 3px 9px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
}
.ad-pill--brand { color: var(--ad-primary-700); background: color-mix(in srgb, var(--ad-primary) 13%, transparent); }
.ad-pill--muted { color: var(--ad-text-2); background: color-mix(in srgb, var(--ad-muted) 16%, transparent); }
.ad-pill--danger { color: var(--space-semantic-danger-700, #b91c1c); background: color-mix(in srgb, var(--ad-danger) 13%, transparent); }
.ad-pill--warning { color: var(--space-semantic-warning-700, #a16207); background: color-mix(in srgb, var(--ad-warning) 15%, transparent); }
.ad-pill--success { color: var(--space-semantic-success-700, #15803d); background: color-mix(in srgb, var(--ad-success) 14%, transparent); }

/* Cover */
.ad-cover { display: flex; flex-direction: column; justify-content: center; height: 100%; max-width: 900px; padding-left: 10px; }
.ad-cover .ad-kicker { color: var(--ad-highlight); font-size: 13px; margin-bottom: 20px; }
.ad-cover-brand { margin: 0; font-size: 150px; line-height: .82; font-weight: 850; letter-spacing: -.07em; color: var(--ad-highlight); }
.ad-cover-title { margin: 26px 0 12px; font-size: 44px; line-height: 1.05; font-weight: 800; letter-spacing: -.035em; color: var(--ad-page); }
.ad-cover-sub { margin: 0; max-width: 720px; font-size: 19px; line-height: 1.45; color: color-mix(in srgb, var(--ad-page) 72%, transparent); }
.ad-cover-author { display: flex; flex-direction: column; gap: 2px; margin-top: 40px; padding-left: 16px; border-left: 4px solid var(--ad-highlight); }
.ad-cover-label { font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--ad-page) 55%, transparent); }
.ad-cover-author strong { font-size: 28px; font-weight: 800; letter-spacing: -.02em; color: var(--ad-page); }
.ad-cover-author span:last-child { font-size: 15px; color: color-mix(in srgb, var(--ad-page) 70%, transparent); }
.ad-cover-meta { display: flex; gap: 26px; margin-top: 34px; font-size: 13px; font-weight: 700; letter-spacing: .04em; color: color-mix(in srgb, var(--ad-page) 60%, transparent); }
.ad-cover-meta span + span::before { content: '·'; margin-right: 26px; color: var(--ad-highlight); }

/* Architecture diagram */
.ad-diagram { position: relative; width: 1180px; height: 490px; }
.ad-diagram-svg { position: absolute; inset: 0; overflow: visible; }
.ad-node {
  position: absolute; display: flex; flex-direction: column; gap: 6px;
  padding: 11px 13px; border-radius: 14px;
  border: 1.5px solid var(--ad-border-strong); background: var(--ad-card);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--ad-contrast) 7%, transparent);
}
.ad-node--brand { border-color: var(--ad-primary); background: var(--ad-primary-50); }
.ad-node--data { border-color: var(--ad-contrast); background: var(--ad-page-alt); }
.ad-node--external { border-style: dashed; }
.ad-node--source { background: var(--ad-soft); }
.ad-node-title { margin: 0; font-size: 14.5px; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; }
.ad-node--brand .ad-node-title { color: var(--ad-primary-700); }
.ad-node-sub { margin: 0; font-size: 12px; line-height: 1.4; color: var(--ad-text-2); }
.ad-node-sub b { color: var(--ad-ink); font-weight: 700; }
.ad-node-sub--bottom { margin-top: auto; font-size: 11.5px; color: var(--ad-muted); }
.ad-code { display: block; padding: 4px 6px; border-radius: 6px; background: var(--ad-page-alt); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5px; line-height: 1.3; color: var(--ad-primary-900); white-space: nowrap; overflow: hidden; text-overflow: clip; }
.ad-table-chip { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; padding: 10px 11px; border-radius: 10px; border: 1px solid var(--ad-border-strong); background: var(--ad-card); }
.ad-table-chip strong { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: var(--ad-primary-700); }
.ad-table-chip span { font-size: 11.5px; line-height: 1.4; color: var(--ad-text-2); }
.ad-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.ad-dim-chip { padding: 8px 14px; border-radius: 999px; background: var(--ad-primary); color: #ffffff; font-size: 13px; font-weight: 700; }
.ad-source-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; border-radius: 9px; background: var(--ad-card); font-size: 13px; font-weight: 700; }
.ad-edge-label { position: absolute; transform: translateX(-50%); padding: 2px 8px; border-radius: 999px; background: var(--ad-page); border: 1px solid var(--ad-border); font-size: 11px; font-weight: 700; color: var(--ad-text-2); white-space: nowrap; }

/* Tables */
.ad-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; border: 1px solid var(--ad-border-strong); border-radius: 12px; overflow: hidden; background: var(--ad-card); }
.ad-table th { padding: 9px 10px; text-align: left; font-size: 10.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffffff; background: var(--ad-contrast); }
.ad-table td { padding: 9px 10px; vertical-align: top; font-size: 12.5px; line-height: 1.38; color: var(--ad-text-2); border-top: 1px solid var(--ad-border); }
.ad-table tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--ad-page-alt) 70%, transparent); }
.ad-cell-failure { position: relative; padding-left: 38px !important; font-weight: 700; color: var(--ad-ink) !important; font-size: 13px !important; }
.ad-row-num { position: absolute; left: 10px; top: 9px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--ad-primary); color: #ffffff; font-size: 11px; font-weight: 800; }
.ad-cell-note { display: block; margin-top: 6px; font-size: 11.5px; color: var(--ad-muted); }
.ad-two-col { display: grid; grid-template-columns: 500px 1fr; gap: 22px; align-items: start; }
.ad-two-col--rubric { grid-template-columns: 760px 1fr; }
.ad-table--tooling td { font-size: 12px; padding: 8px 10px; }
.ad-cell-layer { font-weight: 800; font-size: 11px !important; letter-spacing: .08em; text-transform: uppercase; color: var(--ad-primary-700) !important; }
.ad-cell-tool { font-weight: 700; color: var(--ad-ink) !important; }
.ad-cell-tool .ad-pill { margin-top: 4px; display: flex; }
.ad-backlog { display: flex; flex-direction: column; gap: 14px; }
.ad-week { border: 1px solid var(--ad-border-strong); border-radius: 12px; overflow: hidden; background: var(--ad-card); }
.ad-week-head { display: flex; align-items: baseline; gap: 10px; padding: 9px 14px; background: var(--ad-primary); color: #ffffff; }
.ad-week-head strong { font-size: 14px; font-weight: 800; }
.ad-week-head span { font-size: 12px; font-weight: 600; opacity: .85; }
.ad-week-list { margin: 0; padding: 4px 14px 6px; list-style: none; }
.ad-week-list li { display: grid; grid-template-columns: 74px 1fr; gap: 10px; padding: 8px 0; font-size: 12.5px; line-height: 1.4; color: var(--ad-text-2); border-top: 1px solid var(--ad-border); }
.ad-week-list li:first-child { border-top: 0; }
.ad-days { font-weight: 800; color: var(--ad-primary-700); white-space: nowrap; }
.ad-table--rubric td { padding: 13px 10px; font-size: 13px; }
.ad-cell-criterion { font-weight: 700; color: var(--ad-ink) !important; }
.ad-footnote { margin: 10px 0 0; font-size: 11.5px; color: var(--ad-muted); }
.ad-pitfalls { border-radius: 14px; padding: 16px 18px; background: var(--ad-contrast); color: var(--ad-page); }
.ad-pitfalls-head { margin: 0 0 8px; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--ad-highlight); }
.ad-pitfalls ul { margin: 0; padding: 0; list-style: none; }
.ad-pitfalls li { display: flex; flex-direction: column; gap: 3px; padding: 10px 0; border-top: 1px solid color-mix(in srgb, var(--ad-page) 14%, transparent); }
.ad-pitfalls li:first-child { border-top: 0; }
.ad-pitfalls strong { font-size: 14px; font-weight: 800; }
.ad-pitfalls span { font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--ad-page) 72%, transparent); }

@media (max-width: 640px) {
  .ad-root { padding: 10px; }
  .ad-btn span { display: none; }
  .ad-btn--primary span { display: inline; }
  .ad-hint { display: none; }
}

@media print {
  @page { size: 13.34in 7.5in; margin: 0; }
  html, body {
    width: 1280px !important; height: auto !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important;
    overflow: visible !important; position: static !important;
    background: var(--space-surface-page, #faf7f2) !important;
  }
  body > *:not(.ad-print-copy) { display: none !important; }
  .ad-print-copy { display: block !important; width: 1280px; }
  .ad-print-page {
    width: 1280px; height: 720px; overflow: hidden;
    break-after: page; page-break-after: always;
    break-inside: avoid; page-break-inside: avoid;
  }
  .ad-print-page:last-child { break-after: auto; page-break-after: auto; }
  .ad-print-copy, .ad-print-copy * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .ad-toolbar, .ad-controls, .ad-hint { display: none !important; }
}
`;
