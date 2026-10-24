import { useEffect, useRef, useState } from 'react';
import type { Fill, SceneNode } from '@open-pencil/scene-graph';
import { usePencilWorkspace } from './runtime';
import { updateVideoAsset, videoAsset } from './videoPaints';
export function VideoFillControls({ node, fill, index, change }: { node: SceneNode; fill: Fill; index: number; change: (patch: Partial<Fill>) => void }) {
  const editor = usePencilWorkspace(state => state.editor)!, asset = videoAsset(node, fill), bytes = asset && editor.graph.images.get(asset.videoHash);
  const [url, setUrl] = useState('');
  const video=useRef<HTMLVideoElement>(null);
  useEffect(() => { if (!bytes || !asset) return; const next = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: asset.mime })); setUrl(next); return () => URL.revokeObjectURL(next); }, [bytes, asset?.mime]);
  useEffect(()=>{const media=video.current;return()=>{if(media){media.pause();media.removeAttribute('src');media.load();}};},[url]);
  if (!asset || !bytes) return <p role="alert">This video resource is missing. Reimport its original file.</p>;
  return <><label>Video fit<select aria-label={`Video ${index + 1} fit`} value={fill.imageScaleMode ?? 'FILL'} onChange={event => change({ imageScaleMode: event.target.value as Fill['imageScaleMode'] })}><option value="FILL">Fill</option><option value="FIT">Fit</option></select></label>
    {url && <video key={url} ref={video} className="xd-pencil-video-preview" aria-label={`Preview ${asset.name}`} src={url} controls muted playsInline preload="metadata" />}
    <small>{asset.width} × {asset.height} · {Math.round(asset.duration)}s · {(bytes.byteLength / 1024 / 1024).toFixed(1)} MB</small>
    {(['autoplay', 'loop', 'muted', 'controls'] as const).map(key => <label key={key}><input type="checkbox" checked={asset[key]} onChange={event => updateVideoAsset(editor, node, asset, { [key]: event.target.checked })} />{({ autoplay: 'Autoplay in presentation', loop: 'Loop', muted: 'Muted', controls: 'Show playback controls' })[key]}</label>)}
    <p>The editing canvas and static exports use the saved poster. Present and React export play the video. Autoplay uses muted audio.</p>
  </>;
}
