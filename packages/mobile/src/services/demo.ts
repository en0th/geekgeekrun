import { pendingCard, deliveryContact } from "./models.ts";
export function demoJobs() {
  return [
    {
      id: 9001,
      content: {
        job_info: {
          jobId: 9101,
          bossId: 9201,
          title: "高级前端工程师",
          brand: "青禾科技 · 示例公司",
          salary: "25–40K · 14薪",
          cityName: "上海",
          experienceName: "3–5年",
          degreeName: "本科",
          skills: ["Vue", "TypeScript", "产品思维"],
          description:
            "参与 AI 产品的体验设计与前端研发。负责复杂交互、性能优化和跨端协作。\n\n这是体验模式的虚构岗位，用于演示完整操作流程。",
        },
      },
    },
    {
      id: 9002,
      content: {
        job_info: {
          jobId: 9102,
          bossId: 9202,
          title: "AI 应用开发工程师",
          brand: "远山智能 · 示例公司",
          salary: "30–45K · 16薪",
          cityName: "杭州",
          experienceName: "3–5年",
          degreeName: "本科",
          skills: ["Python", "AI Agent", "全栈开发"],
          description:
            "与产品团队一起探索 AI 在真实场景中的应用，构建可靠的服务和对话体验。\n\n这是体验模式的虚构岗位。",
        },
      },
    },
    {
      id: 9003,
      content: {
        job_info: {
          jobId: 9103,
          bossId: 9203,
          title: "移动端开发工程师",
          brand: "有光数字 · 示例公司",
          salary: "20–35K · 14薪",
          cityName: "深圳",
          experienceName: "1–3年",
          degreeName: "本科",
          skills: ["iOS", "Android", "跨端"],
          description:
            "打磨移动端产品体验，参与双端工程建设、质量保障和持续发布。\n\n这是体验模式的虚构岗位。",
        },
      },
    },
  ].map(pendingCard);
}
export function demoContacts() {
  return [
    deliveryContact({
      id: 9301,
      zpJobId: 9101,
      zpBossUid: 9201,
      jobSnapshot: {
        jobId: 9101,
        bossId: 9201,
        bossName: "林女士",
        bossTitle: "招聘负责人",
        title: "高级前端工程师",
        brand: "青禾科技 · 示例公司",
      },
    }),
  ];
}
export const welcome =
  "你好，我是你的求职助手。\n告诉我期待的岗位、城市和薪资，我们一起找到合适的下一站。";
