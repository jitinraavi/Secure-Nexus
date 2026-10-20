/** Legacy SQL is parameterized before sending it to PostgreSQL, never interpolated. */
interface Token { text: string; kind: "word" | "space" | "protected" | "symbol"; }
function tokens(sql: string): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < sql.length;) {
    const remaining = sql.slice(index);
    let match: RegExpMatchArray | null;
    if ((match = remaining.match(/^\s+/))) { result.push({ text: match[0], kind: "space" }); index += match[0].length; continue; }
    if (remaining.startsWith("--")) {
      const end = sql.indexOf("\n", index);
      const text = sql.slice(index, end < 0 ? sql.length : end);
      result.push({ text, kind: "protected" }); index += text.length; continue;
    }
    if (remaining.startsWith("/*")) {
      let depth = 1, end = index + 2;
      while (end < sql.length && depth) {
        if (sql.startsWith("/*", end)) { depth += 1; end += 2; }
        else if (sql.startsWith("*/", end)) { depth -= 1; end += 2; }
        else end += 1;
      }
      if (depth) throw new Error("Unterminated SQL comment");
      result.push({ text: sql.slice(index, end), kind: "protected" }); index = end; continue;
    }
    const quote = sql[index];
    if (quote === "'" || quote === '"' || quote === "`") {
      let end = index + 1;
      let closed = false;
      const escaped = quote === "'" && /[eE]/.test(sql[index - 1] ?? "") && !/[A-Za-z_0-9]/.test(sql[index - 2] ?? "");
      for (; end < sql.length; end += 1) {
        if (escaped && sql[end] === "\\") { end += 1; continue; }
        if (sql[end] !== quote) continue;
        if (sql[end + 1] === quote) { end += 1; continue; }
        end += 1; closed = true; break;
      }
      if (!closed) throw new Error("Unterminated SQL string");
      result.push({ text: sql.slice(index, end), kind: "protected" }); index = end; continue;
    }
    if ((match = remaining.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/))) {
      const end = sql.indexOf(match[0], index + match[0].length);
      if (end < 0) throw new Error("Unterminated SQL dollar string");
      const text = sql.slice(index, end + match[0].length);
      result.push({ text, kind: "protected" }); index += text.length; continue;
    }
    if ((match = remaining.match(/^[A-Za-z_][A-Za-z_0-9]*/))) {
      result.push({ text: match[0], kind: "word" }); index += match[0].length; continue;
    }
    result.push({ text: sql[index], kind: "symbol" }); index += 1;
  }
  return result;
}

const identityColumns: Readonly<Record<string, string>> = {
  audit_logs: "id", project_collaboration_events: "id", project_operations: "id",
  organization_audit: "id", project_sync_operations: "sequence",
};

export function postgresSql(sql: string, options: { returningIdentity?: boolean } = {}): { sql: string; parameters: number; identity?: string } {
  const lexed = tokens(sql);
  let parameterCount = 0;
  const significant = lexed.filter((token) => token.kind !== "space" && !(token.kind === "protected" && /^(--|\/\*)/.test(token.text)));
  // Case-insensitive auth predicates are explicit, so database locale cannot alter them.
  for (let index = 0; index < significant.length - 4; index += 1) {
    const left = significant[index], equal = significant[index + 1], value = significant[index + 2];
    if (left.kind === "word" && equal.text === "=" && value.text === "?" &&
        significant[index + 3].text.toUpperCase() === "COLLATE" && significant[index + 4].text.toUpperCase() === "NOCASE") {
      let identifier = left.text;
      let start = index;
      while (start >= 2 && significant[start - 1].text === "." && significant[start - 2].kind === "word") {
        identifier = `${significant[start - 2].text}.${identifier}`;
        significant[start - 2].text = ""; significant[start - 1].text = "";
        start -= 2;
      }
      left.text = `lower(${identifier})`;
      value.text = "LOWER_PARAMETER";
      significant[index + 3].text = ""; significant[index + 4].text = "";
    }
  }
  let insertedTable: string | undefined;
  const ignoreIndex = significant.findIndex((token, index) => token.text.toUpperCase() === "INSERT" && significant[index + 1]?.text.toUpperCase() === "OR" && significant[index + 2]?.text.toUpperCase() === "IGNORE");
  if (ignoreIndex >= 0) { significant[ignoreIndex + 1].text = ""; significant[ignoreIndex + 2].text = ""; }
  for (let index = 0; index < significant.length; index += 1) {
    const token = significant[index];
    const previous = significant[index - 1]?.text.toUpperCase();
    if (token.text === "?" || token.text === "LOWER_PARAMETER") {
      parameterCount += 1;
      token.text = token.text === "?" ? `$${parameterCount}` : `lower($${parameterCount})`;
    }
    if (token.kind === "word" && previous === "AS" && /[a-z].*[A-Z]|[A-Z].*[a-z]/.test(token.text)) token.text = `"${token.text}"`;
    if (token.kind === "word" && ["FROM", "JOIN", "INTO", "UPDATE", "REFERENCES"].includes(previous ?? "")) {
      if (significant[index + 1]?.text === ".") continue;
      if (previous === "UPDATE" && significant[index - 2]?.text.toUpperCase() === "DO") continue;
      if (previous === "INTO") insertedTable = token.text.toLowerCase();
      token.text = `groundwork.${token.text}`;
    }
    if (token.text.toUpperCase() === "LIMIT" && significant[index + 1]?.text === "-" && significant[index + 2]?.text === "1" && significant[index + 3]?.text.toUpperCase() === "OFFSET") {
      token.text = ""; significant[index + 1].text = ""; significant[index + 2].text = "";
    }
  }
  let converted = lexed.map((token) => token.text).join("").trim().replace(/;\s*$/, "");
  if (ignoreIndex >= 0) converted += " ON CONFLICT DO NOTHING";
  const identity = options.returningIdentity && insertedTable ? identityColumns[insertedTable] : undefined;
  if (identity && !significant.some((token) => token.kind === "word" && token.text.toUpperCase() === "RETURNING")) converted += ` RETURNING ${identity}`;
  return { sql: converted, parameters: parameterCount, ...(identity ? { identity } : {}) };
}
