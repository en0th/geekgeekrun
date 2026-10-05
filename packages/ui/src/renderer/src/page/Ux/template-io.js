// Export and import of 找岗位 configuration templates as a JSON file.

export const TEMPLATE_FILE_FORMAT = "geekgeekrun-config-templates";
export const TEMPLATE_FILE_VERSION = 1;
const MAX_NAME = 40;

/** file content for the given templates ({ name, snapshot }) */
export function exportTemplates(items, now = new Date()) {
  return JSON.stringify(
    {
      format: TEMPLATE_FILE_FORMAT,
      version: TEMPLATE_FILE_VERSION,
      exportedAt: now.toISOString(),
      templates: items.map((t) => ({ name: t.name, snapshot: t.snapshot })),
    },
    null,
    2,
  );
}

/**
 * The templates in an exported file, or an Error with a message for the user. A single
 * { name, snapshot } object is accepted as well.
 */
export function parseTemplateFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON，请选择从本程序导出的模板文件。");
  }
  const list = Array.isArray(data?.templates)
    ? data.templates
    : data && typeof data === "object" && "snapshot" in data
      ? [data]
      : null;
  if (!list) throw new Error("文件中没有找到配置模板。");
  if (data?.format && data.format !== TEMPLATE_FILE_FORMAT)
    throw new Error("这不是本程序导出的配置模板文件。");
  if (data?.version > TEMPLATE_FILE_VERSION)
    throw new Error("模板文件来自更新版本的程序，请先升级后再导入。");
  const templates = list.filter(
    (t) =>
      t &&
      typeof t.name === "string" &&
      t.name.trim() &&
      t.snapshot &&
      typeof t.snapshot === "object" &&
      !Array.isArray(t.snapshot),
  );
  if (!templates.length) throw new Error("文件中的模板都缺少名称或内容，无法导入。");
  return {
    templates: templates.map((t) => ({
      name: t.name.trim().slice(0, MAX_NAME),
      snapshot: t.snapshot,
    })),
    skipped: list.length - templates.length,
  };
}

/** `name`, or `name（2）`, `name（3）`… when it is already taken */
export function uniqueName(name, taken) {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) {
    const suffix = `（${i}）`;
    const candidate = name.slice(0, MAX_NAME - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}
