interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const css = `
.rf-toggle-wrap .tgl { display: none; }
.rf-toggle-wrap .tgl, .rf-toggle-wrap .tgl:after, .rf-toggle-wrap .tgl:before,
.rf-toggle-wrap .tgl *, .rf-toggle-wrap .tgl *:after, .rf-toggle-wrap .tgl *:before,
.rf-toggle-wrap .tgl + .tgl-btn { box-sizing: border-box; }
.rf-toggle-wrap .tgl + .tgl-btn {
  outline: 0; display: block; width: 4em; height: 2em;
  position: relative; cursor: pointer; user-select: none;
}
.rf-toggle-wrap .tgl + .tgl-btn:after, .rf-toggle-wrap .tgl + .tgl-btn:before {
  position: relative; display: block; content: ""; width: 50%; height: 100%;
}
.rf-toggle-wrap .tgl + .tgl-btn:after { left: 0; }
.rf-toggle-wrap .tgl + .tgl-btn:before { display: none; }
.rf-toggle-wrap .tgl:checked + .tgl-btn:after { left: 50%; }
.rf-toggle-wrap .tgl-skewed + .tgl-btn {
  overflow: hidden; transform: skew(-10deg); backface-visibility: hidden;
  transition: all 0.2s ease; font-family: sans-serif; background: #888;
}
.rf-toggle-wrap .tgl-skewed + .tgl-btn:after, .rf-toggle-wrap .tgl-skewed + .tgl-btn:before {
  transform: skew(10deg); display: inline-block; transition: all 0.2s ease;
  width: 100%; text-align: center; position: absolute; line-height: 2em;
  font-weight: bold; color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,0.4);
}
.rf-toggle-wrap .tgl-skewed + .tgl-btn:after { left: 100%; content: attr(data-tg-on); }
.rf-toggle-wrap .tgl-skewed + .tgl-btn:before { left: 0; content: attr(data-tg-off); }
.rf-toggle-wrap .tgl-skewed + .tgl-btn:active { background: #888; }
.rf-toggle-wrap .tgl-skewed + .tgl-btn:active:before { left: -10%; }
.rf-toggle-wrap .tgl-skewed:checked + .tgl-btn { background: #1d4ed8; }
.rf-toggle-wrap .tgl-skewed:checked + .tgl-btn:before { left: -100%; }
.rf-toggle-wrap .tgl-skewed:checked + .tgl-btn:after { left: 0; }
.rf-toggle-wrap .tgl-skewed:checked + .tgl-btn:active:after { left: 10%; }
.rf-toggle-wrap.rf-disabled { opacity: 0.5; pointer-events: none; }
`;

let idCounter = 0;

export function Toggle({ checked, onChange, disabled = false }: ToggleProps) {
  const id = `tgl-${++idCounter}`;
  return (
    <>
      <style>{css}</style>
      <div className={`rf-toggle-wrap${disabled ? ' rf-disabled' : ''}`}>
        <input
          className="tgl tgl-skewed"
          type="checkbox"
          id={id}
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
        <label className="tgl-btn" data-tg-on="ON" data-tg-off="OFF" htmlFor={id} />
      </div>
    </>
  );
}
