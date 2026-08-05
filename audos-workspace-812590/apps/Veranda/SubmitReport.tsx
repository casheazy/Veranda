import { useRef, useState } from 'react';
import {
  Droplets,
  Zap,
  Camera,
  Loader2,
  CheckCircle2,
  X,
  Link as LinkIcon,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { AREAS, AreaKey } from './types';

const SEVERITIES = [
  { value: 'none', label: 'No flooding' },
  { value: 'ankle', label: 'Ankle-deep' },
  { value: 'knee', label: 'Knee-deep' },
  { value: 'waist', label: 'Waist-deep' },
  { value: 'severe', label: 'Severe' },
];

interface SubmitReportProps {
  presetAreaKey?: AreaKey | null;
  presetStreet?: string;
  onSubmitted: () => void;
}

export default function SubmitReport({ presetAreaKey, presetStreet, onSubmitted }: SubmitReportProps) {
  const [reportType, setReportType] = useState<'flood' | 'power'>('flood');
  const [areaKey, setAreaKey] = useState<AreaKey>(presetAreaKey || 'surulere');
  const [street, setStreet] = useState(presetStreet || '');
  const [reporterName, setReporterName] = useState('');
  const [description, setDescription] = useState('');
  // flood fields
  const [eventPeriod, setEventPeriod] = useState('');
  const [severity, setSeverity] = useState('knee');
  // evidence — offered on both report types
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // power fields
  const [avgHours, setAvgHours] = useState('');
  const [outagePattern, setOutagePattern] = useState('');
  const [period, setPeriod] = useState('');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Id': (window.__APP_ID__ || window.__SPACE_ID__ || '') as string,
        },
        body: JSON.stringify({ imageData: base64, fileName: file.name }),
      }).then((r) => r.json());
      if (!res?.imageUrl) throw new Error('Upload failed — please try a smaller photo.');
      setPhotoUrl(res.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const canSubmit =
    street.trim().length > 1 &&
    (reportType === 'flood'
      ? eventPeriod.trim().length > 0
      : avgHours.trim().length > 0 && !isNaN(parseFloat(avgHours)));

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const base = {
        report_type: reportType,
        area_key: areaKey,
        street: street.trim(),
        address: null as string | null,
        reporter_name: reporterName.trim() || null,
        source_type: 'tenant',
        verified: false,
      };
      if (reportType === 'flood') {
        await window.__workspaceDb.from('tenant_reports').insert({
          ...base,
          report_type: 'flood',
          event_period: eventPeriod.trim(),
          severity,
          description: description.trim() || null,
          photo_url: photoUrl,
          evidence_url: evidenceUrl.trim() || null,
        });
      } else {
        await window.__workspaceDb.from('tenant_reports').insert({
          ...base,
          report_type: 'power',
          avg_daily_hours: Math.min(24, Math.max(0, parseFloat(avgHours))),
          outage_pattern: outagePattern.trim() || null,
          period: period.trim() || null,
          description: description.trim() || null,
          photo_url: photoUrl,
          evidence_url: evidenceUrl.trim() || null,
        });
      }
      setDone(true);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your report.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={`${tw.card.default} rounded-2xl p-6 text-center`}>
        <CheckCircle2 className={`w-9 h-9 mx-auto ${tw.icon.success}`} />
        <p className={`text-sm mt-3 ${typography.weight.semibold} ${typography.color.primary}`}>
          Report submitted — thank you!
        </p>
        <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
          Your {reportType} report for {street} now appears on every verification report for{' '}
          {AREAS.find((a) => a.key === areaKey)?.name}. Reports are marked “verified” once the Veranda team confirms them.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setStreet('');
            setDescription('');
            setEventPeriod('');
            setEvidenceUrl('');
            setPhotoUrl(null);
            setAvgHours('');
            setOutagePattern('');
            setPeriod('');
          }}
          className={`mt-4 px-4 py-2.5 rounded-xl text-sm ${tw.button.secondary}`}
        >
          Submit another report
        </button>
      </div>
    );
  }

  const inputCls = `${tw.input.base} ${tw.input.default} text-sm rounded-xl`;

  return (
    <div className="pb-6">
      <h2 className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>Submit a report</h2>
      <p className={`text-xs mt-1 mb-4 ${typography.color.muted}`}>
        Lived (or living) in any of our {AREAS.length} covered Lagos areas? Your flood and power reports save the next renter the wasted trips and the blind signing — and make every Veranda report stronger. Photos and links to posts are welcome; they are what turn a claim into evidence.
      </p>

      {/* Type toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {([
          { key: 'flood' as const, label: 'Flood history', icon: Droplets },
          { key: 'power' as const, label: 'Power hours', icon: Zap },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setReportType(key)}
            className={`py-3 rounded-xl text-sm flex items-center justify-center gap-2 border transition-all ${
              reportType === key
                ? `${tw.button.primary} border-transparent`
                : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
            }`}
            data-testid={`toggle-report-${key}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {/* Area */}
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Area</label>
          <div className="flex gap-1.5 flex-wrap">
            {AREAS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAreaKey(a.key)}
                className={`px-2.5 py-1.5 rounded-xl text-xs border transition-all ${
                  areaKey === a.key
                    ? `${tw.button.primary} border-transparent`
                    : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        {/* Street */}
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>
            Street / estate <span className={typography.color.danger}>*</span>
          </label>
          <input
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="e.g. Enitan Street, Aguda"
            className={inputCls}
            data-testid="input-report-street"
          />
        </div>

        {reportType === 'flood' ? (
          <>
            <div>
              <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>
                When did it happen? <span className={typography.color.danger}>*</span>
              </label>
              <input
                type="text"
                value={eventPeriod}
                onChange={(e) => setEventPeriod(e.target.value)}
                placeholder="e.g. July 2025 rains"
                className={inputCls}
                data-testid="input-report-period"
              />
            </div>
            <div>
              <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>How bad was it?</label>
              <div className="flex gap-1.5 flex-wrap">
                {SEVERITIES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSeverity(s.value)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                      severity === s.value
                        ? `${tw.button.primary} border-transparent`
                        : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>
                Average power per day (hours) <span className={typography.color.danger}>*</span>
              </label>
              <input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={avgHours}
                onChange={(e) => setAvgHours(e.target.value)}
                placeholder="e.g. 14"
                className={inputCls}
                data-testid="input-report-hours"
              />
            </div>
            <div>
              <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Outage pattern (optional)</label>
              <input
                type="text"
                value={outagePattern}
                onChange={(e) => setOutagePattern(e.target.value)}
                placeholder="e.g. Off most afternoons 12–4pm"
                className={inputCls}
              />
            </div>
            <div>
              <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Observation window (optional)</label>
              <input
                type="text"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="e.g. Jan–Jun 2026"
                className={inputCls}
              />
            </div>
          </>
        )}

        {/* Shared: evidence */}
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Photo evidence (optional)</label>
          {photoUrl ? (
            <div className="relative inline-block">
              <img src={photoUrl} alt="Uploaded evidence" className="h-24 w-36 object-cover rounded-xl border border-[var(--space-border-default)]" />
              <button
                onClick={() => setPhotoUrl(null)}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[var(--space-semantic-danger)] text-white flex items-center justify-center"
                aria-label="Remove photo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`w-full py-3 rounded-xl text-sm border border-dashed border-[var(--space-border-strong)] flex items-center justify-center gap-2 ${typography.color.secondary} hover:bg-[var(--space-surface-muted)] disabled:opacity-50`}
              data-testid="button-upload-photo"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Add a photo'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
              e.target.value = '';
            }}
          />
        </div>
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>
            <LinkIcon className="w-3 h-3 inline mr-1" />
            Link to a post about it (optional)
          </label>
          <input
            type="url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="e.g. an X.com post or news story about it"
            className={inputCls}
            data-testid="input-report-evidence"
          />
        </div>

        {/* Shared: description + name */}
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Tell us more (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={reportType === 'flood' ? 'What happened? How long did the water stay?' : 'What is supply really like on your street?'}
            className={`${inputCls} resize-none`}
          />
        </div>
        <div>
          <label className={`block text-xs mb-1.5 ${typography.weight.medium} ${typography.color.secondary}`}>Display name (optional)</label>
          <input
            type="text"
            value={reporterName}
            onChange={(e) => setReporterName(e.target.value)}
            placeholder="e.g. Tunde A."
            className={inputCls}
          />
        </div>

        {error && <p className={`text-xs ${typography.color.danger}`}>{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`w-full py-3.5 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-40 disabled:cursor-not-allowed`}
          data-testid="button-submit-report"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Submit report
        </button>
        <p className={`text-[10px] text-center ${typography.color.muted}`}>
          Reports are public (street-level, no exact house numbers shown) and help every renter checking this area.
        </p>
      </div>
    </div>
  );
}
