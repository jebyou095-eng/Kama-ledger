// Pure helpers for the capture hotkey (no page needed, tested by tests/hotkey.cjs).
export var DEFAULT_HOTKEY = 'CommandOrControl+Shift+K';
export function hotkeyLabel(accelerator) { return String(accelerator || '').replace('CommandOrControl', 'Ctrl'); }
export function accelFromEvent(event) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].indexOf(event.key) >= 0) return null;
  var key = event.key;
  var names = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  if (names[key]) key = names[key];
  else if (key.length === 1) key = key.toUpperCase();
  if (!/^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Space|Up|Down|Left|Right|Tab|Enter|Backspace|Insert|Delete|Home|End|PageUp|PageDown)$/.test(key)) return null;
  var mods = [];
  if (event.ctrlKey || event.metaKey) mods.push('CommandOrControl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (!mods.length && !/^F\d/.test(key)) return null;
  return mods.concat(key).join('+');
}
