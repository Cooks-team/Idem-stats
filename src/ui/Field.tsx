// Champ stylisé d'après le design (label en haut, focus border accent).
import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Field({ label, ...inputProps }: Props) {
  return (
    <label className="field">
      <div className="field-label">{label}</div>
      <input {...inputProps} />
    </label>
  );
}
