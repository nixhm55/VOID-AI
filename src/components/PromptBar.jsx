'use client';

import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  HelpCircleIcon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
  Tick02Icon
} from '@hugeicons/core-free-icons';
import { ChromaticButton } from './chromatic-button';
import './PromptBar.css';
import { authenticatedFetch } from '../lib/api-fetch';

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

// Strictly allow ONLY English (Latin), Malayalam (\u0D00-\u0D7F), Hindi/Devanagari (\u0900-\u097F), numbers, and punctuation
const DISALLOWED_SCRIPT_REGEX =
  /[^\u0020-\u007E\u00A0-\u00FF\u0900-\u097F\u0D00-\u0D7F\u200C\u200D\u2013-\u2026]+/g;

// Collapse accidental duplicate words or repeated phrase halves (e.g. "സുഖമാണോ സുഖമാണോ" -> "സുഖമാണോ")
const collapseRepeatedSpeech = raw => {
  const cleaned = String(raw ?? '')
    .replace(DISALLOWED_SCRIPT_REGEX, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';

  const words = cleaned.split(' ');
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(' ');
    const second = words.slice(half).join(' ');
    if (first.toLowerCase() === second.toLowerCase()) {
      return first;
    }
  }

  const deduped = [];
  for (const w of words) {
    if (deduped.length === 0 || deduped[deduped.length - 1].toLowerCase() !== w.toLowerCase()) {
      deduped.push(w);
    }
  }
  return deduped.join(' ');
};

const cleanSpeechTranscript = text => collapseRepeatedSpeech(text);

// Trilingual voice configuration for Default (Coding Engine) mode
const SPEECH_LANGS = [
  { code: 'en-US', short: 'EN', apiLang: 'en', label: 'English (Default)' },
  { code: 'ml-IN', short: 'ML', apiLang: 'ml', label: 'മലയാളം (Direct)' },
  { code: 'hi-IN', short: 'HI', apiLang: 'hi', label: 'हिन्दी (Direct)' }
];

const MALAYALAM_ROMAN_CUE_REGEX =
  /\b(?:njan|njaan|nyan|ente|enikku|enikk|ninakku|ninakk|ningal|ningalkku|evide|evideya|evideyanu|ivide|ivideya|ivideyanu|entha|enthu|enthokke|enthokkeyundu|engane|enganeya|enganeyanu|eppo|kollam|adipoli|machane|mone|chetta|chechi|aanu|alla|unde|undu|illa|varum|poyi|parayu|cheyyu|venam|venda|ariyamo|ariyilla|manassilayo|manasilayo|sukham|sukhamano|sugamano|sughamano|sugar\s*mono|vishesham|paripadi|sahayam|namaskaram|kazhinju)\b/i;

const HINDI_ROMAN_CUE_REGEX =
  /\b(?:mein|mujhe|mera|meri|mere|tum|tumhara|aap|aapka|kya|kaise|kaisa|kaisi|kahan|kab|kyun|kyon|hai|hain|hoon|nahi|nahin|haan|accha|achha|theek|thik|bhai|yaar|madad|chahiye|karo|karna|batao|bataiye|dekho|suno|samajh|haal|mausam)\b/i;

const DEFAULT_SOURCES = [
  {
    key: 'files',
    name: 'Photos & files',
    description: 'Upload images or files from this device',
    icon: Attachment01Icon,
    attach: true
  },
  {
    key: 'image',
    name: 'Create image',
    description: 'Generate image via OmniRoute AI',
    icon: SparklesIcon,
    commandPrefix: 'Create an image of '
  },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe02Icon },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLineData01Icon },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File02Icon },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail01Icon },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar03Icon }
];
const DEFAULT_COMMANDS = [
  { key: 'image', name: '/image', description: 'Create an image with OmniRoute AI' },
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' }
];
const DEFAULT_MODELS = [
  { key: '4-Argon', name: '4 Argon', shortName: 'Argon', tag: '' },
  { key: 'void-combo', name: 'VOID', shortName: 'VOID', tag: '' },
  { key: 'mirash', name: 'MIRASH', shortName: 'MIRASH', tag: '' }
];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

