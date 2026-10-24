import {beforeEach,it,expect,vi} from "vitest";
import {scheduleImageCompaction} from "./projectStorage";
const api=vi.hoisted(()=>({invoke:vi.fn(),desktop:true}));vi.mock("@tauri-apps/api/core",()=>({invoke:api.invoke,isTauri:()=>api.desktop}));
beforeEach(()=>{api.desktop=true;api.invoke.mockReset();});
it("schedules and cancels native compaction with explicit boolean requests",async()=>{api.invoke.mockResolvedValueOnce(true);expect(await scheduleImageCompaction(true)).toBe(true);expect(api.invoke).toHaveBeenCalledWith("xdesign_storage_schedule_compaction",{enabled:true});api.invoke.mockResolvedValueOnce(false);expect(await scheduleImageCompaction(false)).toBe(false);expect(api.invoke).toHaveBeenLastCalledWith("xdesign_storage_schedule_compaction",{enabled:false});});
it("does not pretend to schedule maintenance outside the desktop host",async()=>{api.desktop=false;await expect(scheduleImageCompaction(true)).rejects.toThrow("desktop app");expect(api.invoke).not.toHaveBeenCalled();});
