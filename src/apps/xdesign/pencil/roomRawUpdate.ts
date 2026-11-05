import { ownsCommentAuthor, type CommentAuthorGrants } from './roomCommentOwnership';
import * as Y from 'yjs';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { COMMENT_PLUGIN, COMMENT_KEY, COMMENT_REACTIONS, allComments, validCommentAuthor, validCommentAnchor, type CommentAuthor } from './comments';
import { decodeSharedValue } from './sharedValue';
import { RoomCommentPermissionError } from './roomCommentPolicy';
import type { RoomActor } from './sharedRoomProtocol';
import { readRoomImagePluginData, roomImageReferenceText, type RoomImageReference } from './roomImageReferences';

type Decoded = ReturnType<typeof Y.decodeUpdate>;
type Struct = Decoded['structs'][number];
type Slot = { item: Struct; offset: number; value: unknown; id: Y.ID };
type Location = { path: string[]; parent: string };
const MAX_OPERATIONS = 1_000_000;
const nodeTypes = new Set(['CANVAS','FRAME','RECTANGLE','ROUNDED_RECTANGLE','ELLIPSE','TEXT','LINE','STAR','POLYGON','VECTOR','BOOLEAN_OPERATION','GROUP','SECTION','COMPONENT','COMPONENT_SET','INSTANCE','CONNECTOR','SHAPE_WITH_TEXT']);
const idKey = (id: Y.ID) => JSON.stringify([id.client,id.clock]);
const sameId = (a: Y.ID | null, b: Y.ID | null) => a?.client === b?.client && a?.clock === b?.clock;
const sameValue = (a: unknown,b: unknown) => a instanceof Uint8Array && b instanceof Uint8Array ? a.length === b.length && a.every((v,i)=>v===b[i]) : JSON.stringify(a) === JSON.stringify(b);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_./-]{1,128}$/.test(value);
const string = (value: unknown,max=128): value is string => typeof value === 'string' && value.length>0 && value.length<=max && !value.includes('\0');
const time = (value: unknown) => Number.isSafeInteger(value) && (value as number)>=0 && (value as number)<=8_640_000_000_000_000;
const plain = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string,unknown>,allowed:string[]) => Object.keys(value).every(key=>allowed.includes(key));
const invalid = () => new Error('The raw shared update contains an unsupported or inconsistent operation.');
export class RoomRawUpdateError extends Error {
  readonly status = 409;
  readonly code = 'dependencies';
  constructor() { super('Resynchronize the complete shared checkpoint before sending operations with unresolved dependencies.'); this.name='RoomRawUpdateError'; }
}
function permit(allowed: boolean,message: string): asserts allowed { if (!allowed) throw new RoomCommentPermissionError(message); }
function slots(decoded: Decoded): Slot[] {
  let count=0; const result:Slot[]=[];
  for (const item of decoded.structs) {
    if (!Number.isSafeInteger(item.id.client) || item.id.client<0 || !Number.isSafeInteger(item.id.clock) || item.id.clock<0 || !Number.isSafeInteger(item.length) || item.length<1 || !Number.isSafeInteger(item.id.clock+item.length)) throw invalid();
    if (item instanceof Y.Skip) continue;
    count+=item.length; if (count>MAX_OPERATIONS) throw invalid();
    const values=item instanceof Y.Item ? item.content.getContent() : [];
    if (item instanceof Y.Item && !(item.content instanceof Y.ContentDeleted) && values.length!==item.length) throw invalid();
    for (let offset=0;offset<item.length;offset++) result.push({item,offset,value:values[offset],id:Y.createID(item.id.client,item.id.clock+offset)});
  }
  return result;
}
class Index {
  private readonly clients=new Map<number,Struct[]>();
  private readonly contents=new WeakMap<Y.Item,unknown[]>();
  constructor(decoded:Decoded) {
    for (const item of decoded.structs) { if (item instanceof Y.Skip) continue; const values=this.clients.get(item.id.client)??[]; values.push(item); this.clients.set(item.id.client,values); if(item instanceof Y.Item)this.contents.set(item,item.content.getContent()); }
    for (const values of this.clients.values()) { values.sort((a,b)=>a.id.clock-b.id.clock); for (let i=1;i<values.length;i++) if (values[i-1]!.id.clock+values[i-1]!.length>values[i]!.id.clock) throw invalid(); }
  }
  find(id:Y.ID): Slot | undefined {
    const values=this.clients.get(id.client); if (!values) return; let low=0,high=values.length-1;
    while (low<=high) { const mid=(low+high)>>>1,item=values[mid]!; if (id.clock<item.id.clock) high=mid-1; else if (id.clock>=item.id.clock+item.length) low=mid+1; else { const offset=id.clock-item.id.clock;return {item,offset,id,value:item instanceof Y.Item?this.contents.get(item)?.[offset]:undefined}; } }
  }
}
class Paths {
  private readonly cache=new WeakMap<Y.Item,Location>();
  constructor(private readonly before:Index,private readonly incoming:Index) {}
  find(id:Y.ID):Slot { const item=this.before.find(id)??this.incoming.find(id);if (!item) throw new RoomRawUpdateError();return item; }
  locate(item:Struct,seen=new Set<Y.Item>()):Location {
    if (!(item instanceof Y.Item)) throw invalid(); const cached=this.cache.get(item);if (cached)return cached;
    if (seen.has(item)||seen.size>=128)throw invalid();seen.add(item);
    try {
      let result:Location;const parent=item.parent as unknown;
      if (parent===null) {
        const anchors=[item.origin,item.rightOrigin].filter((id):id is Y.ID=>!!id).map(id=>this.locate(this.find(id).item,seen));
        if (!anchors.length || anchors.some(anchor=>anchor.parent!==anchors[0]!.parent || !sameValue(anchor.path,anchors[0]!.path)))throw invalid();result=anchors[0]!;
      } else {
        if (typeof item.parentSub!=='string'||!item.parentSub.length||item.parentSub.length>2048)throw invalid();
        if (typeof parent==='string') result={path:[parent,item.parentSub],parent:`root:${parent}`};
        else if (parent instanceof Y.ID) {
          const owner=this.find(parent);if (!(owner.item instanceof Y.Item)||owner.offset!==0||!(owner.item.content instanceof Y.ContentType)||!(owner.item.content.type instanceof Y.Map))throw invalid();
          const location=this.locate(owner.item,seen);result={path:[...location.path,item.parentSub],parent:idKey(parent)};
        } else throw invalid();
      }
      this.cache.set(item,result);return result;
    } finally {seen.delete(item);}
  }
}
const origin = (slot:Slot):Y.ID|null => slot.offset ? Y.createID(slot.id.client,slot.id.clock-1) : slot.item instanceof Y.Item ? slot.item.origin : null;
function sameSlot(a:Slot,b:Slot):boolean {
  if (a.item.constructor!==b.item.constructor)return false;
  if (!(a.item instanceof Y.Item)||!(b.item instanceof Y.Item))return a.item instanceof Y.GC&&b.item instanceof Y.GC;
  if (a.item.content.constructor!==b.item.content.constructor||!sameId(origin(a),origin(b))||!sameId(a.item.rightOrigin,b.item.rightOrigin))return false;
  if (!origin(a)&&!a.item.rightOrigin && (!sameValue(a.item.parent,b.item.parent)||a.item.parentSub!==b.item.parentSub))return false;
  return a.item.content instanceof Y.ContentType ? a.item.content.type instanceof Y.Map && b.item.content instanceof Y.ContentType && b.item.content.type instanceof Y.Map : sameValue(a.value,b.value);
}
type Fact = { roots:unknown[]; messages:Map<string,{authors:unknown[];times:unknown[]}> };
class Facts {
  readonly authorsChecked=new Map<string,CommentAuthor>();
  readonly rootsChecked=new Map<string,string>();
  readonly timesChecked=new Set<string>();
  private readonly threads=new Map<string,Fact>();
  private readonly children=new Map<string,Set<string>>();
  private readonly canvases=new Set<string>();
  constructor(values:Slot[],paths:Paths) {
    for (const slot of values) {
      if (!(slot.item instanceof Y.Item))continue;let location:Location;try{location=paths.locate(slot.item);}catch{continue;}
      const {path,parent}=location,child=this.children.get(parent)??new Set<string>();child.add(path.at(-1)!);this.children.set(parent,child);
      if(path.length===3&&path[0]==='nodes'&&path[2]==='type') {try{if(decodeSharedValue(slot.value)==='CANVAS')this.canvases.add(path[1]!);}catch{/* Historic opaque artwork remains preserved. */}}
      if (path[0]!=='comments'||path.length<3)continue;
      const thread:Fact=this.threads.get(path[1]!)??{roots:[],messages:new Map()};this.threads.set(path[1]!,thread);
      let value:unknown;try{value=decodeSharedValue(slot.value);}catch{value=undefined;}
      if (path.length===3&&path[2]==='root')thread.roots.push(value);
      if (path.length===5&&path[2]==='messages') { const message=thread.messages.get(path[3]!)??{authors:[],times:[]};thread.messages.set(path[3]!,message);if(path[4]==='author')message.authors.push(value);if(path[4]==='createdAt')message.times.push(value); }
    }
  }
  root(id:string):unknown[] {return this.threads.get(id)?.roots??[];}
  authors(thread:string,message:string):unknown[] {return this.threads.get(thread)?.messages.get(message)?.authors??[];}
  times(thread:string,message:string):unknown[] {return this.threads.get(thread)?.messages.get(message)?.times??[];}
  fields(id:Y.ID):Set<string> {return this.children.get(idKey(id))??new Set();}
  wasCanvas(id:string):boolean {return this.canvases.has(id);}
}
function unique(values:unknown[]):unknown { if (!values.length || values.some(value=>!sameValue(value,values[0])))throw invalid();return values[0]; }
function author(before:Facts,incoming:Facts,thread:string,message:string,actor:RoomActor):CommentAuthor {
  const key=JSON.stringify([thread,message]),cached=incoming.authorsChecked.get(key);if(cached)return cached;
  const old=before.authors(thread,message),fresh=incoming.authors(thread,message),value=unique(old.length?old:fresh);
  if (!validCommentAuthor(value))throw invalid();
  if (fresh.length) permit(fresh.every(next=>sameValue(next,value)) && (old.length>0 || value.id===actor.id&&value.name===actor.name),'New comment authors must identify the current room member, and existing authors cannot change.');
  incoming.authorsChecked.set(key,value);return value;
}
function root(before:Facts,incoming:Facts,thread:string):string {const cached=incoming.rootsChecked.get(thread);if(cached)return cached;const old=before.root(thread),fresh=incoming.root(thread),value=unique(old.length?old:fresh);if(!identifier(value))throw invalid();permit(fresh.every(next=>next===value),'The original comment root cannot change, including hidden records.');incoming.rootsChecked.set(thread,value);return value;}
function owner(before:Facts,incoming:Facts,thread:string,actor:RoomActor):CommentAuthor {return author(before,incoming,thread,root(before,incoming,thread),actor);}
function validateNew(slot:Slot,location:Location,before:Facts,incoming:Facts,actor:RoomActor,beforeGraph:SceneGraph,grants?:CommentAuthorGrants,images?:(reference:RoomImageReference)=>void):void {
  const item=slot.item;if (!(item instanceof Y.Item)||item.content instanceof Y.ContentDeleted)throw invalid();const path=location.path,[scope,key,field]=path;
  const map=item.content instanceof Y.ContentType&&item.content.type instanceof Y.Map;
  if (item.content instanceof Y.ContentType&&!map)throw invalid();
  if (scope==='comments') {
    if (!identifier(key))throw invalid();
    const ownThread=()=>ownsCommentAuthor(owner(before,incoming,key,actor).id,actor,grants);
    const ownMessage=(id:string)=>ownsCommentAuthor(author(before,incoming,key,id,actor).id,actor,grants);
    if (path.length===2||path.length===3&&field==='messages'||path.length===4&&field==='messages'||path.length===5&&field==='messages'&&path[4]==='reactions') {
      if (!map||slot.offset!==0)throw invalid();
      permit(path.length<=3?ownThread():ownMessage(path[3]!), 'Only the original author can replace a comment or message record.');
      if (path.length===2||path.length===4) {const required=path.length===2?['id','page','anchor','root','resolution','messages']:['id','author','body','createdAt','reactions'];if(required.some(key=>!incoming.fields(slot.id).has(key)))throw invalid();}
      return;
    }
    if (map||!(item.content instanceof Y.ContentAny))throw invalid();
    if (path.length===6&&field==='messages'&&path[4]==='reactions') {
      const pair:unknown=JSON.parse(path[5]!);if (!Array.isArray(pair)||pair.length!==2||!COMMENT_REACTIONS.includes(pair[0])||!identifier(pair[1])||slot.value!==true)throw invalid();permit(pair[1]===actor.id,'Only your own reaction membership can be written.');return;
    }
    const value=decodeSharedValue(slot.value);
    if (path.length===3) {
      if (!['id','page','anchor','root','resolution'].includes(field!))throw invalid();
      if (field==='id'||field==='root') {if(value!==(field==='id'?key:root(before,incoming,key)))throw invalid();permit(ownThread(),'Only the original author can write comment identity fields.');}
      else if (field==='page'||field==='anchor') {if (field==='page'?!identifier(value):!validCommentAnchor(value))throw invalid();permit(ownThread(),'Only the original author can move a comment pin.');}
      else {
        if (!plain(value)||!keys(value,['resolved','resolvedBy','resolvedAt'])||typeof value.resolved!=='boolean')throw invalid();
        permit(value.resolved?validCommentAuthor(value.resolvedBy)&&value.resolvedBy.id===actor.id&&value.resolvedBy.name===actor.name&&time(value.resolvedAt):value.resolvedBy===undefined&&value.resolvedAt===undefined,'Comment resolution must identify the current room member.');
      } return;
    }
    if (path.length!==5||field!=='messages'||!identifier(path[3])||!['id','author','body','createdAt','editedAt'].includes(path[4]!))throw invalid();
    const id=path[3]!,kind=path[4]!,original=author(before,incoming,key,id,actor);permit(ownsCommentAuthor(original.id,actor,grants),'Only the message author can write comment fields, including hidden values.');
    if (kind==='id'&&value!==id||kind==='author'&&!sameValue(value,original)||kind==='body'&&(typeof value!=='string'||!value.trim()||value.length>8192)||['createdAt','editedAt'].includes(kind)&&!time(value))throw invalid();
    if (kind==='createdAt') {
      const identity=JSON.stringify([key,id]);
      if(!incoming.timesChecked.has(identity)) {const old=before.times(key,id),fresh=incoming.times(key,id),original=unique(old.length?old:fresh);permit(fresh.every(value=>sameValue(value,original)),'A comment creation time cannot be rewritten.');incoming.timesChecked.add(identity);}
    }
    return;
  }
  if (scope==='nodes') {
    if (!string(key))throw invalid();if (path.length===2) {if (!map)throw invalid();return;}
    if (path.length===3&&field==='$parents') {if(!map)throw invalid();return;}
    if (map||!(item.content instanceof Y.ContentAny))throw invalid();
    if (path.length===4&&field==='$parents') {if(!string(path[3])||!Number.isSafeInteger(slot.value)||(slot.value as number)<0)throw invalid();return;}
    if (path.length!==3||!string(field)||['parentId','childIds','textPicture'].includes(field!))throw invalid();
    if (field==='$deleted') {if(typeof slot.value!=='boolean')throw invalid();return;}
    if (field==='$page'||field==='$order') {if(!string(slot.value,field==='$order'?4096:128)||field==='$order'&&!/^[!-~]+$/.test(slot.value))throw invalid();return;}
    if (field!.startsWith('$')||!(item.content instanceof Y.ContentAny))throw invalid();const value=decodeSharedValue(slot.value);
    if (field==='id'&&value!==key||['x','y','width','height','rotation'].includes(field!)&&(typeof value!=='number'||!Number.isFinite(value))||field==='internalOnly'&&typeof value!=='boolean')throw invalid();
    if(field==='type'&&!nodeTypes.has(String(value)))throw invalid();
    if (field==='type'&&(before.wasCanvas(key)||beforeGraph.getNode(key)?.type==='CANVAS'))permit(value==='CANVAS','A shared page cannot change its layer type.');
    if (field==='pluginData') {if (!Array.isArray(value))throw invalid();permit(!value.some(entry=>plain(entry)&&entry.pluginId===COMMENT_PLUGIN&&entry.key===COMMENT_KEY),'Raw artwork metadata cannot contain reserved comment storage.');const reference=readRoomImagePluginData(value);if(reference)images?.(reference);}
    return;
  }
  if (map||path.length!==2)throw invalid();
  if (scope==='meta') {if(['root','home','format'].includes(key!))throw invalid();if(!['figKiwiVersion','figSchemaDeflated','documentColorSpace'].includes(key!)||!(item.content instanceof Y.ContentAny))throw invalid();decodeSharedValue(slot.value);return;}
  if (scope==='images') {if(!(item.content instanceof Y.ContentBinary)||!(slot.value instanceof Uint8Array)||slot.value.length>16*1024*1024||!string(key,2048))throw invalid();return;}
  if (!['variables','variableCollections','activeMode','enabledLibraries'].includes(scope!)||!string(key,2048)||!(item.content instanceof Y.ContentAny))throw invalid();decodeSharedValue(slot.value);
}

