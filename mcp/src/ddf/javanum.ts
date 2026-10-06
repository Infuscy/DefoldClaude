// Number formatting identical to Java's Float.toString / Double.toString (JDK 19+ shortest round-trip),
// which is what the Defold editor writes into resource files.

/** Shortest decimal digits/exponent that round-trip for the given precision. */
function shortestDigits(value: number, isFloat: boolean): { digits: string; exp: number } {
  // exp: position of the decimal point relative to the first digit (value = 0.d1d2… × 10^exp).
  if (!isFloat) {
    const s = Math.abs(value).toExponential(); // JS gives shortest round-trip digits for doubles
    const [mant, e] = s.split('e');
    return { digits: mant!.replace('.', ''), exp: Number(e) + 1 };
  }
  const target = Math.fround(value);
  for (let p = 1; p <= 9; p++) {
    const s = Math.abs(target).toExponential(p - 1);
    if (Math.fround(Number(s) * Math.sign(target || 1)) === target || Math.fround(Number(s)) === Math.abs(target)) {
      const [mant, e] = s.split('e');
      return { digits: mant!.replace('.', '').replace(/0+$/, '') || '0', exp: Number(e) + 1 };
    }
  }
  const s = Math.abs(target).toExponential(8);
  const [mant, e] = s.split('e');
  return { digits: mant!.replace('.', '').replace(/0+$/, '') || '0', exp: Number(e) + 1 };
}

export function javaFloatToString(value: number, isFloat = true): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  const v = isFloat ? Math.fround(value) : value;
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const { digits, exp } = shortestDigits(abs, isFloat);
  if (abs >= 1e-3 && abs < 1e7) {
    // Plain notation with at least one digit on each side of the point.
    if (exp <= 0) return `${sign}0.${'0'.repeat(-exp)}${digits}`;
    if (exp >= digits.length) return `${sign}${digits}${'0'.repeat(exp - digits.length)}.0`;
    return `${sign}${digits.slice(0, exp)}.${digits.slice(exp)}`;
  }
  // Computerized scientific notation: d.ddddE[-]n
  const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : `${digits}.0`;
  return `${sign}${mant}E${exp - 1}`;
}
