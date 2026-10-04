export const clone = (value) => JSON.parse(JSON.stringify(value));
export { validModels as validModelList } from "./model-config.mjs";
export function followIssues(f) {
  const errors = [];
  if (!Number.isInteger(f.days) || f.days < 0)
    errors.push({
      field: "follow-days",
      text: "请填写会话天数：0表示不限时间，或填写正整数。",
    });
  if (!Number.isFinite(f.interval) || f.interval < 3)
    errors.push({
      field: "follow-interval",
      text: "请填写跟进间隔，至少3分钟。",
    });
  if (
    f.source === "ai" &&
    (!Number.isInteger(f.context) || f.context < 8 || f.context > 20)
  )
    errors.push({
      field: "follow-context",
      text: "请填写AI参考消息条数，须为8—20的整数。",
    });
  return errors;
}
export function followErrors(f) {
  return followIssues(f).map((issue) => issue.text);
}
export function normalizeCache(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  function validDraft(d) {
    return (
      d &&
      [
        "titles",
        "cities",
        "companies",
        "excluded",
        "experience",
        "categories",
        "description",
        "inheritedFields",
        "moreSources",
        "sourceWords",
      ].every(
        (k) => Array.isArray(d[k]) && d[k].every((v) => typeof v === "string"),
      ) &&
      d.overrides &&
      d.scopes &&
      Array.isArray(d.sourceList) &&
      d.sourceList.every(
        (s) =>
          s &&
          ["search", "expect", "recommend"].includes(s.type) &&
          (s.type !== "search" ||
            (Array.isArray(s.children) &&
              s.children.every((c) => c && typeof c.keyword === "string"))),
      ) &&
      d.sourceList.some((s) => s.type === "search")
    );
  }
  if (value.draft && !validDraft(value.draft))
    return {
      templates: (Array.isArray(value.templates) ? value.templates : []).filter(
        (t) => t?.id && t.name && validDraft(t.snapshot),
      ),
      templateDrafts: {},
    };
  const next = clone(value);
  next.templates = Array.isArray(next.templates)
    ? next.templates.filter((t) => t?.id && t.name && validDraft(t.snapshot))
    : [];
  next.templateDrafts = Object.fromEntries(
    Object.entries(next.templateDrafts || {}).filter(([, d]) => validDraft(d)),
  );
  if (
    next.follow &&
    (!["emotion", "ai"].includes(next.follow.source) ||
      !["fixed", "ai"].includes(next.follow.opening))
  )
    delete next.follow;
  if (next.shared && !Array.isArray(next.shared.cities)) delete next.shared;
  return next;
}
