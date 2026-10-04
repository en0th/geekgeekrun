// Shared by execution and local preview. Unknown required data never authorizes outreach.
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
export function missingJobFields(row, rules) {
  const missing = []
  const requireText = (enabled, value, label) => {
    if (enabled && (value == null || !String(value).trim())) missing.push(label + '信息不足')
  }
  requireText(rules.title, row.jobName, '岗位名称')
  requireText(rules.category, row.jobTypeName, '岗位类别')
  requireText(rules.description, row.jobDescription, '岗位描述')
  requireText(rules.city, row.cityName, '城市')
  requireText(rules.company, row.companyName, '公司')
  requireText(rules.experience, row.experienceName, '经验')
  requireText(rules.hr, row.bossTitle, '招聘者身份')
  if (rules.salary) {
    if (row.salaryLow == null || row.salaryHigh == null || !Number.isFinite(Number(row.salaryLow)) || !Number.isFinite(Number(row.salaryHigh))) missing.push('薪资信息不足')
    if (rules.annual && !(Number(row.salaryMonth) > 0)) missing.push('薪数缺失，年薪无法确认')
  }
  if (rules.activity && (row.active == null || !rules.activeLabels?.includes(row.active || '半年前活跃'))) missing.push('招聘者活跃状态无法确认')
  return missing
}
export function scopedMarkStrategy(strategy, scope, companies, companyName) {
  if (strategy !== 1 || scope === 1) return strategy
  return companies.some(word => String(companyName || '').toLowerCase().includes(word.toLowerCase())) ? strategy : 3
}
export class ExpiringBlockSet extends Set {
  deadlines = new Map()
  constructor(now = Date.now) { super(); this.now = now }
  add(value) { this.deadlines.delete(value); return super.add(value) }
  addWithExpiry(value, deadline) {
    if (!(deadline > this.now())) return this
    // Do not weaken an independent, session-long block with a timed block.
    if (super.has(value) && !this.deadlines.has(value)) return this
    super.add(value)
    this.deadlines.set(value, Math.max(this.deadlines.get(value) || 0, deadline))
    return this
  }
  setExpiry(value, deadline) { super.add(value); this.deadlines.set(value, deadline); return this }
  has(value) {
    if (this.deadlines.has(value) && this.deadlines.get(value) <= this.now()) this.delete(value)
    return super.has(value)
  }
  delete(value) { this.deadlines.delete(value); return super.delete(value) }
  *values() { for (const value of super.values()) if (this.has(value)) yield value }
  [Symbol.iterator]() { return this.values() }
}
