/** Update only mail variables; retain unrelated environment text and line endings. */
export function mergeMailEnvironment(original, changes) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map(Object.entries(changes));
  const output = [];
  for (const line of original.split(/\r?\n/)) {
    const name = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (name && Object.hasOwn(changes, name)) {
      if (pending.has(name)) output.push(`${name}=${JSON.stringify(pending.get(name))}`);
      pending.delete(name);
    } else output.push(line);
  }
  while (output.at(-1) === '') output.pop();
  for (const [name, value] of pending) output.push(`${name}=${JSON.stringify(value)}`);
  return `${output.join(newline)}${newline}`;
}
