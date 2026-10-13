import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Check,
  Clock3,
  Download,
  Home,
  MapPin,
  MessageCircle,
  Radio,
  Search,
  ShieldCheck,
  Waves,
  Zap,
} from 'lucide-react';

const TOTAL_SLIDES = 11;

const problemItems = [
  'Renters pay 2–3 agent fees just to see listings',
  "Drive across the city to properties that don't match photos",
  'Sign leases blind — only discover flooding, poor power, security issues after moving in',
  "No recourse once you've paid",
];

const verificationDimensions = [
  { label: 'Flood risk', icon: Waves },
  { label: 'DisCo power band', icon: Zap },
  { label: 'Security signals', icon: ShieldCheck },
  { label: 'Network coverage', icon: Radio },
  { label: 'Commute time', icon: Clock3 },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`pd-brand ${inverse ? 'pd-brand--inverse' : ''}`} aria-label="Veranda">
      <span className="pd-brand-mark">V</span>
      <span>Veranda</span>
    </div>
  );
}

function SlideFrame({
  number,
  eyebrow,
  children,
  dark = false,
  accent = false,
}: {
  number: number;
  eyebrow: string;
  children: ReactNode;
  dark?: boolean;
  accent?: boolean;
}) {
  return (
    <section
      className={`pd-slide ${dark ? 'pd-slide--dark' : ''} ${accent ? 'pd-slide--accent' : ''}`}
      aria-label={`Slide ${number} of ${TOTAL_SLIDES}: ${eyebrow}`}
    >
      <div className="pd-orbit" aria-hidden="true" />
      <header className="pd-slide-header">
        <Brand inverse={dark || accent} />
        <span className="pd-eyebrow">{eyebrow}</span>
      </header>
      <div className="pd-slide-content">{children}</div>
      <footer className="pd-slide-footer">
        <span>YOURVERANDA.COM</span>
        <span>{String(number).padStart(2, '0')} / {TOTAL_SLIDES}</span>
      </footer>
    </section>
  );
}