const blobToBase64 = blob =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const readFileAsAttachment = file =>
  new Promise(resolve => {
    if (!file) {
      resolve(null);
      return;
    }
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const rawDataUrl = String(reader.result ?? '');
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 1280;
            let { width: w, height: h } = img;
            if (w > maxDim || h > maxDim) {
              if (w >= h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, w, h);
              const compressed = canvas.toDataURL('image/jpeg', 0.86);
              resolve({
                name: file.name || 'image.jpg',
                type: 'image/jpeg',
                dataUrl: compressed
              });
              return;
            }
          } catch {}
          resolve({
            name: file.name || 'image.png',
            type: file.type || 'image/png',
            dataUrl: rawDataUrl
          });
        };
        img.onerror = () =>
          resolve({
            name: file.name || 'image.png',
            type: file.type || 'image/png',
            dataUrl: rawDataUrl
          });
        img.src = rawDataUrl;
      };
      reader.onerror = () =>
        resolve({
          name: file.name || 'image.png',
          type: file.type || 'image/png'
        });
      reader.readAsDataURL(file);
      return;
    }
    resolve({
      name: file.name || 'file',
      type: file.type || 'application/octet-stream'
    });
  });

const mix = (a, b, t) => a + (b - a) * t;
const pathAt = (a, b, t) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = draft => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3].toLowerCase(), start: m.index + m[1].length };
};

const renderIcon = (icon, size) =>
  isValidElement(icon) ? icon : <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} />;

function SendGlyph({ busy, morphDuration, squash, tilt }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT }
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

