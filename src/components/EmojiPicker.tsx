import { useState, useEffect, useMemo } from 'react';

const QUICK = ['😀', '😂', '❤️', '👍', '🙏', '🎉', '🔥', '😢', '😡', '🤔', '👀', '💡'];

/** Собираем эмодзи из системного шрифта — без внешних загрузок */
function buildEmojiList(): string[] {
  const list: string[] = [];
  const ranges: [number, number][] = [
    [0x1f300, 0x1f5ff],
    [0x1f600, 0x1f64f],
    [0x1f900, 0x1f9ff],
  ];
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp++) {
      try {
        list.push(String.fromCodePoint(cp));
      } catch {
        /* невалидные точки пропускаем */
      }
    }
  }
  return list;
}

export function EmojiPicker({ onPick, open }: { onPick(e: string): void; open: boolean }) {
  const [emojis, setEmojis] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open && !emojis.length) {
      const id = setTimeout(() => setEmojis(buildEmojiList()), 0);
      return () => clearTimeout(id);
    }
  }, [open, emojis.length]);

  const filtered = useMemo(() => {
    if (!query.trim()) return emojis.slice(0, 240);
    const q = query.trim().toLowerCase();
    return emojis.filter((e) => e.codePointAt(0)?.toString(16).includes(q)).slice(0, 240);
  }, [query, emojis]);

  if (!open) return null;
  return (
    <div className="card absolute bottom-full left-0 z-30 mb-2 w-[min(320px,90vw)] p-3 animate-slide-up" role="dialog" aria-label="Выбор эмодзи">
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
        {QUICK.map((e) => (
          <button key={e} className="rounded-lg p-1.5 text-xl hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onPick(e)} aria-label={`Вставить эмодзи ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <input className="input mb-2 !min-h-[36px] !py-1.5 text-xs" placeholder="Поиск по коду (например 1f60)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск эмодзи" />
      <div className="scroll-thin grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
        {filtered.map((e) => (
          <button key={e} className="rounded-lg p-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onPick(e)} aria-label={'Эмодзи U+' + (e.codePointAt(0)?.toString(16).toUpperCase() ?? '')}>
            {e}
          </button>
        ))}
        {!filtered.length && <p className="col-span-8 py-4 text-center text-xs text-slate-400">Ничего не найдено</p>}
      </div>
    </div>
  );
}
