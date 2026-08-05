import { useState, useEffect } from 'react';
import {
  ArrowRight,
  X,
  Plus,
  Sparkles,
  Compass,
  Eye,
  Layers,
  Rocket,
  MousePointerClick,
  Heart,
  Check,
  Search,
  FileCheck,
  ShieldCheck,
  Waves,
  Zap,
  Signal,
  Navigation,
  MapPin,
} from 'lucide-react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 102; // v102: Veranda conversion landing (hero, problem, how-it-works, pricing, coverage)

// Generated brand asset (platform CDN): warm Lagos veranda at golden hour.
// Used in the "Why Veranda" section and as the hero fallback when no video is set.
const VERANDA_IMAGE_URL =
  'https://storage.googleapis.com/audos-images/generated-images/agent/workspace-812590/img-1785504576731-n6og78.png';

type ParsedResponseBody = { data: unknown; rawText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Parses a fetch Response body safely so a 5xx HTML page (proxy timeout,
// memory-crash restart, etc.) does not throw inside `response.json()` and
// get swallowed into the generic "Connection error" copy. Always returns
// an object instead of throwing — callers inspect `response.ok` themselves.
async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return { data: null, rawText: '' };
  }

  if (!rawText) {
    return { data: null, rawText: '' };
  }

  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

// Pick the most informative error message we can show to the user given
// what came back over the wire. Server-provided `error` always wins; for
// unparseable / non-JSON responses we expose the HTTP status so the bug
// is debuggable instead of being hidden behind "Connection error".
function describeResponseFailure(
  response: Response,
  body: unknown,
  rawText: string,
  fallback: string,
): string {
  if (isRecord(body)) {
    const errField = body.error;
    if (typeof errField === 'string' && errField.trim()) return errField;
    const msgField = body.message;
    if (typeof msgField === 'string' && msgField.trim()) return msgField;
  }

  const status = response.status;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is temporarily unavailable. Please try again in a moment.';
  }
  if (status >= 500) return `Server error (${status}). Please try again.`;
  if (status === 404) return 'This space could not be found. Please contact support.';
  if (status === 403) return 'This email is not authorized to access this space.';
  if (status === 400 && rawText) {
    // Sometimes the server returns a plain text 400; surface a trimmed copy
    const snippet = rawText.trim().slice(0, 140);
    if (snippet) return snippet;
  }

  return fallback;
}

// Snapshot of the JSON envelope returned by /api/space/:spaceId/register.
// All fields are optional because the server has historically added/removed
// keys; the client narrows individually before use.
interface SpaceRegisterResponseBody {
  success?: boolean;
  workspaceSessionId?: string;
  contactId?: string;
  email?: string;
  isReturningUser?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  visitorId?: string | null;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

// Snapshot of the JSON envelope returned by /api/auth/otp/space/{send,verify}.
interface OtpResponseBody {
  success?: boolean;
  resendCooldown?: number;
  attemptsRemaining?: number;
  expiresIn?: number;
}

interface EmailGateProps {
  spaceId: string;
  branding?: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    heroVideoUrl?: string;
    colors?: Record<string, any>;
    palette?: Record<string, any>;
  };
  themeTokens?: DesktopThemeTokens;
}

type GateStep = 'loading' | 'email' | 'code' | 'complete';

// Derive a usable color set from a single hex primary color
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 3 && clean.length !== 6) return null;
  const normalized =
    clean.length === 3
      ? clean.split('').map((char) => char + char).join('')
      : clean;
  return {
    r: parseInt(normalized.substring(0, 2), 16),
    g: parseInt(normalized.substring(2, 4), 16),
    b: parseInt(normalized.substring(4, 6), 16),
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  return match ? `#${match[1]}` : undefined;
}

function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.58 ? '#111827' : '#ffffff';
}

