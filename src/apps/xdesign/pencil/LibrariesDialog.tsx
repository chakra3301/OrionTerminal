import { AssetsPanel } from "./AssetsPanel";
import { usePencilWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import type { CanvasRoomSession, RoomUiState } from "./roomSession";

export function LibrariesDialog({ room, roomState, close }: { room: CanvasRoomSession | null; roomState: RoomUiState | null; close: () => void }) {
  const busy = usePencilWorkspace(s => s.busy), dialog = useDesignDialog<HTMLDivElement>(close, busy);
  // A div rather than a form: AssetsPanel's own dialogs contain forms, and submit events bubble through React portals.
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Libraries"><div className="xd-pencil-libraries">
    <header><strong>Libraries</strong><button type="button" onClick={close}>Close</button></header>
    <AssetsPanel room={room} roomState={roomState}/>
  </div></div>;
}