export default function PromptBar({
  placeholder = 'Ask anything',
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  efforts = DEFAULT_EFFORTS,
  defaultEffort = '',
  onEffortChange,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  background = '#27272a',
  color = '#f5f5f5',
  menuBackground = '#323236',
  sparkColor = '#b39dff',
  sparkBoost = 1,
  width = 760,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  sttModel = 'default',
  className = ''
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const glowRef = useRef(null);
  const sparkRef = useRef(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const rowRefs = useRef([]);
  const lastOpen = useRef(null);
  const dictation = useRef(0);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const baseDraftRef = useRef('');
  const committedSegmentsRef = useRef([]);
  const currentInterimDisplayRef = useRef('');
  const latestRawInterimRef = useRef('');
  const processedResultIndicesRef = useRef(new Set());
  const lastCommittedRawRef = useRef('');
  const lastCommittedTimeRef = useRef(0);
  const interimConvertSeqRef = useRef(0);
  const pendingConversionsRef = useRef([]);
  const shouldKeepListeningRef = useRef(false);
  const latest = useRef({});
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange };

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechLang, setSpeechLang] = useState('en-US');
  const [pressed, setPressed] = useState(false);

  // Show EN / ML / HI button ONLY when the Default (Built-in Coding Engine) is selected!
  // When Gemini Auto-Detect or an imported GPT transcription model is selected, hide the button and use auto-detection.
  const isDefaultCodingStt = !sttModel || sttModel === 'default';
  const isOpenAiAudioStt =
    sttModel === 'gpt-4o-transcribe' ||
    sttModel === 'gpt-4o-mini-transcribe' ||
    sttModel === 'whisper-1';

  const model = models.find(m => m.key === modelKey) ?? models[0];
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen ? 'at' : (token?.kind ?? (modelOpen ? 'model' : effortOpen ? 'effort' : null));
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo(() => {
    if (open === 'at') return sources.filter(s => s.name.toLowerCase().includes(query));
    if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    if (open === 'model') return models;
    return [];
  }, [open, query, sources, commands, models]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const armed = busy || canSend;
  const level = efforts[effortIndex] ?? '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;
  const currentLangObj = SPEECH_LANGS.find(l => l.code === speechLang) ?? SPEECH_LANGS[0];

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setEffortOpen(false);
  }, []);

  const computeCombinedDraft = useCallback(() => {
    const prefix = baseDraftRef.current.trim();
    const committed = collapseRepeatedSpeech(committedSegmentsRef.current.filter(Boolean).join(' '));
    const active = cleanSpeechTranscript(currentInterimDisplayRef.current);
    const parts = [prefix, committed, active].filter(Boolean);
    return parts.join(' ');
  }, []);

  const syncDraftFromSpeechState = useCallback(() => {
    setDraft(computeCombinedDraft());
  }, [computeCombinedDraft]);

  const convertAndCommitPhrase = useCallback(
    (rawPhrase, langCode) => {
      const phrase = cleanSpeechTranscript(rawPhrase);
      if (!phrase) return Promise.resolve();

      const normalizedKey = phrase.toLowerCase();
      const now = Date.now();
      if (
        normalizedKey === lastCommittedRawRef.current &&
        now - lastCommittedTimeRef.current < 3200
      ) {
        return Promise.resolve();
      }
      lastCommittedRawRef.current = normalizedKey;
      lastCommittedTimeRef.current = now;

      // Immediately commit the raw/clean phrase at a known segment index so draft NEVER drops to empty
      const segIndex = committedSegmentsRef.current.length;
      committedSegmentsRef.current.push(phrase);
      currentInterimDisplayRef.current = '';
      syncDraftFromSpeechState();

      // If already in native Malayalam or Hindi Unicode script, we're done!
      if (/[\u0D00-\u0D7F\u0900-\u097F]/.test(phrase)) {
        return Promise.resolve();
      }

      // In Default Coding mode with EN selected, keep pure English directly in 0ms
      if (isDefaultCodingStt && langCode === 'en-US') {
        return Promise.resolve();
      }

      const needsIndicScript =
        (!isDefaultCodingStt &&
          (MALAYALAM_ROMAN_CUE_REGEX.test(phrase) || HINDI_ROMAN_CUE_REGEX.test(phrase))) ||
        (isDefaultCodingStt && (langCode === 'ml-IN' || langCode === 'hi-IN'));

      if (!needsIndicScript) {
        return Promise.resolve();
      }

      const apiLang = !isDefaultCodingStt
        ? 'auto'
        : langCode === 'ml-IN'
          ? 'ml'
          : langCode === 'hi-IN'
            ? 'hi'
            : 'en';

      const promise = authenticatedFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: phrase, lang: apiLang, model: sttModel })
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          const converted = cleanSpeechTranscript(data?.text);
          if (converted && committedSegmentsRef.current[segIndex] !== undefined) {
            committedSegmentsRef.current[segIndex] = converted;
            syncDraftFromSpeechState();
          }
        })
        .catch(() => {});

      pendingConversionsRef.current.push(promise);
      return promise;
    },
    [isDefaultCodingStt, sttModel, syncDraftFromSpeechState]
  );

  const stopMediaRecorder = useCallback(
    flushAudio => {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;

      if (!recorder) {
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
        }
        audioChunksRef.current = [];
        return Promise.resolve();
      }

      const cleanMime = (recorder.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';

      const stopPromise = new Promise(resolve => {
        const finishRecording = () => {
          if (stream) {
            stream.getTracks().forEach(t => t.stop());
          }
          const chunks = [...audioChunksRef.current];
          audioChunksRef.current = [];
          if (!flushAudio || chunks.length === 0) {
            resolve();
            return;
          }
          const blob = new Blob(chunks, { type: cleanMime });
          if (blob.size < 200) {
            resolve();
            return;
          }

          const fallbackHint = collapseRepeatedSpeech(
            committedSegmentsRef.current.filter(Boolean).join(' ')
          );
          const apiLang = isDefaultCodingStt
            ? speechLang === 'ml-IN'
              ? 'ml'
              : speechLang === 'hi-IN'
                ? 'hi'
                : 'en'
            : 'auto';

          blobToBase64(blob)
            .then(audioBase64 =>
              authenticatedFetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioBase64,
                  mimeType: cleanMime,
                  model: isOpenAiAudioStt ? sttModel : 'gpt-4o-transcribe',
                  lang: apiLang,
                  hint: fallbackHint
                })
              })
            )
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
              const transcribed = cleanSpeechTranscript(data?.text);
              if (transcribed && (isOpenAiAudioStt || committedSegmentsRef.current.length === 0)) {
                committedSegmentsRef.current = [transcribed];
                currentInterimDisplayRef.current = '';
                syncDraftFromSpeechState();
              }
            })
            .catch(() => {})
            .finally(() => resolve());
        };

        if (recorder.state !== 'inactive') {
          recorder.onstop = finishRecording;
          try {
            recorder.stop();
          } catch {
            finishRecording();
          }
        } else {
          finishRecording();
        }
      });

      pendingConversionsRef.current.push(stopPromise);
      return stopPromise;
    },
    [isDefaultCodingStt, isOpenAiAudioStt, speechLang, sttModel, syncDraftFromSpeechState]
  );

  const startMediaRecorder = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopRecognition = useCallback(
    (flushInterim = false) => {
      shouldKeepListeningRef.current = false;
      dictation.current += 1;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
      if (flushInterim && latestRawInterimRef.current.trim()) {
        const leftover = latestRawInterimRef.current;
        latestRawInterimRef.current = '';
        currentInterimDisplayRef.current = '';
        const effectiveLang = isDefaultCodingStt ? speechLang : 'en-IN';
        void convertAndCommitPhrase(leftover, effectiveLang);
      } else {
        latestRawInterimRef.current = '';
        currentInterimDisplayRef.current = '';
      }
      void stopMediaRecorder(flushInterim);
      setListening(false);
    },
    [convertAndCommitPhrase, isDefaultCodingStt, speechLang, stopMediaRecorder]
  );

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modelOpen && !effortOpen) return undefined;
    const onDown = e => {
      if (!rootRef.current?.contains(e.target)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [plusOpen, modelOpen, effortOpen, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      stopRecognition(false);
    },
    [stopRecognition]
  );

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    typing.current.strokes = 0;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = burst => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4
      });
    };
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typed = typing.current;
      const gain = boost.current;
      typed.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (typed.strokes > 0) {
        typed.strokes = 0;
        if (gain > 0) pulse = 1;
      }
      const energy = typed.energy * gain;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = sparkColor;
      ctx.shadowColor = sparkColor;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, reduce, sparkColor]);

  const setEffort = i => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    if (next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]);
  };
  const effortFromPointer = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };
  const onEffortKey = e => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === 'Escape') {
      setEffortOpen(false);
      focusInput();
    }
  };
  const stepAt = i => `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = i => (i === efforts.length - 1 ? '100%' : `calc(${stepAt(i)} + 7px)`);

  const pick = row => {
    if (open === 'model') {
      setModelKey(row.key);
      setModelOpen(false);
      focusInput();
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then(files => {
        if (!files) return;
        const nextList = Array.isArray(files) ? files : [files];
        setAttachments(a => [...a, ...nextList.filter(Boolean)]);
      });
    } else if (row.commandPrefix) {
      setDraft(`${head}${row.commandPrefix}`);
    } else if (open === 'at') {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  };

  const send = async () => {
    if (!canSend || busy) return;
    if (listening) {
      stopRecognition(true);
    }
    if (pendingConversionsRef.current.length > 0) {
      const pending = [...pendingConversionsRef.current];
      pendingConversionsRef.current = [];
      await Promise.race([
        Promise.allSettled(pending),
        new Promise(r => setTimeout(r, 1500))
      ]);
    }
    const combinedFromSpeech = computeCombinedDraft();
    const finalToSend = collapseRepeatedSpeech(
      combinedFromSpeech.length >= draft.trim().length ? combinedFromSpeech : draft
    );
    baseDraftRef.current = '';
    committedSegmentsRef.current = [];
    currentInterimDisplayRef.current = '';
    latestRawInterimRef.current = '';
    latest.current.onSend?.(finalToSend || collapseRepeatedSpeech(draft), {
      attachments,
      model,
      effort: level
    });
    setDraft('');
    setAttachments([]);
    setDismissed(false);
    closeMenus();
    focusInput();
  };

  const startBrowserRecognition = useCallback(
    langCode => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return false;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {}
      }

      processedResultIndicesRef.current = new Set();

      const recognition = new SpeechRecognition();
      const effectiveBcp47 = isDefaultCodingStt ? langCode : 'en-IN';
      recognition.lang = effectiveBcp47;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = event => {
        let interim = '';
        const newlyFinalSegments = [];

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i];
          const transcript = cleanSpeechTranscript(res[0]?.transcript ?? '');
          if (!transcript) continue;

          if (res.isFinal) {
            if (!processedResultIndicesRef.current.has(i)) {
              processedResultIndicesRef.current.add(i);
              newlyFinalSegments.push(transcript);
            }
          } else if (!processedResultIndicesRef.current.has(i)) {
            interim += ` ${transcript}`;
          }
        }

        const cleanedInterim = cleanSpeechTranscript(interim);
        latestRawInterimRef.current = cleanedInterim;

        if (newlyFinalSegments.length > 0) {
          latestRawInterimRef.current = '';
          currentInterimDisplayRef.current = '';
          const combinedFinal = cleanSpeechTranscript(newlyFinalSegments.join(' '));
          if (combinedFinal) {
            void convertAndCommitPhrase(combinedFinal, effectiveBcp47);
          }
        } else if (cleanedInterim) {
          currentInterimDisplayRef.current = cleanedInterim;
          syncDraftFromSpeechState();

          const shouldTransliterateInterim =
            (isDefaultCodingStt && (effectiveBcp47 === 'ml-IN' || effectiveBcp47 === 'hi-IN')) ||
            (!isDefaultCodingStt &&
              (MALAYALAM_ROMAN_CUE_REGEX.test(cleanedInterim) ||
                HINDI_ROMAN_CUE_REGEX.test(cleanedInterim)));

          if (shouldTransliterateInterim && !/[\u0D00-\u0D7F\u0900-\u097F]/.test(cleanedInterim)) {
            const seq = ++interimConvertSeqRef.current;
            const apiLang = !isDefaultCodingStt
              ? 'auto'
              : effectiveBcp47 === 'ml-IN'
                ? 'ml'
                : effectiveBcp47 === 'hi-IN'
                  ? 'hi'
                  : 'en';
            void authenticatedFetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hint: cleanedInterim, lang: apiLang, model: sttModel })
            })
              .then(r => (r.ok ? r.json() : null))
              .then(data => {
                if (seq !== interimConvertSeqRef.current || !latestRawInterimRef.current) return;
                const converted = cleanSpeechTranscript(data?.text);
                if (converted) {
                  currentInterimDisplayRef.current = converted;
                  syncDraftFromSpeechState();
                }
              })
              .catch(() => {});
          }
        } else {
          currentInterimDisplayRef.current = '';
          syncDraftFromSpeechState();
        }

        typing.current.energy = Math.min(1.6, typing.current.energy + 0.18);
        typing.current.strokes = Math.min(4, typing.current.strokes + 1);
      };

      recognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          shouldKeepListeningRef.current = false;
          setListening(false);
        }
      };

      recognition.onend = () => {
        // Flush any uncommitted interim speech before restarting so words never vanish
        if (latestRawInterimRef.current.trim()) {
          const pendingText = latestRawInterimRef.current;
          latestRawInterimRef.current = '';
          currentInterimDisplayRef.current = '';
          void convertAndCommitPhrase(pendingText, effectiveBcp47);
        }
        if (shouldKeepListeningRef.current) {
          processedResultIndicesRef.current = new Set();
          try {
            recognition.start();
          } catch {
            shouldKeepListeningRef.current = false;
            setListening(false);
          }
        } else {
          setListening(false);
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        return true;
      } catch {
        recognitionRef.current = null;
        return false;
      }
    },
    [convertAndCommitPhrase, isDefaultCodingStt, sttModel, syncDraftFromSpeechState]
  );

  const toggleListen = () => {
    if (listening) {
      stopRecognition(true);
      focusInput();
      return;
    }

    baseDraftRef.current = draft.trimEnd();
    committedSegmentsRef.current = [];
    currentInterimDisplayRef.current = '';
    latestRawInterimRef.current = '';
    lastCommittedRawRef.current = '';
    lastCommittedTimeRef.current = 0;
    pendingConversionsRef.current = [];

    const SpeechRecognition =
      typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

    // If an OpenAI audio transcription model is explicitly selected, start MediaRecorder alongside
    // browser recognition so audio is captured and sent to /api/transcribe when finished.
    if (isOpenAiAudioStt) {
      void startMediaRecorder();
    }

    if (SpeechRecognition) {
      shouldKeepListeningRef.current = true;
      setListening(true);
      const started = startBrowserRecognition(speechLang);
      if (started) {
        focusInput();
        return;
      }
      shouldKeepListeningRef.current = false;
    }

    // Fallback when SpeechRecognition is unavailable: record audio and transcribe via VoidAI/OmniRoute STT
    setListening(true);
    void startMediaRecorder().then(started => {
      if (!started) {
        const seq = ++dictation.current;
        Promise.resolve(latest.current.onDictate?.()).then(
          text => {
            if (seq !== dictation.current) return;
            setListening(false);
            const cleaned = cleanSpeechTranscript(text);
            if (cleaned) setDraft(d => (d.trim() ? `${d.trimEnd()} ${cleaned}` : cleaned));
            focusInput();
          },
          () => {
            if (seq === dictation.current) setListening(false);
          }
        );
      }
    });
    focusInput();
  };

  const cycleSpeechLang = () => {
    const idx = SPEECH_LANGS.findIndex(l => l.code === speechLang);
    const nextObj = SPEECH_LANGS[(idx + 1) % SPEECH_LANGS.length];
    setSpeechLang(nextObj.code);
    if (listening) {
      baseDraftRef.current = computeCombinedDraft();
      committedSegmentsRef.current = [];
      currentInterimDisplayRef.current = '';
      latestRawInterimRef.current = '';
      startBrowserRecognition(nextObj.code);
    }
    focusInput();
  };

  const handlePaste = e => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles = items
      .filter(item => item.type && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);

    if (imageFiles.length > 0) {
      e.preventDefault();
      Promise.all(imageFiles.map(readFileAsAttachment)).then(resolved => {
        const valid = resolved.filter(Boolean);
        if (valid.length > 0) {
          setAttachments(prev => [...prev, ...valid]);
        }
      });
    }
  };

  const onKeyDown = e => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const down = e => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      style={{
        '--pb-bg': background,
        '--pb-ink': color,
        '--pb-menu': menuBackground,
        '--pb-w': `${width}px`,
        '--pb-radius': `${radius}px`,
        '--pb-spark': sparkColor,
        '--pb-press': pressScale
      }}
    >
      {open ? (
        <div
          className="prompt-bar__menu"
          role={open === 'effort' ? 'dialog' : 'listbox'}
          aria-label={
            open === 'at' ? 'Sources' : open === 'slash' ? 'Commands' : open === 'model' ? 'Models' : 'Effort'
          }
          data-kind={open}
        >
          {open === 'effort' ? (
            <>
              <div className="prompt-bar__effort-head">
                <span className="prompt-bar__effort-title">Effort</span>
                <span className="prompt-bar__effort-level">{level}</span>
                <span className="prompt-bar__effort-help" title="Higher effort thinks longer before answering">
                  <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} />
                </span>
              </div>
              <div className="prompt-bar__effort-ends">
                <span>Faster</span>
                <span>Smarter</span>
              </div>
              <div
                className="prompt-bar__effort-track"
                role="slider"
                tabIndex={0}
                aria-label="Effort"
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={level}
                style={{ '--pb-effort-x': stepAt(effortIndex), '--pb-effort-fill': fillAt(effortIndex) }}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  e.currentTarget.focus({ preventScroll: true });
                  effortFromPointer(e);
                }}
                onPointerMove={e => {
                  if (e.buttons & 1) effortFromPointer(e);
                }}
                onKeyDown={onEffortKey}
              >
                <span className="prompt-bar__effort-fill" />
                {efforts.map((label, i) => (
                  <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                ))}
                <span className="prompt-bar__effort-thumb" />
              </div>
            </>
          ) : (
            <>
              <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
              {list.map((row, i) => (
                <button
                  key={row.key}
                  ref={el => {
                    rowRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className="prompt-bar__row"
                  onMouseDown={e => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                >
                  {open === 'at' ? <span className="prompt-bar__row-icon">{renderIcon(row.icon, 15)}</span> : null}
                  <span className="prompt-bar__row-name">{row.name}</span>
                  {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
                  {open === 'model' ? (
                    <>
                      <span className="prompt-bar__row-tag">{row.tag}</span>
                      <span className="prompt-bar__row-check" data-on={row.key === model?.key ? '' : undefined}>
                        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
                      </span>
                    </>
                  ) : null}
                </button>
              ))}
              {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
            </>
          )}
        </div>
      ) : null}

      <div
        className="prompt-bar__field"
        role="presentation"
        data-max={maxed ? '' : undefined}
        onPointerDown={e => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={focusInput}
      >
        <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" />
        {attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((item, i) => {
              const isObj = item && typeof item === 'object';
              const fileName = isObj ? item.name : String(item);
              const dataUrl = isObj ? item.dataUrl : undefined;
              const isImage = Boolean(dataUrl && String(dataUrl).startsWith('data:image/'));

              if (isImage) {
                return (
                  <div key={`${fileName}-${i}`} className="prompt-bar__chip-img-wrap">
                    <img
                      src={dataUrl}
                      alt={fileName}
                      className="prompt-bar__chip-img"
                    />
                    <button
                      type="button"
                      className="prompt-bar__chip-img-x"
                      aria-label={`Remove ${fileName}`}
                      onClick={e => {
                        e.stopPropagation();
                        setAttachments(a => a.filter((_, j) => j !== i));
                      }}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              }

              return (
                <span key={`${fileName}-${i}`} className="prompt-bar__chip">
                  <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                  <span className="prompt-bar__chip-name">{fileName}</span>
                  <button
                    type="button"
                    className="prompt-bar__chip-x"
                    aria-label={`Remove ${fileName}`}
                    onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="prompt-bar__input"
          rows={1}
          value={draft}
          placeholder={listening ? 'Speak in your language' : placeholder}
          aria-label="Prompt"
          onPaste={handlePaste}
          onChange={e => {
            setDraft(e.target.value);
            if (listening) {
              baseDraftRef.current = e.target.value;
              committedSegmentsRef.current = [];
              currentInterimDisplayRef.current = '';
              latestRawInterimRef.current = '';
            }
            typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
            typing.current.strokes = Math.min(4, typing.current.strokes + 1);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onFocus={closeMenus}
          onKeyDown={onKeyDown}
        />

        <div className="prompt-bar__bar">
          <button
            type="button"
            className="prompt-bar__tool"
            aria-label="Add files and sources"
            aria-expanded={plusOpen}
            data-on={plusOpen ? '' : undefined}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              setModelOpen(false);
              setEffortOpen(false);
              setActive(0);
              setPlusOpen(v => !v);
              focusInput();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
          </button>
          {models.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label="Choose model"
              aria-expanded={modelOpen}
              data-on={modelOpen ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                setPlusOpen(false);
                setEffortOpen(false);
                setActive(Math.max(0, models.indexOf(model)));
                setModelOpen(v => !v);
                focusInput();
              }}
            >
              <span>{model.shortName ?? model.name}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.4} />
            </button>
          ) : null}
          {efforts.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label="Choose effort"
              aria-expanded={effortOpen}
              data-on={effortOpen ? '' : undefined}
              data-max={maxed ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                setPlusOpen(false);
                setModelOpen(false);
                setEffortOpen(v => !v);
                focusInput();
              }}
            >
              <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={2} />
              <span>{level}</span>
            </button>
          ) : null}
          <span className="prompt-bar__spacer" />
          {onDictate ? (
            <>
              {isDefaultCodingStt ? (
                <button
                  type="button"
                  className="prompt-bar__lang"
                  title={`Voice language: ${currentLangObj.label} (Click to switch EN / ML / HI)`}
                  aria-label={`Voice language: ${currentLangObj.label}`}
                  data-on={listening ? '' : undefined}
                  onMouseDown={e => e.preventDefault()}
                  onClick={cycleSpeechLang}
                >
                  {currentLangObj.short}
                </button>
              ) : null}
              <button
                type="button"
                className="prompt-bar__tool"
                aria-label={listening ? 'Stop dictation' : 'Dictate'}
                aria-pressed={listening}
                data-on={listening ? '' : undefined}
                onMouseDown={e => e.preventDefault()}
                onClick={toggleListen}
              >
                {listening ? (
                  <span className="prompt-bar__eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={2} />
                )}
              </button>
            </>
          ) : null}
          {armed ? (
            <ChromaticButton
              color="#9b6dff"
              colorMode="gradient-3"
              color2="#b39dff"
              color3="#6d4aff"
              speed={0.7}
              paused={false}
              phase={0}
              feather={100}
              projectionScale={174.7}
              intensity={1.15}
              grain={0.105}
              seed={7}
              borderRadius={50}
              hoverEffect="brighten"
              entrance="zoom"
              entranceSpeed={2.2}
              entranceBlur={6}
              entranceDistance={0}
              entranceScale={0.72}
              className="prompt-bar__send"
              aria-label={busy ? 'Stop' : 'Send'}
              data-armed={armed ? '' : undefined}
              data-pressed={pressed ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onPointerDown={down}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={up}
              onClick={() => {
                if (busy) latest.current.onStop?.();
                else void send();
              }}
            >
              <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
            </ChromaticButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
