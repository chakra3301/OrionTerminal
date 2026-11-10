import { invoke } from "@tauri-apps/api/core";

export type SidecarTrack = { index: number; codec: string; language: string; title: string; supported: boolean };
export type CaptionIndex = { streamIndex: number; language: string; cues: number; stale: boolean };
export type AssetExtras = { reviewId: string; assetId: string; title: string; duration: number; tracks: SidecarTrack[]; chapters: Array<{ start: number; end: number; title: string }>; indexed: CaptionIndex | null };
export type SidecarKind = "vtt" | "srt" | "chapters" | "metadata";
export type CaptionSearchResult = { assetId: string; title: string; snippet: string };
export const sidecarApi = {
  inspect: (id: string, assetId: string) => invoke<AssetExtras>("media_download_asset_extras", { id, assetId }),
  export: (id: string, reviewId: string, kind: SidecarKind, streamIndex?: number) => invoke<string | null>("media_download_export_sidecar", { id, reviewId, kind, streamIndex }),
  index: (id: string, reviewId: string, streamIndex: number) => invoke<CaptionIndex>("media_download_index_captions", { id, reviewId, streamIndex }),
  clear: (id: string, assetId: string) => invoke<void>("media_download_clear_captions", { id, assetId }),
  cancel: (id: string) => invoke<void>("media_download_sidecar_cancel", { id }),
  search: (query: string) => invoke<CaptionSearchResult[]>("media_download_search_captions", { query }),
};