export default function PitchDeckApp() {
  const [current, setCurrent] = useState(0);

  const goTo = (index: number) => {
    setCurrent(Math.max(0, Math.min(TOTAL_SLIDES - 1, index)));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goTo(current + 1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(current - 1);
      }
      if (event.key === 'Home') goTo(0);
      if (event.key === 'End') goTo(TOTAL_SLIDES - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current]);

  return (
    <div className="pitch-deck">
      <style>{`
        .pitch-deck {
          --pd-cream: #FAF7F2;
          --pd-paper: #FFFDF9;
          --pd-terracotta: #C25733;
          --pd-terracotta-dark: #8E3B23;
          --pd-ink: #211915;
          --pd-muted: #75665D;
          --pd-line: #E5D9CF;
          --pd-green: #315F4A;
          position: fixed;
          inset: 0;
          z-index: 1000;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          overflow: hidden;
          color: var(--pd-ink);
          background: var(--pd-cream);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .pitch-deck * { box-sizing: border-box; }
        .pd-stage { position: absolute; inset: 0; }
        .pd-stage-item {
          position: absolute;
          inset: 0;
          opacity: 0;
          visibility: hidden;
          transform: translate3d(4%, 0, 0);
          transition: opacity .35s ease, transform .5s cubic-bezier(.2,.8,.2,1), visibility .35s;
          pointer-events: none;
        }
        .pd-stage-item.is-active { opacity: 1; visibility: visible; transform: none; pointer-events: auto; }
        .pd-slide {
          position: relative;
          display: flex;
          flex-direction: column;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          padding: clamp(24px, 3vw, 46px) clamp(28px, 6vw, 96px) clamp(28px, 4vw, 58px);
          overflow: hidden;
          isolation: isolate;
          background: var(--pd-cream);
        }
        .pd-slide--dark { color: var(--pd-cream); background: var(--pd-ink); }
        .pd-slide--accent { color: white; background: var(--pd-terracotta); }
        .pd-orbit {
          position: absolute;
          right: -18vw;
          top: -27vw;
          z-index: -1;
          width: 52vw;
          aspect-ratio: 1;
          border: 1px solid color-mix(in srgb, var(--pd-terracotta) 18%, transparent);
          border-radius: 50%;
          box-shadow: 0 0 0 8vw color-mix(in srgb, var(--pd-terracotta) 4%, transparent), 0 0 0 16vw color-mix(in srgb, var(--pd-terracotta) 2%, transparent);
        }
        .pd-slide--dark .pd-orbit, .pd-slide--accent .pd-orbit {
          border-color: rgba(255,255,255,.2);
          box-shadow: 0 0 0 8vw rgba(255,255,255,.035), 0 0 0 16vw rgba(255,255,255,.018);
        }
        .pd-slide-header, .pd-slide-footer { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; }
        .pd-slide-header { min-height: 42px; }
        .pd-slide-footer {
          color: var(--pd-muted);
          font-size: clamp(9px, .68vw, 12px);
          font-weight: 800;
          letter-spacing: .14em;
        }
        .pd-slide--dark .pd-slide-footer, .pd-slide--accent .pd-slide-footer { color: rgba(255,255,255,.62); }
        .pd-brand { display: inline-flex; align-items: center; gap: 10px; color: var(--pd-terracotta); font-size: 18px; font-weight: 850; letter-spacing: -.03em; }
        .pd-brand-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50% 50% 8px 8px; color: white; background: var(--pd-terracotta); font-size: 15px; }
        .pd-brand--inverse { color: white; }
        .pd-brand--inverse .pd-brand-mark { color: var(--pd-terracotta); background: var(--pd-cream); }
        .pd-eyebrow { color: var(--pd-terracotta); font-size: clamp(10px, .72vw, 13px); font-weight: 850; letter-spacing: .18em; text-transform: uppercase; }
        .pd-slide--dark .pd-eyebrow, .pd-slide--accent .pd-eyebrow { color: rgba(255,255,255,.7); }
        .pd-slide-content { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; justify-content: center; padding: clamp(20px, 3.4vh, 44px) 0; }
        .pd-kicker { margin: 0 0 16px; color: var(--pd-terracotta); font-size: clamp(11px, .8vw, 14px); font-weight: 850; letter-spacing: .2em; text-transform: uppercase; }
        .pd-slide--dark .pd-kicker, .pd-slide--accent .pd-kicker { color: rgba(255,255,255,.68); }
        .pd-title { max-width: 1100px; margin: 0 0 clamp(20px, 3vh, 38px); font-size: clamp(35px, 5.2vw, 78px); line-height: .98; letter-spacing: -.052em; font-weight: 820; }
        .pd-title--hero { max-width: none; margin-bottom: 24px; color: var(--pd-terracotta); font-size: clamp(76px, 13vw, 190px); line-height: .76; letter-spacing: -.075em; }
        .pd-subtitle { max-width: 900px; margin: 0; color: var(--pd-muted); font-size: clamp(18px, 2vw, 30px); line-height: 1.35; }
        .pd-slide--dark .pd-subtitle, .pd-slide--accent .pd-subtitle { color: rgba(255,255,255,.75); }
        .pd-cover { align-items: center; text-align: center; }
        .pd-cover .pd-subtitle { max-width: 760px; }
        .pd-cover-meta { display: flex; gap: 12px 34px; flex-wrap: wrap; justify-content: center; margin-top: clamp(30px, 6vh, 68px); color: var(--pd-muted); font-size: clamp(12px, .9vw, 16px); font-weight: 700; letter-spacing: .04em; }
        .pd-cover-meta span + span::before { content: '·'; margin-right: 34px; color: var(--pd-terracotta); }
        .pd-grid-2, .pd-grid-3, .pd-grid-4, .pd-grid-5 { display: grid; gap: clamp(12px, 1.6vw, 24px); }
        .pd-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pd-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .pd-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .pd-grid-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .pd-card {
          padding: clamp(18px, 2vw, 30px);
          border: 1px solid var(--pd-line);
          border-radius: 18px;
          background: rgba(255,255,255,.56);
        }
        .pd-slide--dark .pd-card, .pd-slide--accent .pd-card { border-color: rgba(255,255,255,.17); background: rgba(255,255,255,.075); }
        .pd-card h3 { margin: 0 0 10px; font-size: clamp(16px, 1.35vw, 23px); letter-spacing: -.025em; }
        .pd-card p { margin: 0; color: var(--pd-muted); font-size: clamp(12px, .95vw, 16px); line-height: 1.5; }
        .pd-slide--dark .pd-card p, .pd-slide--accent .pd-card p { color: rgba(255,255,255,.72); }
        .pd-list { display: grid; gap: clamp(12px, 1.8vh, 20px); margin: 0; padding: 0; list-style: none; }
        .pd-list li { position: relative; padding-left: 34px; font-size: clamp(15px, 1.35vw, 22px); line-height: 1.4; }
        .pd-list li::before { content: ''; position: absolute; left: 0; top: .56em; width: 9px; height: 9px; border-radius: 50%; background: var(--pd-terracotta); box-shadow: 0 0 0 5px rgba(194,87,51,.12); }
        .pd-quote { margin: 0; padding: clamp(22px, 2.8vw, 42px); border-left: 5px solid var(--pd-terracotta); color: var(--pd-terracotta-dark); background: white; font-size: clamp(17px, 1.65vw, 27px); font-weight: 650; line-height: 1.42; letter-spacing: -.02em; }
        .pd-note { margin: 22px 0 0; color: var(--pd-muted); font-size: clamp(12px, .9vw, 15px); }
        .pd-market-stat { display: flex; align-items: baseline; gap: 12px; margin: 0 0 12px; color: var(--pd-terracotta); }
        .pd-market-stat strong { font-size: clamp(54px, 7vw, 108px); line-height: .85; letter-spacing: -.065em; }
        .pd-market-stat span { max-width: 280px; font-size: clamp(14px, 1.25vw, 20px); font-weight: 750; line-height: 1.2; }
        .pd-competitors { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
        .pd-chip { padding: 9px 13px; border: 1px solid var(--pd-line); border-radius: 999px; color: var(--pd-muted); background: white; font-size: clamp(11px, .8vw, 14px); font-weight: 750; }
        .pd-lifecycle .pd-card { min-height: 220px; border-top: 5px solid var(--pd-terracotta); }
        .pd-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 28px; border-radius: 14px; color: var(--pd-terracotta); background: #F2DED5; }
        .pd-lifecycle h3 { font-size: clamp(25px, 2.6vw, 42px); }
        .pd-lifecycle-arrow { position: absolute; right: -22px; top: 50%; z-index: 2; color: var(--pd-terracotta); transform: translateY(-50%); }
        .pd-lifecycle-card { position: relative; }
        .pd-tagline { margin: clamp(22px, 3vh, 36px) 0 0; text-align: center; color: var(--pd-terracotta); font-size: clamp(17px, 1.6vw, 26px); font-weight: 850; }
        .pd-product-layout { display: grid; grid-template-columns: .85fr 1.15fr; gap: clamp(24px, 5vw, 78px); align-items: center; }
        .pd-report {
          overflow: hidden;
          border: 1px solid var(--pd-line);
          border-radius: 22px;
          background: white;
          box-shadow: 0 22px 70px rgba(64,35,24,.13);
        }
        .pd-report-top { display: flex; justify-content: space-between; align-items: center; padding: 16px 22px; border-bottom: 1px solid var(--pd-line); font-size: 12px; font-weight: 800; }
        .pd-report-body { padding: clamp(18px, 2vw, 28px); }
        .pd-report-address { margin: 0 0 22px; font-size: clamp(17px, 1.6vw, 25px); font-weight: 800; }
        .pd-dimension-row { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--pd-line); font-size: clamp(11px, .82vw, 14px); }
        .pd-dimension-row svg { color: var(--pd-terracotta); }
        .pd-status { padding: 5px 8px; border-radius: 999px; color: var(--pd-green); background: #E6F0EA; font-size: 10px; font-weight: 850; text-transform: uppercase; }
        .pd-product-list { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
        .pd-product-list li { display: flex; gap: 12px; align-items: flex-start; color: var(--pd-muted); font-size: clamp(13px, 1vw, 17px); line-height: 1.45; }
        .pd-product-list svg { flex: 0 0 auto; margin-top: 2px; color: var(--pd-terracotta); }
        .pd-price-card { display: flex; flex-direction: column; min-height: 290px; }
        .pd-price-card--featured { color: white; border-color: var(--pd-terracotta); background: var(--pd-terracotta); box-shadow: 0 20px 55px rgba(194,87,51,.22); }
        .pd-tier { margin: 0 0 24px; font-size: 12px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
        .pd-price { margin: 0 0 18px; font-size: clamp(38px, 4.5vw, 70px); font-weight: 850; line-height: .9; letter-spacing: -.055em; }
        .pd-price small { font-size: .26em; letter-spacing: 0; }
        .pd-price-card--featured p { color: rgba(255,255,255,.78); }
        .pd-retention { margin-top: 18px; padding: 16px 20px; border-radius: 14px; color: var(--pd-terracotta-dark); background: #F4E6DE; font-size: clamp(12px, .9vw, 15px); font-weight: 750; }
        .pd-stat-card { min-height: 190px; }
        .pd-stat { margin: 0 0 12px; color: #FFD9CA; font-size: clamp(46px, 6vw, 92px); font-weight: 850; line-height: .8; letter-spacing: -.06em; }
        .pd-stat-card h3 { font-size: clamp(14px, 1.2vw, 21px); }
        .pd-gtm-callout { margin-bottom: clamp(22px, 3vh, 36px); padding: clamp(22px, 3vw, 38px); border-radius: 18px; color: white; background: var(--pd-terracotta); font-size: clamp(18px, 1.8vw, 30px); font-weight: 750; line-height: 1.35; letter-spacing: -.02em; }
        .pd-padi { color: var(--pd-terracotta); font-size: clamp(42px, 5vw, 78px); font-weight: 850; line-height: .9; letter-spacing: -.055em; }
        .pd-founder-story { max-width: 1020px; font-size: clamp(20px, 2.1vw, 34px); line-height: 1.38; letter-spacing: -.025em; }
        .pd-belief { margin-top: 24px; padding: 20px 24px; border-left: 4px solid #FFD9CA; background: rgba(255,255,255,.08); font-size: clamp(14px, 1.2vw, 20px); font-weight: 700; }
        .pd-vision { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: clamp(16px, 2.5vw, 34px); }
        .pd-vision::before { content: ''; position: absolute; left: 12%; right: 12%; top: 22px; height: 2px; background: var(--pd-line); }
        .pd-vision-step { position: relative; padding-top: 56px; }
        .pd-vision-step::before { content: ''; position: absolute; top: 13px; left: 0; width: 18px; height: 18px; border: 6px solid var(--pd-cream); border-radius: 50%; background: var(--pd-terracotta); box-shadow: 0 0 0 2px var(--pd-terracotta); }
        .pd-vision-step span { color: var(--pd-terracotta); font-size: 11px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
        .pd-vision-step h3 { margin: 10px 0; font-size: clamp(18px, 1.7vw, 28px); line-height: 1.1; }
        .pd-vision-step p { margin: 0; color: var(--pd-muted); font-size: clamp(12px, .92vw, 15px); line-height: 1.5; }
        .pd-closing-line { margin: clamp(28px, 4vh, 48px) 0 0; color: var(--pd-terracotta-dark); font-size: clamp(18px, 1.65vw, 28px); font-weight: 800; text-align: center; }
        .pd-ask-amount { display: inline-block; margin-bottom: 18px; padding: 10px 16px; border: 2px dashed rgba(255,255,255,.55); border-radius: 10px; color: white; background: rgba(255,255,255,.08); font-size: clamp(28px, 4vw, 62px); font-weight: 850; letter-spacing: -.04em; }
        .pd-ask-instruction { max-width: 780px; margin: 0 0 34px; color: rgba(255,255,255,.74); font-size: clamp(14px, 1.1vw, 18px); }
        .pd-use-card h3 { color: #FFD9CA; }
        .pd-toolbar {
          position: fixed;
          top: 18px;
          right: 18px;
          z-index: 1100;
          display: flex;
          gap: 8px;
        }
        .pd-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
          padding: 0 16px;
          border: 1px solid rgba(33,25,21,.12);
          border-radius: 999px;
          color: var(--pd-ink);
          background: rgba(250,247,242,.9);
          box-shadow: 0 8px 28px rgba(33,25,21,.1);
          backdrop-filter: blur(12px);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 850;
        }
        .pd-button { text-decoration: none; }
        .pd-button:hover { transform: translateY(-1px); }
        .pd-button:focus-visible { outline: 3px solid rgba(194,87,51,.35); outline-offset: 2px; }
        .pd-button--print { color: white; border-color: var(--pd-terracotta); background: var(--pd-terracotta); }
        .pd-controls {
          position: fixed;
          right: 22px;
          bottom: 20px;
          z-index: 1100;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pd-counter { min-width: 70px; color: var(--pd-muted); font-size: 12px; font-weight: 850; text-align: center; }
        .pd-icon-button { width: 42px; padding: 0; }
        .pd-progress { position: fixed; left: 0; bottom: 0; z-index: 1101; height: 4px; background: var(--pd-terracotta); transition: width .3s ease; }
        .pd-help { position: fixed; left: 22px; bottom: 20px; z-index: 1100; color: var(--pd-muted); font-size: 11px; font-weight: 700; }

        @media (max-width: 760px) {
          .pd-slide { padding: 20px 20px 70px; }
          .pd-slide-content { overflow-y: auto; justify-content: flex-start; padding-top: 72px; }
          .pd-grid-2, .pd-grid-3, .pd-grid-4, .pd-grid-5, .pd-product-layout, .pd-vision { grid-template-columns: 1fr; }
          .pd-cover { justify-content: center; padding-top: 20px; }
          .pd-grid-3, .pd-grid-4, .pd-grid-5 { gap: 10px; }
          .pd-card { padding: 15px; }
          .pd-lifecycle .pd-card, .pd-price-card, .pd-stat-card { min-height: auto; }
          .pd-lifecycle-arrow, .pd-vision::before { display: none; }
          .pd-icon { margin-bottom: 12px; }
          .pd-report { margin-bottom: 12px; }
          .pd-market-stat strong { font-size: 58px; }
          .pd-cover-meta span + span::before { margin-right: 10px; }
          .pd-toolbar { top: 12px; right: 12px; }
          .pd-button span { display: none; }
          .pd-button { width: 42px; padding: 0; }
          .pd-help { display: none; }
          .pd-controls { right: 12px; bottom: 12px; }
          .pd-slide-header .pd-eyebrow { display: none; }
          .pd-slide-footer { display: none; }
        }

        @media print {
          @page { size: 13.333in 7.5in; margin: 0; }
          html, body { width: 13.333in !important; height: auto !important; margin: 0 !important; overflow: visible !important; background: var(--pd-cream) !important; }
          .pitch-deck { position: static !important; width: 13.333in !important; height: auto !important; overflow: visible !important; }
          .pd-stage { position: static !important; }
          .pd-stage-item, .pd-stage-item.is-active {
            position: static !important;
            display: block !important;
            width: 13.333in !important;
            height: 7.5in !important;
            opacity: 1 !important;
            visibility: visible !important;
            transform: none !important;
            pointer-events: auto !important;
            break-after: page;
            page-break-after: always;
          }
          .pd-stage-item:last-child { break-after: auto; page-break-after: auto; }
          .pd-slide { width: 13.333in !important; height: 7.5in !important; padding: .35in .65in .38in !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .pd-slide-content { overflow: hidden !important; padding: .2in 0 !important; }
          .pd-toolbar, .pd-controls, .pd-progress, .pd-help { display: none !important; }
          .pd-title { font-size: 46px !important; margin-bottom: 22px !important; }
          .pd-title--hero { font-size: 104px !important; }
          .pd-subtitle { font-size: 21px !important; }
          .pd-card { padding: 18px !important; }
          .pd-price-card { min-height: 230px !important; }
          .pd-stat-card { min-height: 155px !important; }
          .pd-lifecycle .pd-card { min-height: 185px !important; }
        }
      `}</style>

      <div className="pd-toolbar">
        <a className="pd-button" href="?app=veranda" aria-label="Back to Veranda">
          <Home size={16} aria-hidden="true" />
          <span>Back to Veranda</span>
        </a>
        <button className="pd-button pd-button--print" type="button" onClick={() => window.print()} aria-label="Save pitch deck as PDF">
          <Download size={16} aria-hidden="true" />
          <span>Save as PDF</span>
        </button>
      </div>

      <main className="pd-stage" aria-live="polite">
        <div className={`pd-stage-item ${current === 0 ? 'is-active' : ''}`} aria-hidden={current !== 0}>
          <SlideFrame number={1} eyebrow="Investor pitch · 2026">
            <div className="pd-slide-content pd-cover">
              <h1 className="pd-title pd-title--hero">Veranda</h1>
              <p className="pd-subtitle">Verify before you sign. Settle after you move.</p>
              <div className="pd-cover-meta">
                <span>yourveranda.com</span><span>Lagos, Nigeria</span><span>2026</span>
              </div>
            </div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 1 ? 'is-active' : ''}`} aria-hidden={current !== 1}>
          <SlideFrame number={2} eyebrow="The problem">
            <h2 className="pd-title">House hunting in Lagos is broken.</h2>
            <div className="pd-grid-2">
              <ul className="pd-list">
                {problemItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <blockquote className="pd-quote">“I found out about the flood risk and poor security only after I had signed and moved in. The cost of finding out came too late.”</blockquote>
            </div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 2 ? 'is-active' : ''}`} aria-hidden={current !== 2}>
          <SlideFrame number={3} eyebrow="The market">
            <h2 className="pd-title">Nigeria’s urban rental market is massive and underserved.</h2>
            <div className="pd-grid-2">
              <div>
                <p className="pd-market-stat"><strong>21M</strong><span>people live in Lagos</span></p>
                <p className="pd-market-stat"><strong>60%+</strong><span>are renters</span></p>
              </div>
              <div>
                <ul className="pd-list">
                  <li>No structured pre-commitment due diligence product exists today</li>
                  <li>Existing proptech stops at listings — none verify or settle</li>
                  <li>Beachhead: Lagos renters receiving agent addresses via WhatsApp</li>
                </ul>
                <div className="pd-competitors" aria-label="Existing property listing platforms">
                  <span className="pd-chip">Jiji</span><span className="pd-chip">PropertyPro</span><span className="pd-chip">NigeriaPropertyCentre</span>
                </div>
              </div>
            </div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 3 ? 'is-active' : ''}`} aria-hidden={current !== 3}>
          <SlideFrame number={4} eyebrow="Our solution">
            <h2 className="pd-title">Veranda completes the full house-hunting lifecycle.</h2>
            <div className="pd-grid-3 pd-lifecycle">
              {[
                { label: 'Find', icon: Search, copy: 'Aggregated, current listings from major portals' },
                { label: 'Verify', icon: ShieldCheck, copy: 'Flood zone · Power/DisCo band · Security · Network · Commute' },
                { label: 'Settle', icon: Home, copy: 'Local discovery: utilities, schools, gyms and artisans' },
              ].map(({ label, icon: Icon, copy }, index) => (
                <article className="pd-card pd-lifecycle-card" key={label}>
                  <div className="pd-icon"><Icon size={25} /></div>
                  <h3>{label}</h3><p>{copy}</p>
                  {index < 2 && <ArrowRight className="pd-lifecycle-arrow" size={28} aria-hidden="true" />}
                </article>
              ))}
            </div>
            <p className="pd-tagline">We’re not another listing site. We’re the intelligence layer.</p>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 4 ? 'is-active' : ''}`} aria-hidden={current !== 4}>
          <SlideFrame number={5} eyebrow="Product">
            <div className="pd-product-layout">
              <div>
                <h2 className="pd-title">A verified property report in under 2 minutes.</h2>
                <ul className="pd-product-list">
                  <li><Check size={18} />Enter any Lagos address</li>
                  <li><Check size={18} />Get a 5-dimension verification report</li>
                  <li><Check size={18} />Ask the AI agent follow-up questions</li>
                  <li><Check size={18} />See a sample report before signup — no blind-buy</li>
                </ul>
              </div>
              <div className="pd-report" aria-label="Illustrative Veranda verification report">
                <div className="pd-report-top"><span>VERANDA REPORT</span><span>Ready in 01:42</span></div>
                <div className="pd-report-body">
                  <p className="pd-report-address"><MapPin size={19} style={{ verticalAlign: '-3px', marginRight: 7 }} />15 Bode Thomas Street, Surulere</p>
                  {verificationDimensions.map(({ label, icon: Icon }, index) => (
                    <div className="pd-dimension-row" key={label}>
                      <Icon size={18} /><span>{label}</span><span className="pd-status">{index === 0 ? 'Low risk' : 'Checked'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="pd-note">Currently live at yourveranda.com · Covering 23 Lagos zones</p>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 5 ? 'is-active' : ''}`} aria-hidden={current !== 5}>
          <SlideFrame number={6} eyebrow="Business model">
            <h2 className="pd-title">Freemium → Monthly Subscription</h2>
            <div className="pd-grid-2">
              <article className="pd-card pd-price-card">
                <p className="pd-tier">Free</p><p className="pd-price">5 <small>reports</small></p>
                <p>Email only. No credit card. See value before making a commitment.</p>
              </article>
              <article className="pd-card pd-price-card pd-price-card--featured">
                <p className="pd-tier">Paid</p><p className="pd-price">₦7,000<small> / month</small></p>
                <p>Unlimited reports. Cancel anytime.</p>
              </article>
            </div>
            <div className="pd-retention"><strong>Retention hook:</strong> flood season alerts · DisCo band changes · Settle features &nbsp; <strong>Trust bridge:</strong> full sample report before payment</div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 6 ? 'is-active' : ''}`} aria-hidden={current !== 6}>
          <SlideFrame number={7} eyebrow="Traction" dark>
            <h2 className="pd-title">Early validation — zero paid acquisition.</h2>
            <div className="pd-grid-4">
              {[
                ['14', 'self-selected contacts from one WhatsApp status post'],
                ['93%', 'email capture rate · 13 of 14'],
                ['23', 'Lagos zones covered'],
                ['Daily', 'listing ingestion live'],
              ].map(([stat, label]) => (
                <article className="pd-card pd-stat-card" key={label}><p className="pd-stat">{stat}</p><h3>{label}</h3></article>
              ))}
            </div>
            <p className="pd-subtitle" style={{ marginTop: 28 }}>Goal: first ₦7,000 subscription from this cohort</p>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 7 ? 'is-active' : ''}`} aria-hidden={current !== 7}>
          <SlideFrame number={8} eyebrow="Go-to-market">
            <h2 className="pd-title">Channel v0: Founder-led, personal voice.</h2>
            <div className="pd-gtm-callout">“When the agent drops an address in WhatsApp — before you reply, run it on Veranda.”</div>
            <div className="pd-grid-3">
              <article className="pd-card"><MessageCircle className="pd-icon" style={{ padding: 12 }} /><h3>Warm start</h3><p>Direct email to the 14-contact cohort</p></article>
              <article className="pd-card"><div className="pd-padi">Padi</div><h3>Community identity</h3><p>Nigerian Pidgin for friend. Greeting: “How far padi,”</p></article>
              <article className="pd-card"><ArrowRight className="pd-icon" style={{ padding: 12 }} /><h3>Next channels</h3><p>Referral from satisfied renters + WhatsApp group seeding</p></article>
            </div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 8 ? 'is-active' : ''}`} aria-hidden={current !== 8}>
          <SlideFrame number={9} eyebrow="Why now / why us" accent>
            <h2 className="pd-title">Founder-market fit is as strong as it gets.</h2>
            <p className="pd-founder-story">The founder lived the exact pain: paid multiple agents, drove across Lagos, and moved into a home with hidden flood, security and power issues — then built the tool they desperately needed.</p>
            <div className="pd-grid-2" style={{ marginTop: 30 }}>
              <div className="pd-belief">“Existing solutions are not intelligent enough and don’t complete the lifecycle of house hunting.”</div>
              <div className="pd-belief"><strong>Incumbents are transaction-focused.</strong><br />Veranda is transition-focused.</div>
            </div>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 9 ? 'is-active' : ''}`} aria-hidden={current !== 9}>
          <SlideFrame number={10} eyebrow="Vision">
            <h2 className="pd-title">Veranda is the infrastructure layer for Nigerian renters.</h2>
            <div className="pd-vision">
              <div className="pd-vision-step"><span>Today</span><h3>Verify before you sign</h3><p>Lagos-wide property intelligence before the money moves.</p></div>
              <div className="pd-vision-step"><span>Next</span><h3>Neighbourhood monitoring</h3><p>Flood, power and local changes after signing.</p></div>
              <div className="pd-vision-step"><span>North star</span><h3>Concierge tier</h3><p>Done-for-you shortlist, verification, agent vetting and 30-day settle support · ~₦155,000/engagement.</p></div>
            </div>
            <p className="pd-closing-line">“The veranda is where you land after the journey. That’s what we’re building.”</p>
          </SlideFrame>
        </div>

        <div className={`pd-stage-item ${current === 10 ? 'is-active' : ''}`} aria-hidden={current !== 10}>
          <SlideFrame number={11} eyebrow="The ask" dark>
            <div className="pd-ask-amount">[Your Ask]</div>
            <p className="pd-ask-instruction">Replace this placeholder with the raise amount, the runway or timeline it funds, and the milestone that capital unlocks before sharing externally.</p>
            <div className="pd-grid-3">
              <article className="pd-card pd-use-card"><Building size={28} /><h3>Data infrastructure</h3><p>Broader, fresher verification coverage.</p></article>
              <article className="pd-card pd-use-card"><MessageCircle size={28} /><h3>Growth</h3><p>WhatsApp distribution + Padi community.</p></article>
              <article className="pd-card pd-use-card"><Users size={28} /><h3>Team</h3><p>Product, data and operations capacity.</p></article>
            </div>
          </SlideFrame>
        </div>
      </main>

      <div className="pd-help">Use ← → arrow keys to navigate</div>
      <div className="pd-controls" aria-label="Slide controls">
        <button className="pd-button pd-icon-button" type="button" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous slide"><ArrowLeft size={17} /></button>
        <span className="pd-counter" aria-label={`Slide ${current + 1} of ${TOTAL_SLIDES}`}>{current + 1} / {TOTAL_SLIDES}</span>
        <button className="pd-button pd-icon-button" type="button" onClick={() => goTo(current + 1)} disabled={current === TOTAL_SLIDES - 1} aria-label="Next slide"><ArrowRight size={17} /></button>
      </div>
      <div className="pd-progress" style={{ width: `${((current + 1) / TOTAL_SLIDES) * 100}%` }} aria-hidden="true" />
    </div>
  );
}
