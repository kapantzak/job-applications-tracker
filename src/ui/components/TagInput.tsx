import { useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function TagInput({ label, value, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim();
    setDraft('');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter must not submit the surrounding form.
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className="tag-input">
      <label>
        {label}
        <input
          aria-label={label}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </label>
      <ul className="tags">
        {value.map((tag) => (
          <li key={tag} className="tag">
            {tag}
            <button
              type="button"
              className="secondary"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              x
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
