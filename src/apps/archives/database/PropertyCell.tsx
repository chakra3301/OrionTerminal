import { useState } from "react";
import { useContextMenu, type MenuItem } from "@/components/ContextMenu";
import { useDatabase } from "@/store/databaseStore";
import {
  decodeMulti,
  encodeMulti,
  isChecked,
  type Property,
  type SelectOption,
} from "@/features/database/propertyTypes";

function OptionChip({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span
      className="ar-db-chip"
      style={{
        background: `${option.color}22`,
        borderColor: `${option.color}66`,
        color: option.color,
      }}
    >
      {option.name}
      {onRemove && (
        <button type="button" className="ar-db-chip-x" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/** One editable database cell, typed by its property. Compact, inline. */
export function PropertyCell({ noteId, prop }: { noteId: string; prop: Property }) {
  const raw = useDatabase((s) => s.values.get(noteId)?.get(prop.id) ?? "");
  const setValue = useDatabase((s) => s.setValue);
  const addOption = useDatabase((s) => s.addOption);
  const { openFromButton, menu } = useContextMenu();
  const [editing, setEditing] = useState(false);

  const set = (v: string) => void setValue(noteId, prop.id, v);

  if (prop.type === "checkbox") {
    return (
      <input
        type="checkbox"
        className="ar-db-check"
        checked={isChecked(raw)}
        onChange={(e) => set(e.target.checked ? "1" : "")}
      />
    );
  }

  if (prop.type === "select" || prop.type === "status") {
    const current = prop.options.find((o) => o.id === raw);
    const openMenu = (el: HTMLElement) => {
      const items: MenuItem[] = [
        ...prop.options.map((o) => ({
          label: o.name,
          onClick: () => set(o.id),
        })),
        ...(raw ? [{ label: "Clear", danger: true, onClick: () => set("") } as MenuItem] : []),
        { type: "separator" } as MenuItem,
        {
          label: "+ New option…",
          onClick: () => {
            const name = window.prompt("New option name");
            if (name?.trim()) void addOption(prop.id, name.trim()).then((o) => o && set(o.id));
          },
        },
      ];
      openFromButton(el, items);
    };
    return (
      <>
        <button type="button" className="ar-db-cell-btn" onClick={(e) => openMenu(e.currentTarget)}>
          {current ? <OptionChip option={current} /> : <span className="ar-db-empty">—</span>}
        </button>
        {menu}
      </>
    );
  }

  if (prop.type === "multi_select") {
    const ids = decodeMulti(raw);
    const chosen = ids
      .map((id) => prop.options.find((o) => o.id === id))
      .filter(Boolean) as SelectOption[];
    const openMenu = (el: HTMLElement) => {
      const items: MenuItem[] = [
        ...prop.options.map((o) => ({
          label: ids.includes(o.id) ? `✓ ${o.name}` : o.name,
          onClick: () =>
            set(encodeMulti(ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id])),
        })),
        { type: "separator" } as MenuItem,
        {
          label: "+ New option…",
          onClick: () => {
            const name = window.prompt("New option name");
            if (name?.trim())
              void addOption(prop.id, name.trim()).then((o) => o && set(encodeMulti([...ids, o.id])));
          },
        },
      ];
      openFromButton(el, items);
    };
    return (
      <>
        <button type="button" className="ar-db-cell-btn multi" onClick={(e) => openMenu(e.currentTarget)}>
          {chosen.length ? (
            chosen.map((o) => <OptionChip key={o.id} option={o} />)
          ) : (
            <span className="ar-db-empty">—</span>
          )}
        </button>
        {menu}
      </>
    );
  }

  if (prop.type === "date") {
    return (
      <input
        type="date"
        className="ar-db-input date"
        value={raw}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  // text / number / url
  if (editing) {
    return (
      <input
        autoFocus
        type={prop.type === "number" ? "number" : "text"}
        className="ar-db-input"
        defaultValue={raw}
        onBlur={(e) => {
          set(e.target.value.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button type="button" className="ar-db-cell-btn text" onClick={() => setEditing(true)}>
      {raw ? (
        prop.type === "url" ? (
          <span className="ar-db-url">{raw}</span>
        ) : (
          raw
        )
      ) : (
        <span className="ar-db-empty">—</span>
      )}
    </button>
  );
}
