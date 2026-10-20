interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
}

/** A small single-choice control, used for periods, regions and best/worst. */
export function Segmented<T extends string>({ label, value, options, onChange, format = (v) => v }: Props<T>) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" role="tab" aria-selected={option === value} onClick={() => onChange(option)}>
          {format(option)}
        </button>
      ))}
    </div>
  );
}
