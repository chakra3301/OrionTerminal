import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),open:vi.fn(),save:vi.fn(),flush:vi.fn(),snapshot:vi.fn(),validate:vi.fn(),importProject:vi.fn(),state:{activeId:"project-a" as string|null,registry:[{id:"project-a",name:"Design",kind:"design"}],transitioning:false},busy:false}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/plugin-dialog",()=>({open:mocks.open,save:mocks.save}));
vi.mock("./projectsStore",()=>({flushActive:mocks.flush,snapshotActiveDoc:mocks.snapshot,validateDesignDoc:mocks.validate,useXDProjects:{getState:()=>({...mocks.state,importDesignProject:mocks.importProject})}}));
vi.mock("./pencil/runtime",()=>({withPencilTask:(work:()=>Promise<void>)=>work()}));
vi.mock("./photo/runtime",()=>({usePhotoWorkspace:{getState:()=>({busy:mocks.busy})}}));
import { openProjectFile, saveProjectFile } from "./projectFiles";
beforeEach(()=>{vi.clearAllMocks();mocks.state.activeId="project-a";mocks.state.transitioning=false;mocks.busy=false;mocks.flush.mockResolvedValue(undefined);mocks.invoke.mockResolvedValue(undefined);mocks.save.mockResolvedValue("/backup/design.xdesign");mocks.snapshot.mockReturnValue({pages:[],activePageId:"page"});});
it("exports a freshly flushed project snapshot with native assets",async()=>{
  await saveProjectFile();
  expect(mocks.invoke).toHaveBeenCalledWith("xdesign_project_export",{projectId:"project-a",path:"/backup/design.xdesign",name:"Design",document:{pages:[],activePageId:"page"}});
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.snapshot.mock.invocationCallOrder[0]!);
});
it("does not export after cancellation, a save failure, or a changed project",async()=>{
  mocks.save.mockResolvedValueOnce(null);await saveProjectFile();expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.flush.mockRejectedValueOnce(new Error("Disk full"));await expect(saveProjectFile()).rejects.toThrow("Disk full");expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.save.mockImplementationOnce(async()=>{mocks.state.activeId="project-b";return "/backup/design.xdesign";});
  await expect(saveProjectFile()).rejects.toThrow("project changed");expect(mocks.invoke).not.toHaveBeenCalled();
});
it("imports and validates assets under the fresh identity supplied by the project transaction",async()=>{
  const imported={name:"Portable",document:{pages:[],activePageId:"page"}};
  mocks.invoke.mockResolvedValue(imported);
  mocks.importProject.mockImplementation(async read=>{expect(await read("fresh-project", { run: (copy: (id: string) => unknown) => copy('operation-id') })).toEqual(imported);});
  await openProjectFile("/portable.xdesign");
  expect(mocks.invoke).toHaveBeenCalledWith("xdesign_project_import",{projectId:"fresh-project",path:"/portable.xdesign",operationId:'operation-id'});
  expect(mocks.validate).toHaveBeenCalledWith(imported.document);
  expect(mocks.open).not.toHaveBeenCalled();
});
