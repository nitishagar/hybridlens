import type { AppMode } from '../services/hybrid';

const MODES: AppMode[] = [
  'PREFER_ON_DEVICE',
  'ONLY_ON_DEVICE',
  'PREFER_IN_CLOUD',
  'ONLY_IN_CLOUD',
];

export default function ModeSwitcher({
  mode,
  onChange,
  disabled,
}: {
  mode: AppMode;
  onChange: (m: AppMode) => void;
  disabled: boolean;
}) {
  return (
    <fieldset>
      <legend>Inference mode</legend>
      {MODES.map((m) => (
        <label key={m}>
          <input
            type="radio"
            name="inference-mode"
            value={m}
            checked={mode === m}
            disabled={disabled}
            onChange={() => onChange(m)}
          />
          {m}
        </label>
      ))}
    </fieldset>
  );
}
