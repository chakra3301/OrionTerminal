import { useState } from 'react';
import { FILTERS, type PhotoAction } from './controls';

export function FilterBrowser({ disabled, select }: { disabled: boolean; select: (action: PhotoAction) => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const actions = FILTERS.filter(action => `${action.label} ${action.category ?? ''}`.toLocaleLowerCase().includes(query));
  const categories = [...new Set(actions.map(action => action.category ?? 'Other'))];
  return <div className="xd-photo-paint-options">
    <input aria-label="Search filters" type="search" placeholder="Search filters…" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled}/>
    {!actions.length && <p role="status">No filters match this search.</p>}
    {categories.map(category => <details key={`${category}/${!!query}`} open={!!query || category === 'Blur'}>
      <summary>{category}</summary>
      <div className="xd-photo-action-list">{actions.filter(action => (action.category ?? 'Other') === category).map(action => <button type="button" key={action.id} disabled={disabled} onClick={() => select(action)}>{action.label}</button>)}</div>
    </details>)}
  </div>;
}
