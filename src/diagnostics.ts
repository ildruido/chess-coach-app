// Coach diagnostics (CC-051): an opt-in switch that shows why a hint was held back and how many
// answers were reused or sent to the coach. Off by default; remembered on this device.

const KEY = "chess-coach.diagnostics";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();

export function diagnosticsOn(): boolean {
  return on;
}

export function setDiagnostics(value: boolean): void {
  on = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // Only a convenience.
  }
  for (const listener of listeners) listener();
}

/** Run `listener` whenever the switch changes. */
export function onDiagnostics(listener: () => void): void {
  listeners.add(listener);
}

/** Wire the page's checkbox to the switch. */
export function mountDiagnosticsSwitch(): void {
  const box = document.getElementById("diagnostics-toggle") as HTMLInputElement;
  box.checked = on;
  box.addEventListener("change", () => setDiagnostics(box.checked));
}
