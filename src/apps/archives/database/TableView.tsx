import { useMemo } from "react";
import { Plus, Type, Hash, ChevronDown, CheckSquare, Calendar, Tag, Link2, ListChecks } from "lucide-react";
import { useDatabase } from "@/store/databaseStore";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { PropertyCell } from "./PropertyCell";
import {
  PROPERTY_TYPE_LABELS,
  type Property,
  type PropertyType,
} from "@/features/database/propertyTypes";

const TYPE_ICON: Record<PropertyType, typeof Type> = {
  text: Type,
  number: Hash,
  select: ChevronDown,
  multi_select: Tag,
  status: ListChecks,
  date: Calendar,
  checkbox: CheckSquare,
  url: Link2,
};

const ADDABLE: PropertyType[] = [
  "text", "number", "select", "multi_select", "status", "date", "checkbox", "url",
];

/** Table view of a collection-database — rows are the notes filed in the
 * collection, columns are the title + each typed property. */
export function TableView({ rows }: { rows: Note[] }) {
  const properties = useDatabase((s) => s.properties);
  const addProperty = useDatabase((s) => s.addProperty);
  const renameProperty = useDatabase((s) => s.renameProperty);
  const setPropertyType = useDatabase((s) => s.setPropertyType);
  const removeProperty = useDatabase((s) => s.removeProperty);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const setView = useArchives((s) => s.setView);
  const { openFromButton, menu } = useContextMenu();

  const sorted = useMemo(
    () => properties.slice().sort((a, b) => a.position - b.position),
    [properties],
  );

  const openColumnMenu = (el: HTMLElement, prop: Property) => {
    const items: MenuItem[] = [
      {
        label: "Rename…",
        onClick: () => {
          const name = window.prompt("Property name", prop.name);
          if (name?.trim()) void renameProperty(prop.id, name.trim());
        },
      },
      { type: "separator" },
      ...ADDABLE.map((t) => ({
        label: PROPERTY_TYPE_LABELS[t],
        checked: prop.type === t,
        onClick: () => void setPropertyType(prop.id, t),
      })),
      { type: "separator" },
      { label: "Delete property", danger: true, onClick: () => void removeProperty(prop.id) },
    ];
    openFromButton(el, items);
  };

  const openAddMenu = (el: HTMLElement) => {
    const items: MenuItem[] = ADDABLE.map((t) => {
      const Icon = TYPE_ICON[t];
      return {
        label: PROPERTY_TYPE_LABELS[t],
        icon: <Icon size={13} />,
        onClick: () => void addProperty(PROPERTY_TYPE_LABELS[t], t),
      };
    });
    openFromButton(el, items);
  };

  const openRow = (id: string) => {
    setOpenNoteId(id);
    setView("notes");
  };

  return (
    <div className="ar-db-table-wrap scroll">
      <table className="ar-db-table">
        <thead>
          <tr>
            <th className="ar-db-th title-col">Name</th>
            {sorted.map((prop) => {
              const Icon = TYPE_ICON[prop.type];
              return (
                <th key={prop.id} className="ar-db-th">
                  <button
                    type="button"
                    className="ar-db-th-btn"
                    onClick={(e) => openColumnMenu(e.currentTarget, prop)}
                  >
                    <Icon size={11} />
                    <span>{prop.name}</span>
                  </button>
                </th>
              );
            })}
            <th className="ar-db-th add-col">
              <button
                type="button"
                className="ar-db-addprop"
                title="Add property"
                onClick={(e) => openAddMenu(e.currentTarget)}
              >
                <Plus size={13} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((note) => (
            <tr key={note.id} className="ar-db-row">
              <td className="ar-db-td title-col">
                <button type="button" className="ar-db-title-btn" onClick={() => openRow(note.id)}>
                  {note.title || "Untitled"}
                </button>
              </td>
              {sorted.map((prop) => (
                <td key={prop.id} className="ar-db-td">
                  <PropertyCell noteId={note.id} prop={prop} />
                </td>
              ))}
              <td className="ar-db-td add-col" />
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="ar-db-empty-row" colSpan={sorted.length + 2}>
                No notes in this collection yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {menu}
    </div>
  );
}

/** New-row button shared by the database container (creates a note filed in
 * the collection). */
export function NewRowButton({ collectionId }: { collectionId: string }) {
  const create = useNotesStore((s) => s.create);
  const saveCollection = useNotesStore((s) => s.saveCollection);
  const setOpenNoteId = useArchives((s) => s.setOpenNoteId);
  const setView = useArchives((s) => s.setView);

  const onNew = async () => {
    const note = await create(null, "note");
    await saveCollection(note.id, collectionId);
    setOpenNoteId(note.id);
    setView("notes");
  };

  return (
    <button type="button" className="ar-db-newrow" onClick={() => void onNew()}>
      <Plus size={13} /> New
    </button>
  );
}
