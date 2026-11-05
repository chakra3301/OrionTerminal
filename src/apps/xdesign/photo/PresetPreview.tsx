import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { PresetPreviewCache, type PresetPreviewRequest } from './presetPreviewCache';

const previews = new PresetPreviewCache(request => invoke('xdesign_photo_preset_preview', request));
export function PresetPreview({ kind, preset, group, revision }: Omit<PresetPreviewRequest, 'revision'> & { revision?: number }) {
  const element = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(false), [url, setURL] = useState<string|null>(null), [error, setError] = useState<string|null>(null);
  useEffect(() => {
    const target = element.current; if (!target) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '48px' });
    observer.observe(target); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setURL(null); setError(null);
    if (!visible || !isTauri() || revision === undefined || !Number.isSafeInteger(revision) || revision < 0) return;
    return previews.subscribe({ kind, preset, ...(group !== undefined ? { group } : {}), revision }, (url,error) => { setURL(url); setError(error); });
  }, [visible, kind, preset, group, revision]);
  return <span ref={element} className="xd-photo-preset-sample" aria-hidden="true" title={error ?? undefined} data-preview={url ? 'ready' : error ? 'unavailable' : 'loading'}>{url && <img src={url} alt="" draggable={false}/>}</span>;
}
