import { Sparkles } from 'lucide-react';
import { CHANGELOG } from '../changelog';

// 'YYYY-MM-DD' -> 'dd/mm/yyyy'. Reformatted from the parts rather than via
// toLocaleDateString, which would give US order for en-US visitors.
const formatDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const groupByDate = (entries) =>
  entries.reduce((groups, entry) => {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else groups.push({ date: entry.date, entries: [entry] });
    return groups;
  }, []);

const Changelog = () => {
  if (!CHANGELOG.length) return null;

  return (
    <aside className="bg-surface-card rounded-md shadow-sm border border-surface-border p-5 w-full lg:w-72 lg:shrink-0">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-5">
        <Sparkles className="w-4 h-4 text-accent" />
        What&apos;s new
      </h2>

      <div className="space-y-5 max-h-[26rem] overflow-y-auto pr-1">
        {groupByDate(CHANGELOG).map((group) => (
          <div key={group.date}>
            <p className="text-xs text-gray-400 mb-2">{formatDate(group.date)}</p>
            <ul className="space-y-2.5">
              {group.entries.map((entry, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-gray-600 leading-snug">
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      entry.type === 'fix' ? 'bg-success' : 'bg-accent'
                    }`}
                  />
                  {entry.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default Changelog;
