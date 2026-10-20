import type { JobSummary, JobSummaryTerm } from '../../../../../../common/job-summary'

// Local, explainable dictionary matches. These are mentions, not proficiency ratings.
const skillAliases: [string, string[]][] = [
  ['Java', ['java']], ['JavaScript', ['javascript', 'js']], ['TypeScript', ['typescript', 'ts']],
  ['Python', ['python', 'python3', 'python2']], ['Go', ['golang', 'go']], ['C++', ['c++']], ['C#', ['c#']],
  ['.NET', ['.net', 'dotnet', 'asp.net']], ['PHP', ['php']], ['Rust', ['rust']], ['Swift', ['swift']],
  ['Kotlin', ['kotlin']], ['SQL', ['sql']], ['HTML', ['html', 'html5']], ['CSS', ['css', 'css3']],
  ['Vue', ['vue', 'vue2', 'vue3', 'vue.js', 'vuejs']], ['React', ['react', 'react.js', 'reactjs']],
  ['Angular', ['angular']], ['Node.js', ['node.js', 'nodejs']], ['Spring', ['spring', 'springboot', 'spring boot']],
  ['Django', ['django']], ['Flask', ['flask']], ['FastAPI', ['fastapi']],
  ['MySQL', ['mysql']], ['PostgreSQL', ['postgresql', 'postgres']], ['Redis', ['redis']],
  ['MongoDB', ['mongodb']], ['Oracle', ['oracle']], ['Elasticsearch', ['elasticsearch']],
  ['Kafka', ['kafka']], ['RabbitMQ', ['rabbitmq']], ['Docker', ['docker']],
  ['Kubernetes', ['kubernetes', 'k8s']], ['Linux', ['linux']], ['Git', ['git']],
  ['CI/CD', ['ci/cd', 'cicd']], ['AWS', ['aws']], ['Azure', ['azure']],
  ['Hadoop', ['hadoop']], ['Spark', ['spark']], ['Flink', ['flink']],
  ['PyTorch', ['pytorch']], ['TensorFlow', ['tensorflow']], ['LLM', ['llm', '大语言模型', '大模型']],
  ['机器学习', ['机器学习', 'machine learning']], ['深度学习', ['深度学习', 'deep learning']],
  ['计算机视觉', ['计算机视觉', 'computer vision']], ['自然语言处理', ['自然语言处理', 'nlp']],
  ['数据分析', ['数据分析']], ['数据建模', ['数据建模']], ['数据可视化', ['数据可视化']],
  ['Excel', ['excel']], ['Power BI', ['power bi', 'powerbi']], ['Tableau', ['tableau']],
  ['Figma', ['figma']], ['Sketch', ['sketch']], ['Photoshop', ['photoshop', 'ps']],
  ['Illustrator', ['illustrator']], ['AutoCAD', ['autocad', 'cad']], ['SolidWorks', ['solidworks']],
  ['PRD', ['prd']], ['原型设计', ['原型设计']], ['用户研究', ['用户研究']], ['交互设计', ['交互设计']],
  ['项目管理', ['项目管理']], ['需求分析', ['需求分析']], ['敏捷开发', ['敏捷开发', 'agile']],
  ['自动化测试', ['自动化测试']], ['性能测试', ['性能测试']], ['Selenium', ['selenium']],
  ['Playwright', ['playwright']], ['JMeter', ['jmeter']], ['单片机', ['单片机']],
  ['嵌入式', ['嵌入式']], ['PLC', ['plc']], ['电路设计', ['电路设计']],
  ['财务分析', ['财务分析']], ['成本核算', ['成本核算']], ['预算管理', ['预算管理']],
  ['税务', ['税务']], ['会计', ['会计']], ['SAP', ['sap']], ['ERP', ['erp']],
  ['供应链', ['供应链']], ['采购', ['采购']], ['客户开发', ['客户开发']],
  ['商务谈判', ['商务谈判']], ['市场调研', ['市场调研']], ['SEO', ['seo']],
  ['SEM', ['sem']], ['内容运营', ['内容运营']], ['用户运营', ['用户运营']],
  ['直播', ['直播']], ['短视频', ['短视频']], ['剪辑', ['剪辑']],
  ['英语', ['英语', 'english']], ['日语', ['日语']], ['韩语', ['韩语']]
]
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const skills = skillAliases.map(([term, aliases]) => ({ term, patterns: aliases.map(alias =>
  /[a-z]/i.test(alias) ? new RegExp(`(?<![a-z0-9_])${escape(alias)}(?![a-z0-9_])`, 'i') : new RegExp(escape(alias))) }))
