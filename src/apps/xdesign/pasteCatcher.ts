// WebKit only hands clipboard contents to a paste event aimed at an editable
// target, so ⌘V on a canvas briefly focuses an offscreen field and lets the
// app menu's Paste land there. Call this from the ⌘V keydown without
// preventDefault; `missing` runs if no paste event arrives.
export function catchPaste(host:HTMLElement,paste:(data:DataTransfer|null)=>void,missing:()=>void,wait=500):void {
  const previous=document.activeElement as HTMLElement|null,field=document.createElement("textarea");
  field.setAttribute("aria-hidden","true");field.tabIndex=-1;field.className="xd-paste-catcher";
  host.append(field);
  let done=false;
  const finish=()=>{done=true;clearTimeout(timer);field.remove();previous?.focus?.({preventScroll:true});};
  const timer=setTimeout(()=>{if(!done){finish();missing();}},wait);
  field.addEventListener("paste",event=>{event.preventDefault();event.stopPropagation();if(done)return;finish();paste(event.clipboardData);});
  field.focus({preventScroll:true});
}

export function clipboardImage(data:DataTransfer|null):File|undefined {
  return Array.from(data?.files??[]).find(file=>file.type.startsWith("image/"));
}
