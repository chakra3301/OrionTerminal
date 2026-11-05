import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ select:vi.fn(), consent:vi.fn(), analysis:vi.fn(), upsert:vi.fn(), attach:vi.fn(), index:vi.fn(),execute:vi.fn(),favorite:vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb:async () => ({ select:m.select,execute:m.execute }), listAssets:vi.fn(), insertAsset:vi.fn(), deleteAsset:vi.fn(), setAssetFavorite:m.favorite, upsertTagsByName:m.upsert, attachAssetTags:m.attach, listAllAssetTags:vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc:{} }));
vi.mock("@/lib/log", () => ({ log:{warn:vi.fn(),error:vi.fn()} }));
vi.mock("@/store/toastStore", () => ({ toast:{warning:vi.fn()} }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex:m.index, removeEntityEmbedding:vi.fn() }));
vi.mock("@/features/agents/textCall", () => ({ runSurfaceAnalysis:m.analysis }));
vi.mock("@/store/backgroundAiStore", () => ({ withBackgroundConsent:m.consent }));
import { useAssetsStore } from "./assetsStore";
const row = { id:"download",kind:"audio",title:"Piano practice",file_path:"/private/assets/audio.m4a",url:"https://example.com/video?token=private",metadata_json:JSON.stringify({creator:"Owner",description:"Music theory lesson"}),mime_type:"audio/mp4",size_bytes:1024,original_name:"Piano practice.m4a",created_at:1,favorite:0 };
beforeEach(() => {
  vi.clearAllMocks(); useAssetsStore.setState({ assets:new Map(),taggingIds:new Set(),loaded:true });
  m.select.mockImplementation(async (sql:string) => sql.includes("SELECT *") ? [row] : [{name:"downloaded"},{name:"audio"}]);
  m.consent.mockImplementation(async (_kind,task) => task(new AbortController().signal));
  m.analysis.mockResolvedValue("piano, music"); m.upsert.mockResolvedValue([{id:"piano",name:"piano"},{id:"music",name:"music"}]); m.attach.mockResolvedValue(undefined);
});
it("keeps deterministic tags and searchable library classification when background AI is off", async () => {
  m.consent.mockResolvedValue(null); await useAssetsStore.getState().acceptDownload("download",true);
  await vi.waitFor(() => expect(useAssetsStore.getState().taggingIds.size).toBe(0));
  expect(useAssetsStore.getState().assets.get("download")).toMatchObject({kind:"audio",tags:["downloaded","audio"],sourceCreator:"Owner"});
  expect(m.analysis).not.toHaveBeenCalled(); expect(m.index).toHaveBeenCalledWith("asset","download",expect.any(Function));
});
it("enriches local tags from metadata without attaching media or sending the source URL", async () => {
  await useAssetsStore.getState().acceptDownload("download",true);
  await vi.waitFor(() => expect(useAssetsStore.getState().taggingIds.size).toBe(0));
  expect(m.analysis).toHaveBeenCalledWith(expect.stringContaining("Music theory lesson"),"archives",{signal:expect.any(AbortSignal),imagePath:undefined});
  expect(m.analysis.mock.calls[0]?.[0]).not.toContain("token=private");
  expect(useAssetsStore.getState().assets.get("download")?.tags).toEqual(["downloaded","audio","piano","music"]);
});
it("a history refresh can add a saved asset without any analysis", async () => {
  await useAssetsStore.getState().acceptDownload("download",false); expect(m.consent).not.toHaveBeenCalled(); expect(m.analysis).not.toHaveBeenCalled();
});
it("reads only a poster bound to this asset identity and directory",async()=>{
  for(const [posterPath,expected] of [["/private/assets/download.poster.jpg",true],["/private/assets/other.poster.jpg",false],["/private/cookies/download.poster.jpg",false],["https://example.com/poster.jpg",false]] as const) {
    m.select.mockImplementation(async(sql:string)=>sql.includes("SELECT *") ? [{...row,metadata_json:JSON.stringify({posterPath})}] : []);
    await useAssetsStore.getState().acceptDownload("download",false);
    expect(useAssetsStore.getState().assets.get("download")?.posterPath).toBe(expected ? posterPath : undefined);
  }
  expect(m.analysis).not.toHaveBeenCalled(); expect(m.consent).not.toHaveBeenCalled();
});
it("renames only the library title, with validation and no model or original-file action",async()=>{
  await useAssetsStore.getState().acceptDownload("download",false);m.index.mockClear();
  m.execute.mockResolvedValue(undefined);await useAssetsStore.getState().rename("download","  New library title  ");
  expect(m.execute).toHaveBeenCalledWith("UPDATE assets SET title = $1 WHERE id = $2",["New library title","download"]);
  expect(useAssetsStore.getState().assets.get("download")).toMatchObject({title:"New library title",originalName:"Piano practice.m4a",filePath:row.file_path});
  for(const title of ["", "x".repeat(301),"line\\ncontrol".replace("\\n","\n")]) await expect(useAssetsStore.getState().rename("download",title)).rejects.toThrow();
  expect(m.analysis).not.toHaveBeenCalled();expect(m.index).not.toHaveBeenCalled();
});
it("failed title or favorite persistence does not leave optimistic false library state",async()=>{
  await useAssetsStore.getState().acceptDownload("download",false);
  m.execute.mockRejectedValueOnce(new Error("offline"));await expect(useAssetsStore.getState().rename("download","Unsaved")).rejects.toThrow("offline");
  m.favorite.mockRejectedValueOnce(new Error("offline"));await expect(useAssetsStore.getState().toggleFavorite("download")).rejects.toThrow("offline");
  expect(useAssetsStore.getState().assets.get("download")).toMatchObject({title:row.title,favorite:false});
});
it("retains deleted-asset refusal instead of inventing a saved item", async () => {
  m.select.mockResolvedValue([]); await expect(useAssetsStore.getState().acceptDownload("download",true)).rejects.toThrow("no longer");
  expect(m.analysis).not.toHaveBeenCalled(); expect(useAssetsStore.getState().assets.size).toBe(0);
});