const knownSkillWords = new Set(skillAliases.flatMap(([label, aliases]) => [label, ...aliases].map(s => s.toLowerCase())))
const stopWords = new Set(`岗位 职位 职责 任职 资格 要求 负责 工作 公司 我们 团队 具有 具备 能够 可以 熟悉 熟练 熟练掌握 掌握 了解 精通 优先 经验 相关 以上 以下 及其 以及 进行 完成 参与 协助 其他 能力 良好 较强 一定 独立 职业 专业 学历 本科 专科 大专 毕业 应届 学生 实习 全职 兼职 任职资格 工作职责 岗位职责 岗位要求 任职要求 岗位描述 工作内容 薪资 福利 待遇 五险 一金 年终奖 双休 休假 上班 下班 时间 薪酬 发展 提供 加入 一起 环境 氛围 面议 沟通 责任心 责任 团队合作 精神 意识 积极 热爱 认真 踏实 优秀 持续 不限 最好 欢迎 技能 技术 使用 应用 包括 通过 对于 根据 支持 业务 需求 项目 产品 设计 开发 维护 管理 运营 系统 平台 服务 等等 等的 一个 各种 这种 方面 之间 例如 如下 不仅 同时 保证 确保 实现 解决 提升 提高 优化 the and or of to in for with on a an is are we you your our be as by at from have will can this that it not work job team company experience skills required responsibilities ability requirements`.split(/\s+/))

export function cleanDescription(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.normalize('NFKC')
  text = text.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
  }).replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) =>
    ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name.toLowerCase()]!)
  return text.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

// Electron ships ICU; Segmenter avoids arbitrary Chinese character n-grams.
const Segmenter = (Intl as unknown as { Segmenter: new (locale: string, opts: object) => {
  segment(text: string): Iterable<{ segment: string; isWordLike: boolean }>
} }).Segmenter
const segmenter = new Segmenter('zh', { granularity: 'word' })
const ranked = (counts: Map<string, number>, denominator: number): JobSummaryTerm[] => [...counts]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
  .slice(0, 20).map(([term, jobs]) => ({ term, jobs, percent: denominator ? Math.round(jobs / denominator * 1000) / 10 : 0 }))

interface JobTextRow {
  encryptJobId: string
  description: unknown
  firstSeenAt?: string | null
  discoveryOrigin?: string | null
  textTruncated?: number
}
export function summarizeJobs(rows: Iterable<JobTextRow>, totalJobs?: number, sampleLimit?: number): JobSummary {
  const result: JobSummary = { totalJobs: totalJobs ?? 0, sampledJobs: 0, sampleLimit: sampleLimit ?? 0, withDescription: 0, missingDescription: 0,
    truncatedDescriptions: 0, firstSeenFrom: null, firstSeenTo: null, unknownFirstSeen: 0,
    origins: { capture: 0, import: 0, legacy: 0 }, skills: [], terms: [] }
  const seen = new Set<string>(), skillCounts = new Map<string, number>(), wordCounts = new Map<string, number>()
  for (const row of rows) {
    if (!row.encryptJobId || seen.has(row.encryptJobId)) continue
    seen.add(row.encryptJobId)
    result.sampledJobs++
    const origin = row.discoveryOrigin
    result.origins[origin === 'capture' || origin === 'import' ? origin : 'legacy']++
    if (row.firstSeenAt) {
      if (!result.firstSeenFrom || row.firstSeenAt < result.firstSeenFrom) result.firstSeenFrom = row.firstSeenAt
      if (!result.firstSeenTo || row.firstSeenAt > result.firstSeenTo) result.firstSeenTo = row.firstSeenAt
    } else result.unknownFirstSeen++
    if (row.textTruncated) result.truncatedDescriptions++
    const text = cleanDescription(row.description)
    if (!text) { result.missingDescription++; continue }
    result.withDescription++
    let termText = text
    for (const skill of skills) if (skill.patterns.some(pattern => pattern.test(text))) {
      skillCounts.set(skill.term, (skillCounts.get(skill.term) || 0) + 1)
      for (const pattern of skill.patterns) termText = termText.replace(new RegExp(pattern.source, 'gi'), ' ')
    }
    const terms = new Set<string>()
    for (const part of segmenter.segment(termText)) {
      const term = part.segment.toLowerCase()
      if (!part.isWordLike || !/^[\p{Script=Han}a-z][\p{Script=Han}a-z0-9+#.-]{1,23}$/u.test(term)
        || stopWords.has(term) || knownSkillWords.has(term)) continue
      terms.add(term)
    }
    for (const term of terms) wordCounts.set(term, (wordCounts.get(term) || 0) + 1)
  }
  result.skills = ranked(skillCounts, result.withDescription)
  result.terms = ranked(wordCounts, result.withDescription)
  result.totalJobs = totalJobs ?? result.sampledJobs
  result.sampleLimit = sampleLimit ?? result.sampledJobs
  return result
}
