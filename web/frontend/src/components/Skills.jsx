import React from 'react';

export const SKILLS = [
  {
    key: 'keyholder',
    label: 'Keyholder',
    color: '#f59e0b',
    bg: '#fef3c7',
    icon: '🔑',
    type: 'emoji',
  },
  {
    key: 'till_trained',
    label: 'Till Trained',
    color: '#16a34a',
    bg: '#dcfce7',
    icon: '🛒',
    type: 'emoji',
  },
  {
    key: 'cash_office',
    label: 'Cash Office',
    color: '#15803d',
    bg: '#bbf7d0',
    icon: '💷',
    type: 'emoji',
  },
  {
    key: 'till_supervisor',
    label: 'Till Supervisor',
    color: '#ffffff',
    bg: '#2563eb',
    text: 'TS',
    type: 'text',
  },
  {
    key: 'floor_supervisor',
    label: 'Floor Supervisor',
    color: '#ffffff',
    bg: '#7c3aed',
    text: 'FS',
    type: 'text',
  },
  {
    key: 'replen_supervisor',
    label: 'Replen Supervisor',
    color: '#ffffff',
    bg: '#ea580c',
    text: 'RS',
    type: 'text',
  },
  {
    key: 'forklift',
    label: 'Forklift / EPT',
    color: '#ffffff',
    bg: '#ca8a04',
    text: 'FT',
    type: 'text',
  },
  {
    key: 'bailer',
    label: 'Bailer Trained',
    color: '#ffffff',
    bg: '#78716c',
    text: 'BA',
    type: 'text',
  },
  {
    key: 'cleaning_machine',
    label: 'Cleaning Machine',
    color: '#ffffff',
    bg: '#0891b2',
    text: 'CM',
    type: 'text',
  },
];

export function SkillIcon({ skill, size = 26 }) {
  const s = SKILLS.find((x) => x.key === skill);
  if (!s) return null;

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: '50%',
    background: s.bg,
    color: s.color,
    fontSize: s.type === 'emoji' ? size * 0.55 : size * 0.38,
    fontWeight: 800,
    flexShrink: 0,
    title: s.label,
  };

  return (
    <span style={style} title={s.label}>
      {s.type === 'emoji' ? s.icon : s.text}
    </span>
  );
}

export function SkillsLegend() {
  const [open, setOpen] = React.useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: '50%', background: 'var(--gray-200)',
          color: 'var(--gray-600)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          textTransform: 'none', letterSpacing: 0,
        }}
        title="Skill legend"
      >?</span>
      {open && (
        <div style={{
          position: 'absolute', top: '120%', right: 0, zIndex: 50,
          background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 10, minWidth: 200,
          textTransform: 'none', letterSpacing: 0, fontWeight: 400,
        }}>
          {SKILLS.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <SkillIcon skill={s.key} size={22} />
              <span style={{ fontSize: 12, color: 'var(--gray-700)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function SkillBadgeRow({ skills = [] }) {
  const active = SKILLS.filter((s) => skills.includes(s.key));
  if (active.length === 0) return <span style={{ color: 'var(--gray-300)' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {active.map((s) => (
        <SkillIcon key={s.key} skill={s.key} size={26} />
      ))}
    </div>
  );
}

export function SkillToggleGrid({ value = [], onChange }) {
  const toggle = (key) => {
    const next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {SKILLS.map((s) => {
        const active = value.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            title={s.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px 5px 6px',
              borderRadius: 999,
              border: active ? `2px solid ${s.bg === '#ffffff' ? s.bg : s.bg}` : '2px solid var(--gray-200)',
              background: active ? s.bg : 'white',
              cursor: 'pointer',
              transition: 'all .15s',
              opacity: active ? 1 : 0.5,
            }}
          >
            <SkillIcon skill={s.key} size={22} />
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: active ? (s.type === 'text' ? s.bg : '#374151') : 'var(--gray-500)',
              whiteSpace: 'nowrap',
            }}>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
