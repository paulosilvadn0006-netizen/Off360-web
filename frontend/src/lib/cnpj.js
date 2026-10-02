// Validação e máscara de CNPJ (algoritmo oficial dos dígitos verificadores).
export function onlyDigits(v) {
  return (v || "").replace(/\D/g, "");
}

export function maskCnpj(v) {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function validCnpj(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (nums) => {
    let s = 0;
    let w = 2;
    for (let i = nums.length - 1; i >= 0; i--) {
      s += parseInt(nums[i], 10) * w;
      w = w < 9 ? w + 1 : 2;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === parseInt(d[12], 10) && dv(d.slice(0, 13)) === parseInt(d[13], 10);
}

export function maskCpf(v) {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function validCpf(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += parseInt(d[i], 10) * (t + 1 - i);
    let r = (s * 10) % 11;
    if (r === 10) r = 0;
    if (r !== parseInt(d[t], 10)) return false;
  }
  return true;
}
