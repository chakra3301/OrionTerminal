import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), engines: vi.fn(), inspect: vi.fn(), start: vi.fn(), stop: vi.fn(), import: vi.fn(), remove: vi.fn(), accept: vi.fn(), activity: vi.fn(), preferences: vi.fn(), archiveCount: vi.fn(), forget: vi.fn(), export: vi.fn(), batch: vi.fn(), queueStatus: vi.fn(), queueRun: vi.fn(), queueHold: vi.fn(), queueAdd: vi.fn(), queuePause: vi.fn(), queueResume: vi.fn(), queueReorder: vi.fn(), playlist: vi.fn(), playlistQueue: vi.fn() }));
vi.mock("./downloadTypes", async (original) => ({ ...await original<object>(), downloadApi: m }));
vi.mock("@/store/assetsStore", () => ({ useAssetsStore: { getState: () => ({ acceptDownload: m.accept }) } }));
vi.mock("../runtimeActivity", () => ({ setArchivesActivity: m.activity }));
import { useDownloads } from "./downloadStore";
import { bytesLabel, downloadPercent, type DownloadJob, type DownloadPlaylist, downloadDefaults, defaultDownloadOptions, parseBatchLinks } from "./downloadTypes";
const fixture = (state: DownloadJob["state"]): DownloadJob => ({ id: "test-job", url: "https://example.com/video", state, preset: "video-1080", metadata: { title:"Test",creator:"Owner",description:"Original recording",site:"example.com",tags:[],heights:[1080],duration:60 },error:null,assetId:state === "completed" ? "test-job" : null,createdAt:1,progress: { downloaded:null,total:null,speed:null,eta:null,processing:false } });
function deferred<T>() { let resolve!: (value:T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve,promise }; }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  useDownloads.setState({ jobs: [], error:null,pending:null,uncertain:false,loading:false,engines:null,preferences:null,preferencesError:null,archiveCount:null,queue:{running:false,concurrency:1,error:null},playlist:null,scanId:null });
  m.list.mockResolvedValue([]); m.inspect.mockResolvedValue(undefined); m.start.mockResolvedValue(undefined); m.stop.mockResolvedValue(undefined); m.remove.mockResolvedValue(undefined); m.import.mockResolvedValue("test-job"); m.accept.mockResolvedValue(undefined);
  m.queueStatus.mockResolvedValue({running:false,concurrency:1,error:null}); m.batch.mockResolvedValue(["test-job"]); m.queueRun.mockResolvedValue({ids:["test-job"],status:{running:true,concurrency:2,error:null}}); m.queueHold.mockResolvedValue({running:false,concurrency:2,error:null}); m.queueAdd.mockResolvedValue(undefined); m.queuePause.mockResolvedValue(undefined); m.queueResume.mockResolvedValue(undefined); m.queueReorder.mockResolvedValue(undefined); m.playlistQueue.mockResolvedValue(["test-job"]);
  m.preferences.mockResolvedValue(downloadDefaults("video-1080",defaultDownloadOptions())); m.archiveCount.mockResolvedValue(3); m.forget.mockResolvedValue(undefined); m.export.mockResolvedValue(null);
});
afterEach(async () => {
  m.list.mockResolvedValue([]); await useDownloads.getState().refresh(); vi.clearAllTimers(); vi.useRealTimers();
});
it("inspection is explicit and does not start downloading", async () => {
  await useDownloads.getState().refresh(); expect(m.inspect).not.toHaveBeenCalled();
  await useDownloads.getState().inspect(" https://example.com/video ");
  expect(m.inspect).toHaveBeenCalledWith(expect.any(String),"https://example.com/video");
  expect(m.start).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("polling survives view unmount and imports only this session's explicitly started download", async () => {
  m.list.mockResolvedValue([fixture("downloading")]);
  await useDownloads.getState().start("test-job","audio-mp3");
  expect(m.activity).toHaveBeenCalledWith("media-downloads",true,expect.any(String));
  m.list.mockResolvedValueOnce([fixture("ready")]).mockResolvedValue([fixture("completed")]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(m.import).toHaveBeenCalledTimes(1); expect(m.accept).toHaveBeenCalledWith("test-job",true);
  expect(useDownloads.getState().jobs[0]?.state).toBe("completed");
  expect(m.activity).toHaveBeenLastCalledWith("media-downloads",false,expect.any(String));
});
it("does not start imports or AI tagging when reopening history", async () => {
  m.list.mockResolvedValue([fixture("ready")]); await useDownloads.getState().refresh();
  expect(m.import).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("retains ready media after import failure and retries without a second download", async () => {
  m.list.mockResolvedValue([fixture("ready")]); m.import.mockRejectedValueOnce(new Error("disk full"));
  await useDownloads.getState().save("test-job");
  expect(useDownloads.getState().error).toContain("disk full"); expect(useDownloads.getState().jobs[0]?.state).toBe("ready");
  m.import.mockResolvedValue("test-job"); m.list.mockResolvedValue([fixture("completed")]); await useDownloads.getState().save("test-job");
  expect(m.start).not.toHaveBeenCalled(); expect(m.accept).toHaveBeenCalledTimes(1);
});
it("stop suppresses automatic import even if the native file finished in the race", async () => {
  m.list.mockResolvedValue([fixture("downloading")]); await useDownloads.getState().start("test-job","video-720");
  m.list.mockResolvedValue([fixture("ready")]); await useDownloads.getState().stop("test-job");
  expect(m.stop).toHaveBeenCalledWith("test-job"); expect(m.import).not.toHaveBeenCalled();
});
it("uncertain native start failures keep the lifecycle guard until a list confirms idle", async () => {
  m.inspect.mockRejectedValue(new Error("lost receipt")); m.list.mockRejectedValue(new Error("database offline"));
  await useDownloads.getState().inspect("https://example.com/video");
  expect(useDownloads.getState().uncertain).toBe(true); expect(m.activity).toHaveBeenLastCalledWith("media-downloads",true,expect.any(String));
  m.list.mockResolvedValue([]); await useDownloads.getState().refresh(); expect(useDownloads.getState().uncertain).toBe(false);
});
it("ignores a stale history response after a new operation begins", async () => {
  const old = deferred<DownloadJob[]>(); m.list.mockReturnValueOnce(old.promise).mockResolvedValue([fixture("inspecting")]);
  const refresh = useDownloads.getState().refresh(); const start = useDownloads.getState().inspect("https://example.com/video");
  old.resolve([fixture("completed")]); await refresh; await start;
  expect(useDownloads.getState().jobs[0]?.state).toBe("inspecting"); expect(m.accept).not.toHaveBeenCalled();
});
it("loads native defaults and archive count without starting an operation", async () => {
  await useDownloads.getState().loadPreferences();
  expect(useDownloads.getState().preferences?.options.playable).toBe(true); expect(useDownloads.getState().archiveCount).toBe(3);
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it("a stale defaults read cannot replace a newly saved configuration", async () => {
  const old=deferred<ReturnType<typeof downloadDefaults>>(); m.preferences.mockReturnValueOnce(old.promise);
  const reading=useDownloads.getState().loadPreferences();
  const saved=downloadDefaults("audio-mp3",{...defaultDownloadOptions(),rateLimitKib:512}); m.preferences.mockResolvedValueOnce(saved);
  await useDownloads.getState().savePreferences(saved); old.resolve(downloadDefaults("video-1080",defaultDownloadOptions())); await reading;
  expect(useDownloads.getState().preferences).toEqual(saved);
});
it("failed defaults reads preserve the error without resetting persisted preferences", async () => {
  m.preferences.mockRejectedValue(new Error("Unknown version")); await useDownloads.getState().loadPreferences();
  expect(useDownloads.getState().preferences).toBeNull(); expect(useDownloads.getState().preferencesError).toContain("Unknown version");
  expect(m.preferences).toHaveBeenCalledWith();
});
it("export cancel has no Media import, source mutation or AI send",async()=>{
  await useDownloads.getState().refresh(); expect(m.export).not.toHaveBeenCalled();
  expect(await useDownloads.getState().export("test-job")).toBeNull();
  expect(m.export).toHaveBeenCalledWith("test-job"); expect(m.import).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("forgetting source tracking does not remove history or library data",async()=>{
  await useDownloads.getState().forget("test-job"); expect(m.forget).toHaveBeenCalledWith("test-job"); expect(m.remove).not.toHaveBeenCalled(); expect(m.import).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("cookie requests are one-operation arguments, never attached to saved jobs or defaults",async()=>{
  const cookies={browser:"chrome" as const,profile:"Profile 2"}; await useDownloads.getState().inspect("https://example.com/video",cookies);
  expect(m.inspect).toHaveBeenCalledWith(expect.any(String),"https://example.com/video",cookies);
  await useDownloads.getState().start("test-job","video-1080",undefined,cookies);
  expect(m.start).toHaveBeenCalledWith("test-job","video-1080",undefined,cookies);
  expect(m.preferences).not.toHaveBeenCalled(); expect(JSON.stringify(useDownloads.getState().jobs)).not.toContain("Profile 2");
});
it("batch staging stays held, strips whitespace and never starts a model or transfer", async () => {
  expect(await useDownloads.getState().batch(" https://example.com/a\n\nhttps://example.com/b ")).toBe(true);
  expect(m.batch).toHaveBeenCalledWith(["https://example.com/a","https://example.com/b"]); expect(m.queueRun).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("invalid and repeated batches fail before invoking native staging", async () => {
  for (const input of ["", "file:///etc/hosts", "https://user:secret@example.com/", "https://example.com/a\nhttps://example.com/a", Array(51).fill("https://example.com/a").join("\n")]) expect(() => parseBatchLinks(input)).toThrow();
  expect(await useDownloads.getState().batch("file:///etc/hosts")).toBe(false); expect(m.batch).not.toHaveBeenCalled();
});
it("explicit queue run adopts only the native session receipt without importing again", async () => {
  m.list.mockResolvedValue([{...fixture("completed"),queue:{position:1,resumeTransfer:false}}]);
  await useDownloads.getState().runQueue(2);
  expect(m.queueRun).toHaveBeenCalledWith(2); expect(m.accept).toHaveBeenCalledWith("test-job",true); expect(m.import).not.toHaveBeenCalled();
  await useDownloads.getState().refresh(); expect(m.accept).toHaveBeenCalledTimes(1);
});
it("reopening queued or completed history does not acquire run or AI authority", async () => {
  m.list.mockResolvedValue([{...fixture("queued"),queue:{position:1,resumeTransfer:false}}, {...fixture("completed"),id:"old"}]); await useDownloads.getState().refresh();
  expect(m.queueRun).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("holding the queue releases waiting adoption intent without losing queued jobs", async () => {
  const queued={...fixture("queued"),queue:{position:1,resumeTransfer:false}}; m.list.mockResolvedValue([queued]); m.queueStatus.mockResolvedValue({running:true,concurrency:2,error:null});
  await useDownloads.getState().runQueue(2); m.queueStatus.mockResolvedValue({running:false,concurrency:2,error:null}); await useDownloads.getState().holdQueue();
  m.list.mockResolvedValue([fixture("completed")]); await useDownloads.getState().refresh(); expect(m.accept).not.toHaveBeenCalled(); expect(m.stop).not.toHaveBeenCalled();
});
it("resume returns to held queue rather than silently starting an engine", async () => {
  await useDownloads.getState().resume("test-job"); expect(m.queueResume).toHaveBeenCalledWith("test-job"); expect(m.queueRun).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it("queue publication errors retain ready bytes for explicit Save without auto retries", async () => {
  m.list.mockResolvedValue([{...fixture("ready"),queue:{position:1,resumeTransfer:false},error:"Disk error"}]); await useDownloads.getState().runQueue(2); await useDownloads.getState().refresh();
  expect(m.import).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled();
});
it("Stop scan cancels independently of its pending command and ignores a late review", async () => {
  const late=deferred<DownloadPlaylist>(); m.playlist.mockReturnValueOnce(late.promise);
  const scan=useDownloads.getState().scanPlaylist("https://example.com/playlist"); const id=useDownloads.getState().scanId;
  expect(id).toBeTruthy(); expect(useDownloads.getState().pending).toBe("Reading playlist");
  await useDownloads.getState().stopScan(); expect(m.stop).toHaveBeenCalledWith(id);
  late.resolve({id:id!,sourceUrl:"https://example.com/playlist",title:"Late",entries:[],truncated:false}); expect(await scan).toBe(false); expect(useDownloads.getState().playlist).toBeNull();
});
it("playlist queuing sends only native review identity and indices, not editable URLs", async () => {
  await useDownloads.getState().queuePlaylist("review-id",[2,4]); expect(m.playlistQueue).toHaveBeenCalledWith("review-id",[2,4]); expect(m.batch).not.toHaveBeenCalled(); expect(m.queueRun).not.toHaveBeenCalled();
});
it("a rejected Stop keeps automatic completion tracking for an in-flight publication", async () => {
  m.list.mockResolvedValue([fixture("downloading")]); await useDownloads.getState().start("test-job","video-720");
  m.stop.mockRejectedValueOnce(new Error("Saving to Media; wait for publication."));
  await useDownloads.getState().stop("test-job");
  m.list.mockResolvedValueOnce([fixture("ready")]).mockResolvedValue([fixture("completed")]);
  await useDownloads.getState().refresh();
  expect(m.accept).toHaveBeenCalledWith("test-job",true);
});
it("a rejected Stop preserves native queue completion adoption", async () => {
  m.list.mockResolvedValue([{...fixture("downloading"),queue:{position:1,resumeTransfer:false}}]);
  m.queueStatus.mockResolvedValue({running:true,concurrency:1,error:null});
  await useDownloads.getState().runQueue(1);
  m.stop.mockRejectedValueOnce(new Error("Saving to Media.")); await useDownloads.getState().stop("test-job");
  m.list.mockResolvedValue([fixture("completed")]); await useDownloads.getState().refresh();
  expect(m.accept).toHaveBeenCalledExactlyOnceWith("test-job",true);
  expect(m.import).not.toHaveBeenCalled();
});
it("bounds progress and never fabricates an unknown size", () => {
  const job = fixture("downloading"); expect(downloadPercent(job)).toBeUndefined();
  job.progress.total = 100; job.progress.downloaded = 200; expect(downloadPercent(job)).toBe(100);
  job.progress.total = NaN; expect(downloadPercent(job)).toBeUndefined();
  expect(bytesLabel(null)).toBe(""); expect(bytesLabel(1024)).toBe("1.0 KiB");
});
