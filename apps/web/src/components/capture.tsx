'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FileText, Link2, Mic, Square, Type, Upload, X } from 'lucide-react';
import { api, useToast } from './api';
import { enqueue, newClientId } from '@/lib/offline';
import type { MessageKey } from '@/i18n/messages';

type Tab = 'text' | 'url' | 'files' | 'voice';

export function CaptureDialog({ open, onClose, spaces, activeId, tr }: {
  open: boolean;
  onClose: () => void;
  spaces: { workspaceId: string; name: string; kind: string; role: string }[];
  activeId: string;
  tr: Record<MessageKey, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sourceDate, setSourceDate] = useState('');
  const [ws, setWs] = useState(activeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setWs(activeId), [activeId]);

  const reset = () => {
    setText('');
    setUrl('');
    setFiles([]);
    setSourceDate('');
    setError(null);
    setTab('text');
  };

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list).slice(0, 10);
    setFiles((f) => [...f, ...arr].slice(0, 10));
    setTab('files');
  }, []);

  async function submit() {
    setError(null);
    const fields: Record<string, string> = {};
    if (text.trim()) fields.text = text.trim();
    if (url.trim()) fields.url = url.trim();
    if (sourceDate) fields.sourceDate = sourceDate;
    fields.sourceType = files.length ? (files[0]!.type.startsWith('audio/') ? 'voice' : files[0]!.type === 'application/pdf' ? 'pdf' : files[0]!.type.startsWith('image/') ? 'screenshot' : 'file') : url && !text ? 'url' : 'text';
    if (!fields.text && !fields.url && files.length === 0) {
      setError('Add some text, a link or a file.');
      return;
    }
    const clientId = newClientId();
    setBusy(true);
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      form.set('clientId', clientId);
      form.set('workspaceId', ws);
      for (const f of files) form.append('files', f);
      const res = await api<{ id: string; similar: { id: string }[]; duplicateFiles: unknown[] }>('/captures', { form });
      if (res.similar.length || res.duplicateFiles.length) toast('Saved. You captured something identical before — both are kept.');
      reset();
      onClose();
      router.push(`/app/inbox/${res.id}`);
    } catch (err) {
      if (err instanceof TypeError) {
        await enqueue({ clientId, kind: 'capture', createdAt: new Date().toISOString(), workspaceId: ws, fields, files: files.map((f) => ({ name: f.name, type: f.type, blob: f })) });
        toast(tr['capture.offlineSaved']);
        reset();
        onClose();
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        setFiles((f) => [...f, new File([new Blob(chunks, { type })], `voice-note-${new Date().toISOString().slice(0, 16).replace(':', '')}.${ext}`, { type: type.split(';')[0] })]);
        setRecording(null);
      };
      rec.start();
      setRecording(rec);
    } catch {
      setError('Microphone access was not allowed. You can still type a note.');
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const tabs: { id: Tab; label: string; icon: typeof Type }[] = [
    { id: 'text', label: tr['capture.text'], icon: Type },
    { id: 'url', label: tr['capture.link'], icon: Link2 },
    { id: 'files', label: tr['capture.files'], icon: Upload },
    { id: 'voice', label: tr['capture.voice'], icon: Mic },
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="capture-title"
      className="m-auto w-[min(640px,calc(100vw-1.5rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onPaste={(e) => {
        if (e.clipboardData.files.length) addFiles(e.clipboardData.files);
      }}
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <h2 id="capture-title" className="h2">{tr['capture.title']}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="px-5 pt-4">
        <div role="tablist" aria-label="Capture type" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon size={15} aria-hidden /> {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {tab === 'text' && (
            <textarea autoFocus aria-label="Text to capture" className="field min-h-36" value={text} onChange={(e) => setText(e.target.value)} placeholder={tr['capture.placeholder']}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }} />
          )}
          {tab === 'url' && (
            <>
              <input type="url" inputMode="url" aria-label="Link" className="field" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <textarea aria-label="Note about the link" className="field min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why are you saving this? (optional)" />
              <p className="text-xs muted">The page is fetched once to read its title and text. Private-network addresses are never fetched.</p>
            </>
          )}
          {(tab === 'files' || files.length > 0) && (
            <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm ${dragging ? 'border-[var(--color-blue)] bg-[var(--color-blue-soft)]' : 'border-[var(--line)]'}`}>
              <Upload size={22} aria-hidden />
              <span>{tr['capture.drop']}</span>
              <span className="text-xs muted">Images, PDFs, text or audio · up to 10 files · 20 MB each</span>
              <input type="file" multiple className="sr-only" accept="image/*,application/pdf,text/plain,audio/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </label>
          )}
          {tab === 'voice' && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] p-5 text-center">
              <button className={`btn ${recording ? 'btn-danger' : 'btn-primary'}`} onClick={toggleRecord} aria-pressed={Boolean(recording)}>
                {recording ? <Square size={16} /> : <Mic size={16} />} {recording ? 'Stop recording' : 'Start recording'}
              </button>
              <p className="text-xs muted">The recording is saved as an audio file. There is no on-device transcription in this version — add a short note in the Text tab so it can be found.</p>
            </div>
          )}
          {files.length > 0 && (
            <ul className="space-y-1.5" aria-label="Files to capture">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><FileText size={15} aria-hidden /> <span className="truncate">{f.name}</span></span>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cap-date">{tr['capture.sourceDate']}</label>
              <input id="cap-date" type="date" className="field" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
            </div>
            {spaces.length > 1 && (
              <div>
                <label className="label" htmlFor="cap-ws">{tr['common.space']}</label>
                <select id="cap-ws" className="field" value={ws} onChange={(e) => setWs(e.target.value)}>
                  {spaces.filter((s) => s.role !== 'limited').map((s) => <option key={s.workspaceId} value={s.workspaceId}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
        <p className="hidden text-xs muted sm:block">Nothing is saved as a task until you confirm it.</p>
        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={onClose}>{tr['common.cancel']}</button>
          <button className="btn btn-blue" onClick={submit} disabled={busy}>{busy ? tr['capture.saving'] : tr['capture.save']}</button>
        </div>
      </div>
    </dialog>
  );
}
