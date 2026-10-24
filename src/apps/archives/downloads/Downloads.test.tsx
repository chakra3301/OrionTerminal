// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const confirm = vi.hoisted(() => vi.fn(async()=>false));
const library = vi.hoisted(() => ({ assets: new Map<string, import("@/store/assetsStore").Asset>() }));
vi.mock("@/store/assetsStore", () => ({ useAssetsStore:Object.assign((select:(s:unknown)=>unknown)=>select({assets:library.assets}),{getState:()=>({acceptDownload:vi.fn()})}) }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction:confirm }));
vi.mock("@/store/backgroundAiStore", () => ({ useBackgroundAi:(select:(s:unknown)=>unknown)=>select({permissions:{assets:false}}) }));
import { ArchivesDownloads } from "./Downloads";
import { useDownloads } from "./downloadStore";
import { parseClipTime, timeLabel, downloadDefaults, defaultDownloadOptions, type DownloadJob } from "./downloadTypes";
const m = {inspect:vi.fn(),refresh:vi.fn(),checkEngines:vi.fn(),start:vi.fn(),stop:vi.fn(),save:vi.fn(),remove:vi.fn(),loadPreferences:vi.fn(),savePreferences:vi.fn(),forget:vi.fn(),export:vi.fn(),batch:vi.fn(),runQueue:vi.fn(),holdQueue:vi.fn(),addToQueue:vi.fn(),pause:vi.fn(),resume:vi.fn(),reorder:vi.fn(),scanPlaylist:vi.fn(),stopScan:vi.fn(),queuePlaylist:vi.fn()};
const job: DownloadJob = {id:"fixture",url:"https://example.com/video",state:"inspected",preset:"video-1080",metadata:{title:"<script>Untrusted title</script>",creator:"Owner",site:"example.com",description:"example",tags:[],heights:[],duration:60},error:null,assetId:null,createdAt:0,progress:{downloaded:null,total:null,speed:null,eta:null,processing:false}};
let host:HTMLDivElement, root:Root;
const button=(name:string)=>[...host.querySelectorAll("button")].find((b)=>b.textContent===name)!;
const urlInput=()=>host.querySelector<HTMLInputElement>('.dl-linkbar input')!;
async function input(value:string,el=urlInput()) { await act(async()=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value); el.dispatchEvent(new Event("input",{bubbles:true})); }); }
const render=async()=>act(async()=>root.render(<ArchivesDownloads/>));
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.clearAllMocks(); library.assets.clear(); confirm.mockResolvedValue(false); m.inspect.mockResolvedValue(true); m.refresh.mockResolvedValue(undefined); m.checkEngines.mockResolvedValue(undefined); m.loadPreferences.mockResolvedValue(undefined); m.savePreferences.mockResolvedValue(true);
  m.batch.mockResolvedValue(true); m.scanPlaylist.mockResolvedValue(true);
  useDownloads.setState({queue:{running:false,concurrency:1,error:null},playlist:null,scanId:null,batchDraft:"",playlistDraft:"",preferences:downloadDefaults("video-1080",defaultDownloadOptions()),preferencesError:null,archiveCount:3,jobs:[],error:null,pending:null,loading:false,uncertain:false,engines:{ytDlp:"/private/yt-dlp",ffmpeg:"/existing/ffmpeg",ffprobe:"/existing/ffprobe",node:"/existing/node"},...m});
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
});
afterEach(async()=>{ await act(async()=>root.unmount()); host.remove(); });
it("shows native raster previews without allowing arbitrary remote or SVG image sources",async()=>{
  useDownloads.setState({jobs:[{...job,thumbnailPreview:"data:image/jpeg;base64,/9j/2Q=="}]}); await render();
  expect(host.querySelector('.dl-item img')?.getAttribute("src")).toBe("data:image/jpeg;base64,/9j/2Q==");
  await act(async()=>useDownloads.setState({jobs:[{...job,thumbnailPreview:"https://untrusted.example/tracker.jpg"}]}));
  expect(host.querySelector('.dl-item img')).toBeNull();
  await act(async()=>useDownloads.setState({jobs:[{...job,thumbnailPreview:"data:image/svg+xml;base64,PHN2Zz4="}]}));
  expect(host.querySelector('.dl-item img')).toBeNull();
});
it("filters by library titles/tags and favorites instead of leaving an unrelated inspector visible",async()=>{
  library.assets.set("saved",{id:"saved",kind:"audio",title:"Renamed song",filePath:"/owned/saved.m4a",mimeType:"audio/mp4",sizeBytes:10,originalName:"song.m4a",createdAt:1,tags:["piano"],favorite:true});
  useDownloads.setState({jobs:[{...job,state:"completed",assetId:"saved",preset:"audio-m4a"}]});await render();
  expect(host.querySelector('.dl-item h3')?.textContent).toBe("Renamed song");
  const filter=host.querySelector<HTMLSelectElement>('select[aria-label="Filter media type"]')!;
  await act(async()=>{filter.value="favorites";filter.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(host.querySelectorAll('.dl-item')).toHaveLength(1);
  await input("piano",host.querySelector<HTMLInputElement>('.dl-filter input')!);expect(host.querySelectorAll('.dl-item')).toHaveLength(1);
  await input("not-present",host.querySelector<HTMLInputElement>('.dl-filter input')!);expect(host.querySelector('.dl-source-title')).toBeNull();expect(host.querySelector('.dl-inspector-empty')).not.toBeNull();
});
it("SponsorBlock stays off until selected and reaches only explicit jobs/default saving",async()=>{
  useDownloads.setState({jobs:[{...job,metadata:{...job.metadata!,sourceId:"Youtube:abcdefghijk"}}]});await render();
  const select=host.querySelector<HTMLSelectElement>('.dl-inspector select[id$="-mode"]')!;expect(select.value).toBe("off");
  expect(host.textContent).toContain("hash prefix");expect(host.textContent).toContain("Inspection does not make this lookup");
  await act(async()=>{select.value="mark";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await act(async()=>[...host.querySelectorAll<HTMLLabelElement>('.dl-inspector label')].find((l)=>l.textContent==="Intros")!.querySelector<HTMLInputElement>('input')!.click());
  expect(m.start).not.toHaveBeenCalled();expect(m.inspect).not.toHaveBeenCalled();expect(m.addToQueue).not.toHaveBeenCalled();
  const sponsorblock={mode:"mark",categories:["sponsor","intro"]};
  await act(async()=>button("Download").click());expect(m.start).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({sponsorblock}));
  await act(async()=>button("Add to queue").click());expect(m.addToQueue).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({sponsorblock}));
  await act(async()=>button("Save these defaults").click());expect(m.savePreferences).toHaveBeenCalledWith(expect.objectContaining({options:expect.objectContaining({sponsorblock})}));
});
it("SponsorBlock removal refuses the current clip toggle and empty categories before submission",async()=>{
  useDownloads.setState({jobs:[{...job,metadata:{...job.metadata!,sourceId:"Youtube:abcdefghijk"},options:{...defaultDownloadOptions(),sponsorblock:{mode:"remove",categories:["sponsor"]}}}]});await render();
  const clip=[...host.querySelectorAll<HTMLLabelElement>('.dl-inspector label')].find((l)=>l.textContent==="Clip a section")!.querySelector<HTMLInputElement>('input')!;
  await act(async()=>clip.click());expect(button("Download").disabled).toBe(true);expect(button("Add to queue").disabled).toBe(true);expect(host.textContent).toContain("Removal needs full-length");
  await act(async()=>clip.click());expect(button("Download").disabled).toBe(false);
  await act(async()=>[...host.querySelectorAll<HTMLLabelElement>('.dl-inspector label')].find((l)=>l.textContent==="Sponsors")!.querySelector<HTMLInputElement>('input')!.click());
  expect(button("Download").disabled).toBe(true);expect(button("Save these defaults").disabled).toBe(true);expect(host.textContent).toContain("Select at least one");expect(m.start).not.toHaveBeenCalled();
});
it("unsupported sources cannot enable SponsorBlock and incompatible audio marking clears without a request",async()=>{
  useDownloads.setState({jobs:[job]});await render();let select=host.querySelector<HTMLSelectElement>('.dl-inspector select[id$="-mode"]')!;
  expect([...select.options].filter((o)=>o.value!=="off").every((o)=>o.disabled)).toBe(true);
  await act(async()=>useDownloads.setState({jobs:[{...job,id:"tube",metadata:{...job.metadata!,sourceId:"Youtube:abcdefghijk"},options:{...defaultDownloadOptions(),sponsorblock:{mode:"mark",categories:["sponsor"]}}}]}));
  await act(async()=>button("Audio only").click());select=host.querySelector<HTMLSelectElement>('.dl-inspector select[id$="-mode"]')!;expect(select.value).toBe("off");expect(m.start).not.toHaveBeenCalled();
});
it("SponsorBlock defaults opt-in never starts inspection or a queue",async()=>{
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Download settings"]')!.click());
  const select=host.querySelector<HTMLSelectElement>('.dl-defaults-editor select[id$="-mode"]')!;
  await act(async()=>{select.value="remove";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await act(async()=>button("Save defaults").click());expect(m.savePreferences).toHaveBeenCalledWith(expect.objectContaining({options:expect.objectContaining({sponsorblock:{mode:"remove",categories:["sponsor"]}})}));
  expect(m.inspect).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();expect(m.runQueue).not.toHaveBeenCalled();
});
it("resource limits reach explicit Download, Queue and saved defaults without starting automatically",async()=>{
  useDownloads.setState({jobs:[job]}); await render();
  const field=(name:string)=>[...host.querySelectorAll<HTMLLabelElement>('.dl-inspector label')].find((l)=>l.textContent?.startsWith(name))!.querySelector<HTMLInputElement>('input')!;
  await input("16384",field("Combined unfinished work")); await input("8192",field("Maximum media file"));
  await input("1024",field("Keep free on disk")); await input("90",field("Per engine operation"));
  expect(m.start).not.toHaveBeenCalled();expect(m.addToQueue).not.toHaveBeenCalled();expect(m.savePreferences).not.toHaveBeenCalled();
  const limits={fileMib:8192,workMib:16384,freeMib:1024,minutes:90};
  await act(async()=>button("Download").click()); expect(m.start).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({limits}));
  await act(async()=>button("Add to queue").click());expect(m.addToQueue).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({limits}));
  await act(async()=>button("Save these defaults").click());expect(m.savePreferences).toHaveBeenCalledWith(expect.objectContaining({options:expect.objectContaining({limits})}));
});
it("invalid work limits disable source submission and never replace saved defaults",async()=>{
  useDownloads.setState({jobs:[job]});await render();
  const limit=host.querySelector<HTMLInputElement>('.dl-inspector input[id$="-workMib"]')!;
  await input("31",limit); expect(host.querySelector('[role="alert"]')!.textContent).toContain("at least twice");
  for(const label of ["Download","Add to queue","Save these defaults"]) {expect(button(label).disabled).toBe(true);await act(async()=>button(label).click());}
  expect(m.start).not.toHaveBeenCalled();expect(m.addToQueue).not.toHaveBeenCalled();expect(m.savePreferences).not.toHaveBeenCalled();
});
it("defaults limits are independently editable and invalid reserve cannot be saved",async()=>{
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Download settings"]')!.click());
  const limit=host.querySelector<HTMLInputElement>('.dl-defaults-editor input[id$="-freeMib"]')!;
  await input("511",limit);expect(button("Save defaults").disabled).toBe(true);
  await act(async()=>button("Save defaults").click());expect(m.savePreferences).not.toHaveBeenCalled();
  await input("2048",limit);await act(async()=>button("Save defaults").click());
  expect(m.savePreferences).toHaveBeenCalledWith(expect.objectContaining({options:expect.objectContaining({limits:{fileMib:2048,workMib:4096,freeMib:2048,minutes:45}})}));
  expect(m.inspect).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
});
it("embedding choices reach Download and Queue without automatically contacting a source", async()=>{
  useDownloads.setState({jobs:[{...job,metadata:{...job.metadata!,subtitles:["en"],automaticSubtitles:["fr"],chapters:2}}]}); await render();
  const toggle=async(name:string)=>act(async()=>[...host.querySelectorAll<HTMLLabelElement>(".dl-embedding label")].find((l)=>l.textContent===name)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await toggle("Embed source metadata");await toggle("Embed chapters");await toggle("Embed subtitles");await toggle("Allow automatic captions");
  const langs=host.querySelector<HTMLInputElement>('.dl-embedding input[placeholder="en, fr, pt-BR"]')!;
  await input("en, fr",langs);
  expect(m.start).not.toHaveBeenCalled();expect(m.inspect).not.toHaveBeenCalled();
  await act(async()=>button("Download").click());
  expect(m.start).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({embedMetadata:true,embedChapters:true,embedSubtitles:true,automaticSubtitles:true,subtitleLangs:["en","fr"]}));
  await act(async()=>button("Add to queue").click());
  expect(m.addToQueue).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({embedMetadata:true,embedChapters:true,embedSubtitles:true,subtitleLangs:["en","fr"]}));
});
it("mode changes clear incompatible embedding options and never start a download",async()=>{
  useDownloads.setState({jobs:[{...job,options:{...defaultDownloadOptions(),embedSubtitles:true,embedChapters:true,subtitleLangs:["en"]}}]});await render();
  await act(async()=>button("Audio only").click());
  const subtitles=[...host.querySelectorAll<HTMLLabelElement>(".dl-embedding label")].find((l)=>l.textContent==="Embed subtitles")!.querySelector<HTMLInputElement>("input")!;
  expect(subtitles.checked).toBe(false);expect(subtitles.disabled).toBe(true);
  await act(async()=>button("Download").click());
  expect(m.start).toHaveBeenCalledWith("fixture","audio-mp3",expect.objectContaining({embedSubtitles:false,embedChapters:false}));
});
it("old receipts do not claim newly verified extras",async()=>{
  useDownloads.setState({jobs:[{...job,state:"completed",metadata:{...job.metadata!,playback:{compatible:true,converted:false,container:"mp4",videoCodec:"h264",audioCodec:"aac"}}}]});await render();
  expect(host.textContent).not.toContain("Verified file extras");
});
it("batch drafts survive source switching and queuing stays explicit", async()=>{
  await render(); await act(async()=>button("Batch links").click());
  const area=host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(area,"https://example.com/a\nhttps://example.com/b");area.dispatchEvent(new Event("input",{bubbles:true}));});
  expect(m.batch).not.toHaveBeenCalled(); await act(async()=>button("Single link").click());await act(async()=>button("Batch links").click());
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("https://example.com/b");
  await act(async()=>button("Queue links").click());expect(m.batch).toHaveBeenCalledWith("https://example.com/a\nhttps://example.com/b");expect(m.runQueue).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
});
it("queue controls order real pending IDs and resume never starts a transfer", async()=>{
  const a={...job,id:"a",state:"paused" as const,queue:{position:1,resumeTransfer:true}},b={...job,id:"b",state:"queued" as const,queue:{position:2,resumeTransfer:false}};
  useDownloads.setState({jobs:[b,a]}); await render(); expect(host.textContent).toContain("Queue held");
  await act(async()=>button("Later").click());expect(m.reorder).toHaveBeenCalledWith(["b","a"]);
  await act(async()=>button("Return to queue").click());expect(m.resume).toHaveBeenCalledWith("a");expect(m.runQueue).not.toHaveBeenCalled();
  await act(async()=>button("Run queue").click());expect(m.runQueue).toHaveBeenCalledWith(1);
});
it("playlist review escapes titles and queues selected indices only",async()=>{
  useDownloads.setState({playlist:{id:"plan",sourceUrl:"https://example.com/playlist",title:"<script>Playlist</script>",truncated:false,entries:[{index:1,title:"<script>Entry</script>",url:"https://example.com/a",duration:5,unavailable:null},{index:2,title:"Private",url:null,duration:null,unavailable:"Restricted"}]}});
  await render();expect(host.querySelector("script")).toBeNull();expect(m.scanPlaylist).not.toHaveBeenCalled();
  const boxes=[...host.querySelectorAll<HTMLInputElement>('.dl-playlist-review input[type="checkbox"]')];expect(boxes[1]!.disabled).toBe(true);
  await act(async()=>boxes[0]!.click());await act(async()=>button("Queue 1 selected").click());expect(m.queuePlaylist).toHaveBeenCalledWith("plan",[1]);expect(m.runQueue).not.toHaveBeenCalled();
});
it("scan cancellation remains reachable after switching source surfaces",async()=>{
  useDownloads.setState({scanId:"scan",pending:"Reading playlist"});await render();await act(async()=>button("Single link").click());
  await act(async()=>button("Stop scan").click());expect(m.stopScan).toHaveBeenCalledTimes(1);
});
it("does not send a pasted link until Inspect is explicitly submitted", async()=>{
  await render(); await input("https://example.com/video"); expect(m.inspect).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  await act(async()=>button("Inspect link").click()); expect(m.inspect).toHaveBeenCalledWith("https://example.com/video");
});
it("retains draft on inspection failure and explains local versus AI tagging",async()=>{
  useDownloads.setState({jobs:[job]}); m.inspect.mockResolvedValue(false); await render(); await input("https://example.com/video"); await act(async()=>button("Inspect link").click());
  expect(urlInput().value).toBe("https://example.com/video"); expect(host.textContent).toContain("Background AI setting, currently off");
});
it("does not clear a newer link draft when the submitted inspection resolves",async()=>{
  let finish!:(ok:boolean)=>void; m.inspect.mockImplementation(()=>new Promise<boolean>((r)=>{finish=r;}));
  await render(); await input("https://example.com/first"); await act(async()=>button("Inspect link").click());
  await input("https://example.com/second"); await act(async()=>finish(true)); expect(urlInput().value).toBe("https://example.com/second");
});
it("missing engine blocks inspection and exposes setup without an automatic install",async()=>{
  useDownloads.setState({engines:{ytDlp:null,ffmpeg:"f",ffprobe:"p",node:"n"}}); await render();
  expect(button("Inspect link").disabled).toBe(true); expect(host.textContent).toContain("Not found"); expect(m.inspect).not.toHaveBeenCalled();
});
it("escapes metadata and sends selected audio format/options only on Download",async()=>{
  useDownloads.setState({jobs:[job]}); await render(); expect(host.textContent).toContain(job.metadata!.title); expect(host.querySelector("script")).toBeNull();
  await act(async()=>button("Audio only").click()); expect(host.querySelector<HTMLSelectElement>('.dl-inspector select[id$="-preset"]')!.options.length).toBe(8);
  expect(m.start).not.toHaveBeenCalled(); await act(async()=>button("Download").click());
  expect(m.start).toHaveBeenCalledWith("fixture","audio-mp3",expect.objectContaining({playable:false,skipDuplicates:true}));
});
it("provides the full resolution ladder and real video-only/combined choices",async()=>{
  useDownloads.setState({jobs:[job]}); await render();
  const formats=[...host.querySelector<HTMLSelectElement>('.dl-inspector select[id$="-preset"]')!.options].map((o)=>o.value);
  for(const value of ["video-combined","video-mp4","video-only","video-only-worst","video-4k","video-2k","video-480","video-360","video-240","video-144","video-worst"]) expect(formats).toContain(value);
  expect((host.querySelector('.dl-switch input') as HTMLInputElement).checked).toBe(true);
});
it("validates clip ranges before native download submission",async()=>{
  useDownloads.setState({jobs:[job]}); await render();
  const labels=[...host.querySelectorAll("label")]; const clip=labels.find((l)=>l.textContent==="Clip a section")!.querySelector("input")!;
  await act(async()=>clip.click()); const times=host.querySelectorAll<HTMLInputElement>(".dl-clip-times input");
  await input("0:40",times[0]!); await input("0:20",times[1]!); await act(async()=>button("Download").click()); expect(m.start).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Clip end must follow its start");
  await input("0:50",times[1]!); await act(async()=>button("Download").click());
  expect(m.start).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({startSeconds:40,endSeconds:50}));
});
it("exposes Stop with unknown progress instead of a fabricated percent",async()=>{
  useDownloads.setState({jobs:[{...job,state:"downloading"}]}); await render(); expect(host.querySelector("progress")!.hasAttribute("value")).toBe(false);
  await act(async()=>button("Stop downloading").click()); expect(m.stop).toHaveBeenCalledWith("fixture");
});
it("does not remove a history entry after its confirmation outlives the view",async()=>{
  let finish!:(ok:boolean)=>void; confirm.mockImplementation(()=>new Promise<boolean>((r)=>{finish=r;}));
  useDownloads.setState({jobs:[job]}); await render(); await act(async()=>button("Remove entry").click());
  await act(async()=>root.render(null)); await act(async()=>finish(true)); expect(m.remove).not.toHaveBeenCalled();
});
it("saves format/playback/tuning defaults without a source-bound clip or format ID",async()=>{
  useDownloads.setState({jobs:[{...job,options:{...defaultDownloadOptions(),startSeconds:5,endSeconds:10,formatId:"137",rateLimitKib:512,retries:4,fragments:3}}]}); await render();
  await act(async()=>button("Save these defaults").click());
  expect(m.savePreferences).toHaveBeenCalledWith(downloadDefaults("video-1080",{...defaultDownloadOptions(),rateLimitKib:512,retries:4,fragments:3}));
  expect(m.start).not.toHaveBeenCalled(); expect(host.textContent).toContain("exact format were not saved");
});
it("settings exposes real saved defaults without reading credentials or starting a job",async()=>{
  await render(); await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Download settings"]')!.click());
  expect(host.textContent).toContain("3 saved format/range variants"); expect(host.textContent).toContain("native Save dialog");
  await act(async()=>button("Save defaults").click());
  expect(m.savePreferences).toHaveBeenCalledWith(downloadDefaults("video-1080",defaultDownloadOptions())); expect(m.inspect).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it("damaged defaults show a retry instead of overwriting or sending new defaults",async()=>{
  useDownloads.setState({preferencesError:"Unknown download defaults version",preferences:null}); await render();
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Download settings"]')!.click());
  expect(button("Save defaults")).toBeUndefined(); expect(host.textContent).toContain("Unknown download defaults version"); expect(m.savePreferences).not.toHaveBeenCalled();
});
it("forget source archive requires confirmation and does not outlive source selection",async()=>{
  let finish!:(ok:boolean)=>void; confirm.mockImplementation(()=>new Promise<boolean>((r)=>{finish=r;}));
  useDownloads.setState({jobs:[job]}); await render(); await act(async()=>button("Forget source archive").click());
  await act(async()=>root.render(null)); await act(async()=>finish(true)); expect(m.forget).not.toHaveBeenCalled();
});
it("cookie selection does not access a browser and binds only the explicitly submitted inspection",async()=>{
  await render(); const select=host.querySelector<HTMLSelectElement>('.dl-inspection-cookies select')!;
  await act(async()=>{select.value="chrome";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await input("Profile 2",host.querySelector<HTMLInputElement>('.dl-inspection-cookies input')!);
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  await input("https://example.com/private-source"); await act(async()=>button("Inspect link").click());
  expect(m.inspect).toHaveBeenCalledWith("https://example.com/private-source",{browser:"chrome",profile:"Profile 2"});
  expect(select.value).toBe("");
});
it("download cookie choice is separate from inspection and never enters defaults",async()=>{
  useDownloads.setState({jobs:[job]}); await render(); const select=host.querySelector<HTMLSelectElement>('.dl-inspector .dl-cookies select')!;
  await act(async()=>{select.value="firefox";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(m.start).not.toHaveBeenCalled(); await act(async()=>button("Save these defaults").click());
  expect(JSON.stringify(m.savePreferences.mock.calls[0])).not.toContain("browser");
  await act(async()=>button("Download").click());
  expect(m.start).toHaveBeenCalledWith("fixture","video-1080",expect.objectContaining({playable:true}),{browser:"firefox",profile:null});
});
it("a failed anonymous inspection offers a source-bound cookie retry instead of forcing a new pasted URL",async()=>{
  useDownloads.setState({jobs:[{...job,state:"failed",metadata:null,error:"Sign-in required"}]}); await render();
  const select=host.querySelector<HTMLSelectElement>('.dl-inspector .dl-cookies select')!;
  await act(async()=>{select.value="chrome";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(m.inspect).not.toHaveBeenCalled(); await act(async()=>button("Retry inspection").click());
  expect(m.inspect).toHaveBeenCalledWith(job.url,{browser:"chrome",profile:null}); expect(m.start).not.toHaveBeenCalled();
});
it("parses clip times strictly without interpreting arbitrary expressions",()=>{
  expect(parseClipTime("1:02.5")).toBe(62.5); expect(parseClipTime("" )).toBeNull(); expect(timeLabel(3601)).toBe("1:00:01");
  for(const value of ["1:99","-1","NaN","--exec","1+2"]) expect(()=>parseClipTime(value)).toThrow();
});