export function assertRoomRawUpdate(checkpoint:Uint8Array,update:Uint8Array,actor:RoomActor,beforeGraph:SceneGraph,afterGraph:SceneGraph,afterCheckpoint:Uint8Array,grants?:CommentAuthorGrants,images?:(reference:RoomImageReference)=>void):ReadonlySet<string> {
  const before=Y.decodeUpdate(checkpoint),incoming=Y.decodeUpdate(update),after=Y.decodeUpdate(afterCheckpoint),oldIndex=new Index(before),newIndex=new Index(incoming),paths=new Paths(oldIndex,newIndex),oldSlots=slots(before),newSlots=slots(incoming),novel:Slot[]=[];
  const applied=Y.decodeStateVector(Y.encodeStateVectorFromUpdate(afterCheckpoint));
  for (const slot of newSlots) {
    const old=oldIndex.find(slot.id);
    if(old){if(!sameSlot(slot,old))throw invalid();}
    else {if(slot.id.clock>=(applied.get(slot.id.client)??0))throw new RoomRawUpdateError();novel.push(slot);}
  }
  const oldFacts=new Facts(oldSlots,paths),newFacts=new Facts(novel,paths);
  for (const slot of novel) validateNew(slot,paths.locate(slot.item),oldFacts,newFacts,actor,beforeGraph,grants,images);
  const oldThreads=new Map(allComments(beforeGraph).map(thread=>[thread.id,thread])),newThreads=new Map(allComments(afterGraph).map(thread=>[thread.id,thread]));
  const deleted=(id:Y.ID)=>Y.isDeleted(after.ds,id);
  const liveMaps=new Map<string,Slot[]>(),replacements=new Map<string,Slot[]>();
  const locationKey=(location:Location)=>JSON.stringify([location.parent,location.path]);
  for (const slot of oldSlots) if (slot.item instanceof Y.Item&&slot.item.content instanceof Y.ContentType&&!slot.offset&&!Y.isDeleted(before.ds,slot.id)) {
    const path=paths.locate(slot.item).path;if(path[0]!=='comments')continue;
    const key=JSON.stringify(path),values=liveMaps.get(key)??[];values.push(slot);liveMaps.set(key,values);
  }
  for (const slot of novel) {const key=locationKey(paths.locate(slot.item)),values=replacements.get(key)??[];values.push(slot);replacements.set(key,values);}
  const threadDeletions=new Map<string,boolean>(),messageDeletions=new Map<string,boolean>();
  function wholeThread(thread:string):boolean {
    const cached=threadDeletions.get(thread);if(cached!==undefined)return cached;
    const previous=oldThreads.get(thread),roots=liveMaps.get(JSON.stringify(['comments',thread]))??[];
    const allowed=!!previous&&!newThreads.has(thread)&&roots.some(slot=>deleted(slot.id))&&(ownsCommentAuthor(previous.messages[0]!.author.id,actor,grants)||!afterGraph.getNode(previous.ownerPageId));
    threadDeletions.set(thread,allowed);return allowed;
  }
  function wholeMessage(thread:string,message:string):boolean {
    if(wholeThread(thread))return true;
    const key=JSON.stringify([thread,message]),cached=messageDeletions.get(key);if(cached!==undefined)return cached;
    const previous=oldThreads.get(thread)?.messages.find(item=>item.id===message),maps=liveMaps.get(JSON.stringify(['comments',thread,'messages',message]))??[];
    const allowed=!!previous&&!newThreads.get(thread)?.messages.some(item=>item.id===message)&&ownsCommentAuthor(previous.author.id,actor,grants)&&maps.some(slot=>deleted(slot.id));
    messageDeletions.set(key,allowed);return allowed;
  }
  let deletions=0;
  for (const [client,ranges] of incoming.ds.clients) for (const range of ranges) {
    if(!Number.isSafeInteger(client)||client<0||!Number.isSafeInteger(range.clock)||range.clock<0||!Number.isSafeInteger(range.len)||range.len<1||!Number.isSafeInteger(range.clock+range.len))throw invalid();deletions+=range.len;if(deletions>MAX_OPERATIONS)throw invalid();
    for (let clock=range.clock;clock<range.clock+range.len;clock++) {
      const id=Y.createID(client,clock);if(!oldIndex.find(id)&&!newIndex.find(id))throw new RoomRawUpdateError();
    }
  }
  // Yjs may cascade a container deletion beyond the ranges supplied on the wire.
  for(const slot of oldSlots) {
      if(!deleted(slot.id)||Y.isDeleted(before.ds,slot.id))continue;
      const location=paths.locate(slot.item),path=location.path,[scope,thread,field]=path;
      const replacement=replacements.get(locationKey(location))??[];
      if(scope==='meta'&&['root','home','format'].includes(thread!))throw invalid();
      if(scope!=='comments')continue;
      if(wholeThread(thread!))continue;
      if(path.length>=4&&field==='messages'&&wholeMessage(thread!,path[3]!))continue;
      if(path.length===6&&field==='messages'&&path[4]==='reactions') {const pair:unknown=JSON.parse(path[5]!);permit(Array.isArray(pair)&&pair[1]===actor.id,'Only your own reaction membership can be removed.');continue;}
      if(path.length===5&&field==='messages') {const who=author(oldFacts,newFacts,thread!,path[3]!,actor);permit(ownsCommentAuthor(who.id,actor,grants),'Only the message author can delete comment fields.');if(['id','author','createdAt'].includes(path[4]!))permit(replacement.some(next=>sameValue(next.value,slot.value)),'Comment identity and creation time cannot be removed.');continue;}
      if(path.length===3&&field==='resolution')continue;
      permit(ownsCommentAuthor(owner(oldFacts,newFacts,thread!,actor).id,actor,grants),'Only the original author can delete comment fields.');
      if(path.length===3&&['id','root'].includes(field!))permit(replacement.some(next=>sameValue(next.value,slot.value)),'Comment identity cannot be removed.');
  }
  const restored = new Set<string>();
  for (const thread of newThreads.values()) for (const message of thread.messages) {
    const old = oldFacts.authors(thread.id, message.id);
    if (old.length && validCommentAuthor(old[0]) && ownsCommentAuthor(old[0].id, actor, grants) && old.every(value => sameValue(value, message.author))) restored.add(JSON.stringify([thread.id, message.id]));
  }
  return restored;
}

export function roomImageHistoryReferences(checkpoint:Uint8Array):RoomImageReference[] {
  const decoded=Y.decodeUpdate(checkpoint),index=new Index(decoded),paths=new Paths(index,index),refs=new Map<string,RoomImageReference>();
  for(const slot of slots(decoded)) {
    if(!(slot.item instanceof Y.Item)||slot.item.content instanceof Y.ContentDeleted)continue;
    const path=paths.locate(slot.item).path;
    if(path.length!==3||path[0]!=='nodes'||path[2]!=='pluginData')continue;
    const reference=readRoomImagePluginData(decodeSharedValue(slot.value));
    if(reference)refs.set(roomImageReferenceText(reference),reference);
    if(refs.size>500)throw new Error('Shared image history references exceed their limit.');
  }
  return [...refs.values()];
}
