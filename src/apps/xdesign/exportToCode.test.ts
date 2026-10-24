import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({save:vi.fn(),read:vi.fn(),exists:vi.fn(),stage:vi.fn(),jsx:vi.fn(),warning:vi.fn(),error:vi.fn()}));
vi.mock("@/apps/xdesign/store",()=>({useXDesign:{getState:()=>({pencilDocument:{formatVersion:1},selection:new Set(),shapes:[]})}}));
vi.mock("@/store/projectStore",()=>({useProjectStore:{getState:()=>({active:{root_path:"/fixture"}})}}));
vi.mock("@/store/pendingEditsStore",()=>({usePendingEdits:{getState:()=>({stage:mocks.stage})}}));
vi.mock("@/store/tabsStore",()=>({useTabsStore:{getState:()=>({markLoaded:vi.fn()})}}));
vi.mock("@/store/fileTreeRefreshStore",()=>({useFileTreeRefresh:{getState:()=>({bump:vi.fn()})}}));
vi.mock("@/components/workspace/workspaceStore",()=>({useWorkspace:{getState:()=>({openTab:vi.fn()})}}));
vi.mock("@/shell/store/useShell",()=>({useShell:{getState:()=>({openApp:vi.fn()})}}));
vi.mock("@/lib/ipc",()=>({ipc:{saveFileAtomic:mocks.save,readFile:mocks.read,pathExists:mocks.exists}}));
vi.mock("@/store/toastStore",()=>({toast:{warning:mocks.warning,error:mocks.error,success:vi.fn()}}));
vi.mock("@/plugins/appRegistry",()=>({appRegistry:{has:()=>true}}));
vi.mock("./pencil/runtime",()=>({usePencilWorkspace:{getState:()=>({editor:{getSelectedNodes:()=>[{id:"core-selected",type:"FRAME",name:"Checkout panel"}]}})},exportPencil:mocks.jsx}));
import { exportSelectionToCode } from "./exportToCode";
const delivered='"use client";\nimport { useState } from "react";\nexport default function CheckoutPanel() { const [checked, setChecked] = useState(false); return <button aria-pressed={checked} onClick={() => setChecked(!checked)}>Checkout</button>; }\n';

beforeEach(()=>{vi.clearAllMocks();mocks.exists.mockResolvedValue(true);mocks.read.mockResolvedValue("original component");mocks.save.mockResolvedValue(undefined);mocks.jsx.mockResolvedValue(new TextEncoder().encode(delivered));});
describe("advanced design export to Orion",()=>{
  it("uses the native canvas selection and stages an existing file with its original contents",async()=>{
    await exportSelectionToCode();expect(mocks.jsx).toHaveBeenCalledWith("REACT",1,["core-selected"]);expect(mocks.warning).not.toHaveBeenCalled();expect(mocks.stage).toHaveBeenCalledWith(expect.objectContaining({path:"/fixture/src/components/CheckoutPanel.tsx",original:"original component",isNew:false,updated:delivered}));expect(mocks.save).toHaveBeenCalledWith("/fixture/src/components/CheckoutPanel.tsx",delivered);
  });
  it("does not overwrite a file when its original contents cannot be read",async()=>{
    mocks.read.mockRejectedValue(new Error("Read failed"));await exportSelectionToCode();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.stage).not.toHaveBeenCalled();expect(mocks.error).toHaveBeenCalled();
  });
});