export default function EmailGate({
  spaceId,
  branding,
  themeTokens,
}: EmailGateProps) {
  const { setSessionId } = useSpaceRuntime();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<GateStep>('loading');
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Get workspaceId from window context
  const workspaceId = (window as any).__WORKSPACE_ID__ || null;
  const gdprEnabled = !!(window as any).__GDPR_ENABLED__;
  // Template previews (genesis-space*) aren’t tied to a workspace, so the
  // normal email/OTP registration can’t complete — always offer guest entry
  // there. Cloned workspaces (workspace-N) keep the flag-gated behavior.
  const isTemplatePreview = spaceId === 'genesis-space' || spaceId.startsWith('genesis-space-');
  const guestModeEnabled = !!(window as any).__GUEST_MODE_ENABLED__ || isTemplatePreview;
  const rawSocialProviders = (window as any).__SOCIAL_PROVIDERS__;
  const socialProviders: string[] = Array.isArray(rawSocialProviders) ? rawSocialProviders : [];

  useEffect(() => {
    storeAttribution();
    checkExistingSession();
  }, [spaceId]);

  // Pre-fill email from localStorage when loaded inside the onboarding walkthrough
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('walkthrough') === 'true') {
      const storedEmail = localStorage.getItem('user_email');
      if (storedEmail) setEmail(storedEmail);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Landing hero entrance animation (client-only; defaults visible if JS is slow)
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Floating header: transparent over the hero, solid after the visitor scrolls.
  // The landing page scrolls inside `.eg-root` (not the window), so the listener
  // attaches to that container. Re-runs on step change since eg-root only exists
  // on the main landing screen.
  useEffect(() => {
    const root = document.querySelector('.eg-root');
    if (!root) return;
    const onScroll = () => setScrolled(root.scrollTop > 24);
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [step]);

  const checkExistingSession = async () => {
    // `?as=visitor` preview: never adopt a stored session — skip straight to the
    // logged-out email form instead of jumping to the empty 'complete' state.
    const forceVisitor = typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true;
    const sessionKey = `space_session_${spaceId}`;
    const existingSession = forceVisitor ? null : localStorage.getItem(sessionKey);

    if (existingSession) {
      try {
        const session = JSON.parse(existingSession);
        const effectiveSessionId = session.workspaceSessionId || session.id;

        if (effectiveSessionId) {
          if (workspaceId) {
            try {
              const configRes = await fetch(`/api/auth/otp/space/config/${workspaceId}`);
              const configData = await configRes.json();
              const otpConfig = configData.config || configData;

              if (otpConfig.enabled) {
                setOtpEnabled(true);
                const checkRes = await fetch(`/api/auth/otp/space/check-session?workspaceId=${workspaceId}&sessionUuid=${encodeURIComponent(effectiveSessionId)}`, {
                  credentials: 'include'
                });
                const checkData = await checkRes.json();

                if (checkData.verified) {
                  setSessionId(effectiveSessionId);
                  setStep('complete');
                  return;
                } else {
                  setStep('email');
                  return;
                }
              }
            } catch (e) {
              console.log('[EmailGate] OTP config check failed, using simple mode');
            }
          }

          setSessionId(effectiveSessionId);
          setStep('complete');
          return;
        }
      } catch (e) {
        console.error('Failed to parse session:', e);
      }
    }

    if (workspaceId) {
      try {
        const configRes = await fetch(`/api/auth/otp/space/config/${workspaceId}`);
        const configData = await configRes.json();
        const otpConfig = configData.config || configData;
        setOtpEnabled(otpConfig.enabled || false);
      } catch (e) {
        setOtpEnabled(false);
      }
    }

    setStep('email');
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const normalizedEmail = email.toLowerCase().trim();

      if (otpEnabled && workspaceId) {
        const attribution = getAttribution();
        const visitorId = getVisitorId();
        const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        const registerRes = await fetch(`/api/space/${spaceId}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            sessionId,
            visitorId,
            attribution,
            metadata: {},
            workspaceId,
            marketingConsent,
          }),
        });

        const { data: registerResult, rawText: registerRawText } =
          await parseResponseBody(registerRes);

        if (!registerRes.ok) {
          console.error('[EmailGate] register failed', {
            status: registerRes.status,
            body: registerResult ?? registerRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              registerRes,
              registerResult,
              registerRawText,
              'Failed to create session. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        if (!isRecord(registerResult)) {
          console.error('[EmailGate] register returned an unparseable body', {
            status: registerRes.status,
            rawText: registerRawText.slice(0, 200),
          });
          setError('The server returned an unexpected response. Please try again.');
          setLoading(false);
          return;
        }

        const registerBody = registerResult as SpaceRegisterResponseBody;
        const wsSessionId = registerBody.workspaceSessionId;
        setPendingSessionId(wsSessionId);

        if (typeof (window as any).fbq === 'function' && (window as any).__META_PIXEL_ID__) {
          (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail.toLowerCase().trim() });
        }
        fireLeadEventWithRetry(normalizedEmail);

        const sessionKey = `space_session_${spaceId}`;
        const pendingSession = {
          id: wsSessionId,
          workspaceSessionId: wsSessionId,
          email: normalizedEmail,
          contactId: registerResult.contactId || null,
          timestamp: Date.now(),
          verified: registerResult.isReturningUser === false,
          isReturningUser: !!registerResult.isReturningUser,
          metadata: registerResult.metadata || {},
        };
        localStorage.setItem(sessionKey, JSON.stringify(pendingSession));

        if (registerResult.isReturningUser === false) {
          try {
            window.dispatchEvent(new CustomEvent('audos:session-established', {
              detail: { workspaceSessionId: wsSessionId, email: normalizedEmail },
            }));
          } catch (e) {}

          setSessionId(wsSessionId);
          completeGateEntry();
          setLoading(false);
          return;
        }

        const response = await fetch('/api/auth/otp/space/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: normalizedEmail, workspaceId, sessionUuid: wsSessionId }),
        });

        const { data: otpResult, rawText: otpRawText } = await parseResponseBody(response);

        if (!response.ok) {
          console.error('[EmailGate] otp send failed', {
            status: response.status,
            body: otpResult ?? otpRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              response,
              otpResult,
              otpRawText,
              'Failed to send code. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        const otpBody: OtpResponseBody = isRecord(otpResult) ? otpResult : {};
        setResendCooldown(otpBody.resendCooldown ?? 60);
        setStep('code');
      } else {
        await registerSession();
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleEmailSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 4) {
      setError('Please enter the 4-digit code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (!pendingSessionId) {
        setError('Session expired. Please start over.');
        setStep('email');
        setLoading(false);
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, code, workspaceId, sessionUuid: pendingSessionId }),
      });

      const { data: verifyResult, rawText: verifyRawText } = await parseResponseBody(response);
      const verifyBody: OtpResponseBody = isRecord(verifyResult) ? verifyResult : {};

      if (!response.ok || !verifyBody.success) {
        console.error('[EmailGate] otp verify failed', {
          status: response.status,
          body: verifyResult ?? verifyRawText.slice(0, 200),
        });
        if (typeof verifyBody.attemptsRemaining === 'number') {
          setError(`Invalid code. ${verifyBody.attemptsRemaining} attempts remaining.`);
        } else {
          setError(
            describeResponseFailure(
              response,
              verifyResult,
              verifyRawText,
              'Invalid code. Please try again.',
            ),
          );
        }
        setLoading(false);
        return;
      }

      await completeVerifiedSession();
    } catch (err) {
      console.error('[EmailGate] Network error in handleCodeSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || !pendingSessionId) return;

    setLoading(true);
    setError('');

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, workspaceId, sessionUuid: pendingSessionId }),
      });

      const { data: resendResult, rawText: resendRawText } = await parseResponseBody(response);

      if (response.ok) {
        const resendBody: OtpResponseBody = isRecord(resendResult) ? resendResult : {};
        setResendCooldown(resendBody.resendCooldown ?? 60);
        setCode('');
      } else {
        console.error('[EmailGate] otp resend failed', {
          status: response.status,
          body: resendResult ?? resendRawText.slice(0, 200),
        });
        setError(
          describeResponseFailure(
            response,
            resendResult,
            resendRawText,
            'Failed to resend code. Please try again.',
          ),
        );
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleResendCode:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const completeVerifiedSession = async () => {
    const sessionKey = `space_session_${spaceId}`;
    const normalizedEmail = email.toLowerCase().trim();
    let verifiedMetadata: Record<string, unknown> = {};
    try {
      const existingSession = localStorage.getItem(sessionKey);
      if (existingSession) {
        const parsed = JSON.parse(existingSession);
        if (parsed.metadata) verifiedMetadata = parsed.metadata;
      }
    } catch {}
    const session = {
      id: pendingSessionId,
      workspaceSessionId: pendingSessionId,
      email: normalizedEmail,
      timestamp: Date.now(),
      verified: true,
      isReturningUser: true,
      metadata: verifiedMetadata,
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));

    try {
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: pendingSessionId,
          email: normalizedEmail,
        }
      }));
    } catch (e) {}

    setSessionId(pendingSessionId!);
    completeGateEntry();
    setLoading(false);
  };

  const registerSession = async () => {
    const normalizedEmail = email.toLowerCase().trim();

    // Template previews have no workspace, so the server-side register can
    // never succeed ("Could not resolve workspace from space."). Create a
    // local preview session with the entered email instead.
    if (isTemplatePreview) {
      const previewId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const previewSession = {
        id: previewId,
        workspaceSessionId: previewId,
        email: normalizedEmail,
        isGuest: true,
        timestamp: Date.now(),
        verified: true,
        metadata: {},
      };
      localStorage.setItem(`space_session_${spaceId}`, JSON.stringify(previewSession));
      try {
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: previewId, email: normalizedEmail, isGuest: true },
        }));
      } catch (e) {}
      setSessionId(previewId);
      completeGateEntry();
      setLoading(false);
      return;
    }

    const attribution = getAttribution();
    const visitorId = getVisitorId();
    const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const response = await fetch(`/api/space/${spaceId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        sessionId,
        visitorId,
        attribution,
        metadata: {},
        workspaceId,
        marketingConsent,
      }),
    });

    const { data: registerResult, rawText: registerRawText } = await parseResponseBody(response);

    if (!response.ok) {
      console.error('[EmailGate] registerSession failed', {
        status: response.status,
        body: registerResult ?? registerRawText.slice(0, 200),
      });
      setError(
        describeResponseFailure(
          response,
          registerResult,
          registerRawText,
          'Registration failed. Please try again.',
        ),
      );
      setLoading(false);
      return;
    }

    if (!isRecord(registerResult)) {
      console.error('[EmailGate] registerSession returned an unparseable body', {
        status: response.status,
        rawText: registerRawText.slice(0, 200),
      });
      setError('The server returned an unexpected response. Please try again.');
      setLoading(false);
      return;
    }

    const registerBody = registerResult as SpaceRegisterResponseBody;
    const effectiveSessionId =
      registerBody.workspaceSessionId ||
      `anon_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const sessionKey = `space_session_${spaceId}`;
    const session = {
      id: effectiveSessionId,
      workspaceSessionId: registerBody.workspaceSessionId || effectiveSessionId,
      email: normalizedEmail,
      contactId: registerBody.contactId || null,
      timestamp: Date.now(),
      isReturningUser: !!registerBody.isReturningUser,
      metadata: registerBody.metadata || {},
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));

    try {
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: registerBody.workspaceSessionId,
          email: normalizedEmail,
        }
      }));
    } catch (e) {}

    if (typeof (window as any).fbq === 'function' && (window as any).__META_PIXEL_ID__) {
      (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail.toLowerCase().trim() });
    }
    fireLeadEventWithRetry(normalizedEmail);

    setSessionId(effectiveSessionId);
    completeGateEntry();
    setLoading(false);
  };

  const handleGuestMode = async () => {
    setError('');
    setLoading(true);

    try {
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const sessionKey = `space_session_${spaceId}`;
      const guestSession = {
        id: guestId,
        workspaceSessionId: guestId,
        email: null,
        isGuest: true,
        timestamp: Date.now(),
        verified: true,
        metadata: {},
      };
      localStorage.setItem(sessionKey, JSON.stringify(guestSession));

      try {
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: guestId, isGuest: true },
        }));
      } catch (e) {}

      setSessionId(guestId);
      completeGateEntry();
    } catch (err) {
      setError('Could not continue as guest. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // `?as=visitor` preview forces the signed-out view even after a real
  // sign-in: the gate would render nothing and the visitor would land on the
  // blank-screen lock instead of the space. The session write is real (only
  // reads are shadowed under the forced-visitor preview), so drop the
  // as=visitor param and reload — the fresh session is adopted and the
  // signed-in space opens.
  const completeGateEntry = () => {
    try {
      if (typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true) {
        const url = new URL(window.location.href);
        url.searchParams.delete('as');
        window.location.replace(url.toString());
        return;
      }
    } catch (e) {}
    setStep('complete');
  };

  const handleSocialLogin = (provider: string) => {
    // Strip the forced-visitor preview flag from the OAuth return URL so the
    // visitor comes back to the signed-in space, not the forced signed-out view.
    let socialReturnTo = window.location.href;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('as');
      socialReturnTo = url.toString();
    } catch (e) {}
    const returnUrl = encodeURIComponent(socialReturnTo);
    const url = workspaceId
      ? `/api/auth/social/${provider}?workspaceId=${workspaceId}&spaceId=${spaceId}&returnUrl=${returnUrl}`
      : `/api/auth/social/${provider}?spaceId=${spaceId}&returnUrl=${returnUrl}`;
    window.location.href = url;
  };

  function getVisitorId(): string {
    const key = 'audos_visitor_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `v_${Math.random().toString(36).substring(2)}_${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function getAttrCookie(): Record<string, string> | null {
    try {
      const raw = localStorage.getItem('audos_attribution');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setAttrCookie(jsonStr: string) {
    const ATTR_COOKIE_NAME = 'audos_attr';
    const MULTI_LEVEL_TLDS = ['co.uk','co.za','co.in','co.jp','co.kr','co.nz','com.au','com.br','com.cn','com.mx','com.sg','com.hk','com.tw','com.ar','com.co','com.eg','com.my','com.ng','com.pe','com.ph','com.pk','com.tr','com.ua','com.vn','org.uk','org.au','net.au','net.uk','ac.uk','gov.uk','gov.au','edu.au','ne.jp','or.jp'];
    const hostname = window.location.hostname;
    const platformDomains = [
      'replit.dev', 'replit.app', 'repl.co',
      'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
      'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
      'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
      'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
      'fly.dev', 'deno.dev', 'glitch.me'
    ];
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    let isPlatform = false;
    for (let i = 0; i < platformDomains.length; i++) {
      if (hostname.endsWith('.' + platformDomains[i]) || hostname === platformDomains[i]) {
        isPlatform = true;
        break;
      }
    }
    let domainPart = '';
    if (!isLocalhost && !isIP && !isPlatform) {
      const parts = hostname.split('.');
      const lastTwo = parts.slice(-2).join('.');
      if (MULTI_LEVEL_TLDS.indexOf(lastTwo) !== -1 && parts.length >= 3) {
        domainPart = '; domain=.' + parts.slice(-3).join('.');
      } else if (parts.length >= 2) {
        domainPart = '; domain=.' + parts.slice(-2).join('.');
      }
    }
    const isSecure = window.location.protocol === 'https:';
    const secureFlag = isSecure ? '; Secure' : '';
    document.cookie = ATTR_COOKIE_NAME + '=' + encodeURIComponent(jsonStr) + '; max-age=86400; path=/' + domainPart + '; SameSite=Lax' + secureFlag;
  }

  function storeAttribution() {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = params.has('utm_source') || params.has('utm_medium') || params.has('utm_campaign') || params.has('fbclid') || params.has('gclid') || params.has('ref');
    if (!hasUtm) return;

    const attr: Record<string, string> = { capturedAt: Date.now().toString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) attr[p === 'ref' ? 'referrer' : p.replace('utm_', 'utm').replace('_', '')] = v;
    });
    if (document.referrer) attr.httpReferrer = document.referrer;

    try {
      localStorage.setItem('audos_attribution', JSON.stringify(attr));
    } catch {}

    const cookieAttr: Record<string, string> = { capturedAt: new Date().toISOString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) cookieAttr[p] = v;
    });
    if (document.referrer) cookieAttr.httpReferrer = document.referrer;
    try {
      setAttrCookie(JSON.stringify(cookieAttr));
      console.log('[EmailGate] Attribution stored in cookie:', cookieAttr);
    } catch {}
  }

  async function fireLeadEventWithRetry(emailAddr: string, attempt = 0) {
    const normalizedEmail = emailAddr.toLowerCase().trim();
    // Task #1480: stable conversion id used for both client-side rdt('track','Lead', …)
    // and server-side Reddit CAPI so they dedupe.
    const conversionId = `lead_${spaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tryFireFbq = (): boolean => {
      if (typeof (window as any).fbq === 'function') {
        (window as any).fbq('track', 'Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
        }, {
          em: normalizedEmail
        });
        console.log('[EmailGate] Meta Pixel Lead event fired for:', emailAddr);
        return true;
      }
      return false;
    };

    if (!tryFireFbq()) {
      console.log('[EmailGate] fbq not ready, will retry with exponential backoff...');
      const maxRetries = 5;
      const delays = [100, 200, 400, 800, 1600];

      const retryWithBackoff = (retryAttempt: number) => {
        if (retryAttempt >= maxRetries) {
          console.warn('[EmailGate] Failed to fire Lead event - fbq never loaded after 5 retries');
          return;
        }
        setTimeout(() => {
          if (tryFireFbq()) {
            console.log(`[EmailGate] Lead event fired after ${retryAttempt + 1} retries`);
          } else {
            retryWithBackoff(retryAttempt + 1);
          }
        }, delays[retryAttempt]);
      };

      retryWithBackoff(0);
    }

    // Task #1480: Reddit Pixel Lead (parallel to Meta). We call window.rdt
    // directly — the queue stub installed by the injected PageVisit snippet
    // (Task #1456, already live) handles late pixel.js loads, so we don’t
    // need the exponential-backoff retry the Meta path uses. Re-running
    // rdt('init', …, { email, externalId }) propagates advanced matching for
    // the subsequent Lead event (Reddit "Step 3: Set up match keys").
    try {
      const rdt = (window as any).rdt;
      const pixelId = (window as any).__REDDIT_PIXEL_ID__;
      if (typeof rdt === 'function') {
        if (pixelId) {
          rdt('init', pixelId, { email: normalizedEmail, externalId: getVisitorId() });
        }
        rdt('track', 'Lead', { conversionId });
        console.log('[EmailGate] Reddit Pixel Lead event fired (conversionId=' + conversionId + ')');
      }
    } catch (e) {
      console.warn('[EmailGate] Reddit Pixel Lead failed:', e);
    }

    if (!workspaceId) return;
    try {
      await fetch(`/api/space/${spaceId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'lead',
          sessionId: `lead_${Date.now()}`,
          visitorId: getVisitorId(),
          // Task #1480: include conversionId so server-side Reddit CAPI dedupes
          // with the client-side rdt('track','Lead',…) fired above.
          conversionId,
          metadata: { email: emailAddr, conversionId, ...getAttribution() },
          workspaceId,
        }),
      });
    } catch {
      if (attempt < 2) setTimeout(() => fireLeadEventWithRetry(emailAddr, attempt + 1), 2000);
    }
  }

  const getAttribution = () => {
    const params = new URLSearchParams(window.location.search);

    const urlAttribution: Record<string, string | null> = {};
    if (params.get('utm_source')) urlAttribution.utmSource = params.get('utm_source');
    if (params.get('utm_medium')) urlAttribution.utmMedium = params.get('utm_medium');
    if (params.get('utm_campaign')) urlAttribution.utmCampaign = params.get('utm_campaign');
    if (params.get('utm_content')) urlAttribution.utmContent = params.get('utm_content');
    if (params.get('utm_term')) urlAttribution.utmTerm = params.get('utm_term');
    if (params.get('fbclid')) urlAttribution.fbclid = params.get('fbclid');
    if (params.get('gclid')) urlAttribution.gclid = params.get('gclid');
    if (params.get('ref')) urlAttribution.referrer = params.get('ref');
    if (document.referrer) urlAttribution.httpReferrer = document.referrer;

    const storedAttr = getAttrCookie();

    const merged: Record<string, string | null> = {};
    if (storedAttr) {
      for (const [key, value] of Object.entries(storedAttr)) {
        if (value && key !== 'capturedAt') merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(urlAttribution)) {
      if (value) merged[key] = value;
    }

    return Object.keys(merged).length > 0 ? merged : null;
  };

  const runtimeConfig = (window as any).__SPACE_CONFIG__;
  const runtimeDesktop = runtimeConfig?.desktop || {};
  const runtimeThemeTokens = runtimeDesktop?.themeTokens || {};
  const runtimeBranding = runtimeDesktop?.branding || {};
  // Founder-selected typography flows through themeTokens.typography (kickoff →
  // compiled __SPACE_CONFIG__). Derive the body/heading font stacks here so the
  // landing renders the chosen fonts instead of a hard-coded system-ui.
  const typography =
    themeTokens?.typography || runtimeThemeTokens?.typography || {};
  const bodyFontStack = typography.bodyFont
    ? `"${typography.bodyFont}", system-ui, -apple-system, sans-serif`
    : 'system-ui, -apple-system, sans-serif';
  const headingFontStack = typography.headingFont
    ? `"${typography.headingFont}", system-ui, -apple-system, sans-serif`
    : bodyFontStack;
  // Kickoff stores the manually selected color in palette.primary. Shell accent
  // is derived from palette.highlight and is only a fallback for older spaces.
  const selectedAccentColor = normalizeHexColor(
    themeTokens?.shell?.accentColor ||
      runtimeThemeTokens?.shell?.accentColor ||
      runtimeDesktop?.theme?.accentColor,
  );
  const palette =
    themeTokens?.palette ||
    runtimeThemeTokens?.palette ||
    branding?.palette ||
    runtimeBranding?.palette ||
    branding?.colors ||
    runtimeBranding?.colors ||
    {};
  const palettePrimary = normalizeHexColor(palette?.primary);
  const primaryColor = palettePrimary || selectedAccentColor || '#1e293b';
  const highlightColor = normalizeHexColor(palette?.highlight || palette?.secondary) || primaryColor;
  const contrastColor = palette?.contrast || '#1a1a2e';
  const brandName = branding?.name || 'Welcome';
  const tagline = branding?.tagline || 'Get started today.';
  const logoUrl = branding?.logoUrl;
  const bgLight = palette?.surfaces?.page || colorWithAlpha(primaryColor, 0.04);
  const bgMedium = palette?.surfaces?.accentSoft || colorWithAlpha(primaryColor, 0.08);
  const borderColor = palette?.surfaces?.border || colorWithAlpha(primaryColor, 0.15);
  const panelColor = themeTokens?.shell?.panelBackground || palette?.surfaces?.panel || '#ffffff';
  const panelStrongColor =
    themeTokens?.shell?.panelStrongBackground || palette?.surfaces?.panelStrong || '#ffffff';
  const pageBackground = themeTokens?.shell?.pageBackground || palette?.surfaces?.page || '#ffffff';
  const sectionBackground = palette?.surfaces?.muted || bgLight;
  const dangerColor = palette?.semantic?.danger || '#dc2626';
  const footerText = colorWithAlpha(contrastColor, 0.72);
  const footerTextMuted = colorWithAlpha(contrastColor, 0.5);
  const gateGradient =
    themeTokens?.shell?.gateBackground ||
    `linear-gradient(180deg, ${
      palette?.surfaces?.gradientFrom || bgLight
    } 0%, ${
      palette?.surfaces?.gradientVia || '#ffffff'
    } 55%, ${
      palette?.surfaces?.gradientTo || '#ffffff'
    } 100%)`;
  const textPrimary = palette?.text?.primary || palette?.text?.brand || primaryColor;
  const textMuted = palette?.text?.secondary || colorWithAlpha(primaryColor, 0.55);
  const textSubtle = palette?.text?.muted || colorWithAlpha(primaryColor, 0.35);
  const selectedAccentOverridesPalette = !palettePrimary && !!selectedAccentColor;
  const onPrimary = selectedAccentOverridesPalette
    ? readableTextColor(primaryColor)
    : palette?.text?.onPrimary || readableTextColor(primaryColor);
  const onHighlight = selectedAccentOverridesPalette
    ? readableTextColor(highlightColor)
    : palette?.text?.onHighlight || onPrimary;
  // Vibrant hero gradient built from the workspace palette (never hardcoded
  // brand hex) so every generated space gets its own energetic look.
  const heroGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 55%, ${contrastColor} 115%)`;
  const brandGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 100%)`;
  // Hero copy + CTAs sit on the gradient/video, so they stay white over a
  // dark scrim. The scrim deepens for light primaries so text stays legible
  // regardless of the workspace palette (contrast may resolve to white).
  const primaryRgb = hexToRgb(primaryColor);
  const primaryIsLight = primaryRgb
    ? (0.2126 * primaryRgb.r + 0.7152 * primaryRgb.g + 0.0722 * primaryRgb.b) / 255 > 0.62
    : false;
  const heroScrim = `linear-gradient(105deg, rgba(0,0,0,${primaryIsLight ? 0.6 : 0.42}) 0%, rgba(0,0,0,${primaryIsLight ? 0.42 : 0.18}) 48%, rgba(0,0,0,0) 88%)`;
  const heroVideoUrl =
    branding?.heroVideoUrl ||
    runtimeBranding.heroVideoUrl ||
    (window as any).__WORKSPACE_HERO_VIDEO_URL__ ||
    '';
  const heroHasVideo = typeof heroVideoUrl === 'string' && heroVideoUrl.trim().length > 0;
  const loginPanelId = 'email-gate-login-panel';

  const openLogin = () => {
    setLoginOpen(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-email"]');
      input?.focus();
    }, 0);
  };

  const valueProps = [
    {
      title: 'A clear promise before the login',
      desc: `Visitors see what ${brandName} helps them do before they enter the workspace.`,
    },
    {
      title: 'Useful tools framed like an offer',
      desc: 'The public page introduces the included apps, guidance, and outcomes in a familiar landing-page flow.',
    },
    {
      title: 'One branded path into the product',
      desc: 'A native sign-in panel keeps the visitor on the page, then hands the session directly to the workspace.',
    },
  ];
  const howItWorks = [
    { step: '1', title: 'Understand the outcome', desc: 'Scan the promise, proof, and workspace benefits before sharing an email.' },
    { step: '2', title: 'Choose the entry point', desc: 'Open the native email, verification, social, or guest flow without leaving the page.' },
    { step: '3', title: 'Continue in the workspace', desc: 'After access is granted, the same session opens the tailored tools and AI guidance.' },
  ];
  const testimonials = [
    { quote: 'The value was clear before I signed in, and the workspace felt ready the moment it opened.', name: 'Early user' },
    { quote: 'It felt less like creating an account and more like opening a toolkit built for the job.', name: 'Beta tester' },
  ];
  const faqs = [
    { q: 'What happens after I click get started?', a: 'A native access panel opens on this page. After email or verification, the same session continues into the workspace.' },
    { q: 'Do I need a credit card?', a: 'No. The default entry flow is email-first and can support verification, social login, or guest access when enabled.' },
    { q: 'What is inside the workspace?', a: 'The generated apps, AI assistant, and workspace content for this business or offer.' },
    { q: 'Is my data private?', a: 'Your session and contact data follow the workspace privacy and consent settings.' },
  ];

  // Presentational icons paired with the content arrays above by index.
  // Kept separate so the copy arrays stay plain for per-workspace rewrites.
  const valuePropIcons = [Eye, Layers, Rocket];
  const howItWorksIcons = [Compass, MousePointerClick, Rocket];

  // A monochrome onboarding mark (path marker ".mono.") can be recolored for
  // contrast; any other logo (legacy colored, knockout, dimensional) is shown
  // as-is on a neutral chip so it keeps working without clashing.
  const logoIsMono =
    typeof logoUrl === 'string' && /\.mono\.[a-z0-9]+(?:[?#].*)?$/i.test(logoUrl);

  // Centralized logo "block/chip": the fill derives from the current theme
  // tokens and the mark auto-picks white/black for contrast, so swapping the
  // brand palette recolors the block without ever regenerating the logo.
  const BrandMark = ({
    size = 40,
    blockColor,
    radiusScale = 0.26,
  }: { size?: number; blockColor?: string; radiusScale?: number }) => {
    const fill = blockColor || primaryColor;
    const markIsLight = readableTextColor(fill) === '#ffffff';
    const inner = Math.round(size * 0.6);
    const blockStyle = {
      width: size,
      height: size,
      borderRadius: Math.round(size * radiusScale),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    } as const;
    if (logoUrl && !logoIsMono) {
      return (
        <div
          style={{ ...blockStyle, backgroundColor: panelColor, border: `1px solid ${borderColor}` }}
        >
          <img
            src={logoUrl}
            alt={brandName}
            style={{ width: inner, height: inner, objectFit: 'contain' }}
          />
        </div>
      );
    }
    return (
      <div style={{ ...blockStyle, backgroundColor: fill }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName}
            style={{
              width: inner,
              height: inner,
              objectFit: 'contain',
              filter: markIsLight ? 'brightness(0) invert(1)' : 'brightness(0)',
            }}
          />
        ) : (
          <span
            style={{
              color: markIsLight ? onPrimary : textPrimary,
              fontWeight: 700,
              fontSize: Math.round(size * 0.42),
              fontFamily: headingFontStack,
            }}
          >
            {brandName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  const LoginPanel = ({ compact = false }: { compact?: boolean }) => (
    <div
      id={loginPanelId}
      className={compact ? '' : 'rounded-3xl p-6 sm:p-8'}
      style={compact ? undefined : {
        backgroundColor: panelColor,
        boxShadow: `0 24px 48px ${colorWithAlpha(primaryColor, 0.14)}, 0 2px 6px ${colorWithAlpha(primaryColor, 0.06)}`,
        border: `1px solid ${borderColor}`,
      }}
    >
      {!compact && (
        <div className="mb-5 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: brandGradient, color: onPrimary }}
          >
            <Sparkles size={22} strokeWidth={2.4} />
          </div>
          <p className="text-base font-extrabold" style={{ color: textPrimary }}>
            Enter the space
          </p>
          <p className="mt-1 text-sm" style={{ color: textMuted }}>
            Use your email to continue into {brandName}.
          </p>
        </div>
      )}

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 text-base rounded-2xl focus:outline-none transition-all"
            style={{
              backgroundColor: sectionBackground,
              border: `2px solid ${error ? dangerColor : borderColor}`,
              color: textPrimary,
            }}
            disabled={loading}
            required
            autoFocus={loginOpen}
            data-testid="input-email"
          />
          {error && (
            <p className="mt-2 text-xs" style={{ color: dangerColor }} data-testid="text-error">
              {error}
            </p>
          )}
        </div>

        {gdprEnabled && (
          <div
            className="space-y-2 rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: bgLight,
              color: textMuted,
            }}
          >
            <p>
              By entering your email, you agree to our{' '}
              <a href="/privacy" className="font-medium underline" style={{ color: textPrimary }}>
                Privacy Policy
              </a>.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded"
                style={{ borderColor, accentColor: primaryColor }}
              />
              <span>I want to receive marketing emails and updates (optional)</span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
          style={{
            backgroundColor: loading || !email
              ? colorWithAlpha(primaryColor, 0.35)
              : primaryColor,
            color: loading || !email ? colorWithAlpha(onPrimary, 0.7) : onPrimary,
            cursor: loading || !email ? 'not-allowed' : 'pointer',
            boxShadow: loading || !email ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
          }}
          data-testid="button-continue"
        >
          {loading ? 'Just a moment...' : 'Continue into the space'}
          {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
        </button>
      </form>

      {!compact && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-5 text-xs font-medium" style={{ color: textSubtle }}>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />100% free</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />No credit card</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />Instant access</span>
        </div>
      )}

      {socialProviders.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
            <span className="text-xs font-medium" style={{ color: textSubtle }}>or continue with</span>
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
          </div>
          <div className={`grid gap-2 ${socialProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {socialProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSocialLogin(provider)}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: panelColor,
                  border: `2px solid ${borderColor}`,
                  color: textPrimary,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="capitalize">{provider}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {guestModeEnabled && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleGuestMode}
            disabled={loading}
            className="text-sm font-semibold transition-colors hover:opacity-70"
            style={{ color: textMuted, cursor: loading ? 'not-allowed' : 'pointer' }}
            data-testid="button-guest-mode"
          >
            Continue as guest
          </button>
        </div>
      )}
    </div>
  );

  if (step === 'loading' || step === 'complete') {
    return null;
  }

  // OTP Code verification screen
  if (step === 'code') {
    return (
      <div
        className="min-h-screen flex flex-col overflow-y-auto"
        style={{ fontFamily: bodyFontStack, background: gateGradient }}
      >
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="text-center mb-10">
              <div className="flex justify-center mb-4">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}`, boxShadow: `0 10px 24px ${colorWithAlpha(primaryColor, 0.16)}` }}
                >
                  <BrandMark size={40} />
                </div>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>
                Check your inbox
              </h1>
              <p className="mt-2 text-sm" style={{ color: textMuted }}>
                We sent a 4-digit code to<br />
                <span className="font-medium" style={{ color: textPrimary }}>{email}</span>
              </p>
              <p className="mt-3 text-xs" style={{ color: textSubtle }}>
                can’t find it? Check your spam or junk folder.
              </p>
            </div>

            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setCode(val);
                    setError('');
                  }}
                  placeholder="0000"
                  className="w-full px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono rounded-xl focus:outline-none transition-all"
                  style={{
                    backgroundColor: panelColor,
                    border: `2px solid ${error ? dangerColor : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  autoFocus
                  data-testid="input-code"
                />
                {error && (
                  <p className="mt-2 text-xs" style={{ color: dangerColor }} data-testid="text-error">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full py-3.5 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
                style={{
                  backgroundColor: loading || code.length !== 4 ? colorWithAlpha(primaryColor, 0.3) : primaryColor,
                  color: onPrimary,
                  cursor: loading || code.length !== 4 ? 'not-allowed' : 'pointer',
                  boxShadow: loading || code.length !== 4 ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
                }}
                data-testid="button-verify"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
                {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
              </button>
            </form>

            <div className="text-center mt-6 space-x-4">
              <button
                onClick={handleResendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-sm transition-colors"
                style={{ color: resendCooldown > 0 ? textSubtle : textPrimary }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
              <span style={{ color: textSubtle }}>|</span>
              <button
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="text-sm transition-colors"
                style={{ color: textMuted }}
              >
                Change email
              </button>
            </div>
          </div>
        </div>

        <div className="pb-8 text-center">
          <p className="text-xs" style={{ color: textSubtle }}>
            Your data is private and secure
          </p>
        </div>
      </div>
    );
  }

  // Main email entry screen - landing page first, native login panel on CTA.
  return (
    <>
      {/*
        WYSIWYG kickoff: the founder-chosen landing look replaces ONLY the shell
        region between the START/END markers below. Everything outside it — the
        auth hooks/handlers above, and the login modal + <LoginPanel> after END —
        is fixed platform infrastructure and is never LLM-regenerated, so
        sign-in / OTP / registration is guaranteed intact after a variant ships.
        A generated shell may use in-scope brand vars (primaryColor, brandName,
        heroVideoUrl, heroHasVideo, openLogin, BrandMark, colorWithAlpha, the
        lucide icons, …) but must not fetch, register, or duplicate auth.
        See server/services/kickoff-email-gate-variants.service.ts.
      */}
      {/* AUDOS:LANDING_SHELL:START */}
    <div className="eg-root h-screen overflow-y-auto" style={{ height: '100dvh', WebkitOverflowScrolling: 'touch', fontFamily: bodyFontStack, backgroundColor: pageBackground }}>
  <style>{`
    .eg-hero-email::placeholder { color: rgba(255, 255, 255, 0.6); }
  `}</style>
  <nav className="sticky top-0 z-50 w-full backdrop-blur-xl" style={{ backgroundColor: colorWithAlpha(pageBackground, 0.88), borderBottom: `1px solid ${colorWithAlpha(borderColor, scrolled ? 1 : 0.5)}`, boxShadow: scrolled ? `0 10px 30px ${colorWithAlpha(primaryColor, 0.08)}` : 'none', transition: 'box-shadow 0.3s ease' }}>
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-6 sm:py-3.5">
      <div className="flex items-center gap-2.5">
        <BrandMark size={32} />
        <span className="text-lg font-extrabold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>{brandName}</span>
      </div>
      <div className="hidden items-center gap-6 text-sm font-semibold md:flex" style={{ color: textMuted }}>
        <a href="#how-it-works" className="transition-opacity hover:opacity-70">How it works</a>
        <a href="#pricing" className="transition-opacity hover:opacity-70">Pricing</a>
        <a href="#coverage" className="transition-opacity hover:opacity-70">Coverage</a>
      </div>
      <button onClick={openLogin} className="rounded-full px-4 py-2 text-sm font-bold transition-transform hover:scale-[1.03] sm:px-5" style={{ backgroundColor: primaryColor, color: readableTextColor(primaryColor), boxShadow: `0 8px 20px ${colorWithAlpha(primaryColor, 0.3)}` }}>
        View Listings
      </button>
    </div>
  </nav>

  <section id="hero" className="relative flex items-center justify-center overflow-hidden" style={{ minHeight: 'calc(100svh - 58px)' }}>
        <div aria-hidden="true" data-audos-hero-scrim="1" style={{ position: 'absolute', inset: 0, background: 'rgba(2, 6, 23, 0.1)', zIndex: 1, pointerEvents: 'none' }} />
    {heroHasVideo ? (
      <video src={heroVideoUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
    ) : (
      <img src={VERANDA_IMAGE_URL} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
    )}
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(3,13,18,0.66) 0%, rgba(3,13,18,0.5) 45%, rgba(3,13,18,0.8) 100%)' }} />

    <div className={`relative z-10 mx-auto w-full max-w-3xl px-5 py-16 text-center transition-all duration-700 sm:px-6 sm:py-24 ${entered ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
      <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {tagline || 'Truth before you move in.'}
      </p>
      <h1 className="mx-auto max-w-2xl text-[2rem] font-extrabold leading-[1.12] tracking-tight sm:text-5xl sm:leading-[1.08] md:text-[3.4rem]" style={{ color: '#ffffff', fontFamily: headingFontStack }}>
        Find your next Lagos home. Know what you’re getting into before you sign.
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: 'rgba(255,255,255,0.88)' }}>
        Browse real, current listings — pulled fresh every day from Nigeria’s top property portals — then verify the flood risk, the power reliability, the network coverage, the security situation, and the commute on the one you love, before any money changes hands.
      </p>

      <div className="mt-8 flex flex-col items-center justify-center gap-3">
        <button data-testid="button-open-login" onClick={openLogin} className="group inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-full px-8 py-4 text-base font-bold transition-transform hover:scale-[1.02] sm:w-auto sm:max-w-none" style={{ backgroundColor: primaryColor, color: readableTextColor(primaryColor), boxShadow: `0 14px 40px ${colorWithAlpha(primaryColor, 0.45)}` }}>
          Browse Lagos Listings
          <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
        </button>
      </div>

      <div className="mx-auto mt-8 w-full max-w-md rounded-2xl p-4 text-left sm:p-5" style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
        <p className="mb-3 text-xs font-semibold sm:text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
          Not ready to search yet? Drop your email and we’ll keep you posted.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') openLogin(); }}
            placeholder="you@email.com"
            className="eg-hero-email w-full flex-1 rounded-full px-5 py-3 text-sm focus:outline-none"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#ffffff' }}
            data-testid="input-hero-email"
          />
          <button onClick={openLogin} className="shrink-0 rounded-full px-6 py-3 text-sm font-bold transition-transform hover:scale-[1.03]" style={{ backgroundColor: '#ffffff', color: textPrimary }}>
            Keep me posted
          </button>
        </div>
      </div>

      <p className="mt-6 text-xs font-medium sm:text-sm" style={{ color: 'rgba(255,255,255,0.68)' }}>
        Free to browse listings · 5 free full reports on us · then ₦7,000/month, cancel anytime — less than one agent fee · Live in 23 Lagos areas
      </p>
    </div>
  </section>

  <section className="px-5 py-20 sm:px-6 md:py-28" style={{ backgroundColor: contrastColor }}>
    <div className="mx-auto max-w-3xl">
      <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Sound familiar?</p>
      <h2 className="text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl md:text-4xl md:leading-[1.25]" style={{ color: '#ffffff', fontFamily: headingFontStack }}>
        Paying 3, 4, 5 different agents just to get access to listings. Driving across Lagos to see houses that looked nothing like the photos. Wasting weekends on properties that weren’t worth the stress — and still not knowing about the flooding, the power situation, or the security until after you’ve signed.
      </h2>
      <p className="mt-6 text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl" style={{ color: palette?.highlightScale?.['200'] || highlightColor, fontFamily: headingFontStack }}>
        Veranda fixes that.
      </p>

      <div className="mt-12 rounded-2xl p-6 sm:p-8" style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)' }}>
        <p className="text-lg font-extrabold leading-snug sm:text-xl" style={{ color: '#ffffff', fontFamily: headingFontStack }}>
          “By the time you find out, it’s too late to walk away.”
        </p>
        <p className="mt-3 text-sm leading-relaxed sm:text-base" style={{ color: 'rgba(255,255,255,0.65)' }}>
          The rent is paid. The agents have moved on. And you’re the one left with the flooded street, the darkness, and the commute you never planned for. Veranda exists so you find out first — while walking away still costs you nothing.
        </p>
      </div>
    </div>
  </section>

  <section className="px-5 py-20 sm:px-6 md:py-28" style={{ backgroundColor: pageBackground }}>
    <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className="overflow-hidden rounded-3xl" style={{ border: `1px solid ${borderColor}`, boxShadow: `0 30px 60px ${colorWithAlpha(primaryColor, 0.16)}` }}>
        <img
          src={VERANDA_IMAGE_URL}
          alt="A calm veranda overlooking a leafy Lagos street at golden hour"
          className="h-full w-full object-cover"
          style={{ aspectRatio: '4 / 3' }}
          loading="lazy"
        />
      </div>
      <div>
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: textSubtle }}>Why “Veranda”</p>
        <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl md:text-4xl" style={{ color: textPrimary, fontFamily: headingFontStack }}>
          The name is the promise.
        </h2>
        <p className="mt-4 text-base leading-relaxed sm:text-lg" style={{ color: textMuted }}>
          Imagine chilling at your veranda, soaking in the atmosphere of a great home you just rented or bought — this is what we’re building.
        </p>
        <div className="mt-8 space-y-6">
          {[
            { n: '01', title: 'Find', desc: 'See what’s actually available in the areas you want — without paying agent after agent just to look.' },
            { n: '02', title: 'Verify', desc: 'Get the truth about the property and the street before your money leaves your hands.' },
            { n: '03', title: 'Settle', desc: 'Move in knowing exactly what to expect — and actually enjoy the home you chose.' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-4">
              <span className="mt-1 text-xs font-extrabold tracking-widest" style={{ color: primaryColor }}>{item.n}</span>
              <div>
                <h3 className="text-base font-extrabold sm:text-lg" style={{ color: textPrimary, fontFamily: headingFontStack }}>{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed sm:text-base" style={{ color: textMuted }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>

  <section id="how-it-works" className="px-5 py-20 sm:px-6 md:py-28" style={{ backgroundColor: sectionBackground, scrollMarginTop: '72px' }}>
    <div className="mx-auto max-w-6xl">
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: textSubtle }}>How it works</p>
        <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl md:text-4xl" style={{ color: textPrimary, fontFamily: headingFontStack }}>
          Three steps between you and a confident yes.
        </h2>
      </div>

      <div className="mt-10 grid gap-4 sm:gap-6 md:mt-14 md:grid-cols-3">
        {[
          { icon: Search, step: '1', title: 'Search an area & browse listings', desc: 'Pick the Lagos area you’re eyeing and browse real, current listings — refreshed daily from Nigeria’s property portals, not stale photos. Browsing is free.' },
          { icon: FileCheck, step: '2', title: 'Verify the one you like', desc: 'Found a place worth taking seriously? Unlock the verified report — flood zone, DisCo power band, network coverage, security, and your real commute.' },
          { icon: ShieldCheck, step: '3', title: 'Sign with confidence', desc: 'Or walk away before you lose your deposit. Either way, you knew first.' },
        ].map((item) => {
          const StepIcon = item.icon;
          return (
            <div key={item.step} className="rounded-3xl p-6 sm:p-8" style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}` }}>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: colorWithAlpha(primaryColor, 0.1), color: primaryColor }}>
                  <StepIcon size={20} />
                </div>
                <span className="text-4xl font-extrabold leading-none" style={{ color: colorWithAlpha(primaryColor, 0.18), fontFamily: headingFontStack }}>{item.step}</span>
              </div>
              <h3 className="mt-5 text-lg font-extrabold" style={{ color: textPrimary, fontFamily: headingFontStack }}>{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed sm:text-base" style={{ color: textMuted }}>{item.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-3xl p-6 sm:p-10 md:mt-14" style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}` }}>
        <h3 className="text-center text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: textPrimary, fontFamily: headingFontStack }}>
          Five things you’ll know before you sign
        </h3>
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: Waves, title: 'Flood risk', desc: 'Is the street in a flood zone — and what does rainy season actually do to it?' },
            { icon: Zap, title: 'Power reliability', desc: 'Which DisCo band it’s on, and how many hours of light per day.' },
            { icon: Signal, title: 'Network coverage', desc: 'Whether your calls and data actually work inside the house.' },
            { icon: ShieldCheck, title: 'Security', desc: 'The area’s real security situation — not the agent’s version.' },
            { icon: Navigation, title: 'Distance to work', desc: 'Your real commute in Lagos traffic, not the map distance.' },
          ].map((item) => {
            const DimIcon = item.icon;
            return (
              <div key={item.title} className="rounded-2xl p-4" style={{ backgroundColor: sectionBackground, border: `1px solid ${borderColor}` }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: colorWithAlpha(primaryColor, 0.1), color: primaryColor }}>
                  <DimIcon size={17} />
                </div>
                <p className="mt-3 text-sm font-extrabold" style={{ color: textPrimary }}>{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: textMuted }}>{item.desc}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-xs leading-relaxed sm:text-sm" style={{ color: textSubtle }}>
          Built from flood records, DisCo supply data, network coverage checks, and on-the-ground area reports.
        </p>
      </div>
    </div>
  </section>

  <section id="pricing" className="px-5 py-20 sm:px-6 md:py-28" style={{ backgroundColor: pageBackground, scrollMarginTop: '72px' }}>
    <div className="mx-auto max-w-4xl">
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: textSubtle }}>Pricing</p>
        <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl md:text-4xl" style={{ color: textPrimary, fontFamily: headingFontStack }}>
          Less than one agent fee — and it tells you more than all of them combined.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed sm:text-lg" style={{ color: textMuted }}>
          Browse for free — and your first 5 full reports are free too. After that, one simple
          monthly plan unlocks unlimited reports.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:gap-6 md:mt-14 md:grid-cols-2">
        <div className="flex flex-col rounded-3xl p-6 sm:p-8" style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}` }}>
          <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: textSubtle }}>Browse</p>
          <p className="mt-3 text-4xl font-extrabold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>Free</p>
          <p className="mt-2 text-sm" style={{ color: textMuted }}>Look around before you commit to anything.</p>
          <ul className="mt-6 flex-1 space-y-3">
            {['Browse real, current listings — refreshed daily', 'Search any covered Lagos area or address', 'Your first 5 full verification reports free — just your email'].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm" style={{ color: textMuted }}>
                <Check size={16} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: primaryColor }} />
                {line}
              </li>
            ))}
          </ul>
          <button onClick={openLogin} className="mt-8 w-full rounded-full py-3.5 text-sm font-bold transition-transform hover:scale-[1.02]" style={{ backgroundColor: 'transparent', border: `2px solid ${borderColor}`, color: textPrimary }}>
            Start browsing free
          </button>
        </div>

        <div className="relative flex flex-col rounded-3xl p-6 sm:p-8" style={{ backgroundColor: contrastColor, boxShadow: `0 24px 60px ${colorWithAlpha(contrastColor, 0.3)}` }}>
          <span className="absolute -top-3 left-6 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider" style={{ backgroundColor: primaryColor, color: readableTextColor(primaryColor) }}>
            The whole truth
          </span>
          <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Veranda Monthly</p>
          <p className="mt-3 text-4xl font-extrabold tracking-tight" style={{ color: '#ffffff', fontFamily: headingFontStack }}>
            ₦7,000<span className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}> / month</span>
          </p>
          <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Cancel anytime. Unlimited verification report unlocks.</p>
          <ul className="mt-6 flex-1 space-y-3">
            {['Unlimited full verification reports', 'Flood zone verification', 'DisCo power band & supply reality', 'Network coverage on the street', 'Security situation in the area', 'Distance & commute to your work'].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <Check size={16} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: palette?.highlightScale?.['200'] || highlightColor }} />
                {line}
              </li>
            ))}
          </ul>
          <button onClick={openLogin} className="mt-8 w-full rounded-full py-3.5 text-sm font-bold transition-transform hover:scale-[1.02]" style={{ backgroundColor: primaryColor, color: readableTextColor(primaryColor), boxShadow: `0 12px 30px ${colorWithAlpha(primaryColor, 0.4)}` }}>
            Subscribe for ₦7,000/month
          </button>
        </div>
      </div>
    </div>
  </section>

  <section id="coverage" className="px-5 py-20 sm:px-6 md:py-28" style={{ backgroundColor: sectionBackground, scrollMarginTop: '72px' }}>
    <div className="mx-auto max-w-4xl text-center">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em] sm:text-xs" style={{ color: textSubtle }}>Coverage</p>
      <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl md:text-4xl" style={{ color: textPrimary, fontFamily: headingFontStack }}>
        Live where you’re looking.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: textMuted }}>
        Real, daily-refreshed listings and verified area data across 23 Lagos areas — from the Island and the Lekki–Epe corridor to the central, north and west mainland.
      </p>
      {/* Zone groups mirror AREA_ZONES / AREAS in apps/Veranda/types.ts — keep in sync when coverage expands. */}
      <div className="mt-10 space-y-8">
        {[
          { zone: 'Island & Lekki–Epe corridor', areas: ['Victoria Island', 'Ikoyi', 'Lekki Phase 1', 'Chevron / Lekki corridor', 'Ajah', 'Sangotedo', 'Epe corridor'] },
          { zone: 'Central mainland', areas: ['Surulere', 'Yaba', 'Gbagada', 'Shomolu', 'Maryland', 'Mushin', 'Oshodi', 'Isolo', 'Festac'] },
          { zone: 'North & west mainland', areas: ['Ikeja', 'Magodo', 'Ojodu Berger', 'Ketu', 'Agege', 'Alimosho', 'Ikorodu'] },
        ].map((group) => (
          <div key={group.zone}>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] sm:text-xs" style={{ color: textSubtle }}>{group.zone}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
              {group.areas.map((area) => (
                <span key={area} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold" style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}`, color: textPrimary }}>
                  <MapPin size={14} style={{ color: primaryColor }} />
                  {area}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-10 flex justify-center">
        <span className="inline-flex items-center rounded-full px-4 py-2 text-sm font-extrabold" style={{ backgroundColor: colorWithAlpha(primaryColor, 0.1), border: `1px solid ${colorWithAlpha(primaryColor, 0.3)}`, color: primaryColor }}>
          23 Lagos areas live — and growing
        </span>
      </div>
      <p className="mt-6 text-xs sm:text-sm" style={{ color: textSubtle }}>
        don’t see your area yet? Drop your email in the box above — we’ll tell you the moment your area goes live.
      </p>
    </div>
  </section>

  <section className="px-5 py-20 sm:px-6 md:py-28" style={{ background: brandGradient }}>
    <div className="mx-auto max-w-2xl text-center">
      <div className="flex justify-center"><BrandMark size={48} /></div>
      <h2 className="mt-8 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl md:text-5xl" style={{ color: readableTextColor(primaryColor), fontFamily: headingFontStack }}>
        Sign with confidence — or walk away in time.
      </h2>
      <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed sm:text-lg" style={{ color: colorWithAlpha(readableTextColor(primaryColor), 0.85) }}>
        Verify the flood risk, the power, the network, the security, and the commute — for less than one agent fee.
      </p>
      <button onClick={openLogin} className="mt-10 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold transition-transform hover:scale-[1.02]" style={{ backgroundColor: '#ffffff', color: textPrimary, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
        Browse Lagos Listings
        <ArrowRight size={18} />
      </button>
    </div>
  </section>

  <footer className="border-t px-5 py-10 sm:px-6 sm:py-12" style={{ borderColor: borderColor, backgroundColor: pageBackground }}>
    <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
      <div className="flex items-center gap-2.5">
        <BrandMark size={26} />
        <div>
          <p className="text-sm font-extrabold" style={{ color: textPrimary }}>{brandName}</p>
          <p className="text-xs" style={{ color: textSubtle }}>{tagline || 'Truth before you move in.'}</p>
        </div>
      </div>
      <p className="text-xs sm:text-sm" style={{ color: textSubtle }}>
        © {brandName} · Verified property reports for Lagos renters · Find. Verify. Settle.
      </p>
    </div>
  </footer>
</div>
      {/* AUDOS:LANDING_SHELL:END */}

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 backdrop-blur-sm"
          style={{ backgroundColor: colorWithAlpha(contrastColor, 0.6) }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-gate-login-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setLoginOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md relative overflow-hidden rounded-3xl"
            style={{ backgroundColor: panelStrongColor, boxShadow: `0 30px 70px ${colorWithAlpha(contrastColor, 0.35)}` }}
          >
            <button
              type="button"
              onClick={() => setLoginOpen(false)}
              disabled={loading}
              aria-label="Close login"
              className="absolute right-3 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:opacity-80"
              style={{ backgroundColor: bgLight, color: textPrimary }}
            >
              <X size={18} strokeWidth={2.6} />
            </button>
            <div className="p-6 sm:p-8">
              <h2 id="email-gate-login-title" className="text-2xl font-extrabold mb-1" style={{ color: textPrimary }}>
                Welcome to {brandName}
              </h2>
              <p className="text-sm mb-5" style={{ color: textMuted }}>
                Continue with email and the page will transition into {brandName}.
              </p>
              <LoginPanel compact />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
