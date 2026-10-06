/* Task-oriented UI migrated from the accepted prototype. All execution uses native IPC. */
import { toast } from "../../features/Toast";
import { exportTemplates, parseTemplateFile, uniqueName } from "./template-io.js";
import { parseMarkdown } from "./markdown.js";
import {
  REPOSITORY_URL,
  RELEASES_URL,
  releaseTag,
} from "../../../../common/repository.mjs";
// notes of each released version, written into the repository by the release workflow
import releaseNotesByVersion from "../../../../common/release-notes.json";
import * as Vue from "vue";
import {
  modelPair,
  DEFAULT_MODEL,
  AI_REQUEST_DEFAULTS,
  AI_TIMEOUT_SECONDS_RANGE,
  AI_MAX_RETRIES_RANGE,
} from "../../../../common/model-config.mjs";
import { followIssues } from "../../../../common/ux-validation.mjs";
import { ElMessageBox, ElImageViewer } from "element-plus";
import JobLibrary from "../MainLayout/JobLibrary.vue";
import RunDataTable from "../../features/RunDataTable/index.vue";
import { runDataStatsPresets } from "../../features/RunDataTable/stats-presets";
import { toDbDate } from "../../features/RunDataTable/format";
import { EXIT_CODE_LABELS } from "../../../../common/task-labels";
import BossLibrary from "../MainLayout/BossLibrary.vue";
import CompanyLibrary from "../MainLayout/CompanyLibrary.vue";
import StartChatRecord from "../MainLayout/StartChatRecord.vue";
import MarkAsNotSuitRecord from "../MainLayout/MarkAsNotSuitRecord.vue";
import FavoriteJobs from "../MainLayout/FavoriteJobs.vue";
import {
  Fold,
  Expand,
  DArrowLeft,
  DArrowRight,
  ChatDotRound,
  Bell,
  Document,
  Collection,
  List,
  Setting,
  Compass,
  TopRight,
  QuestionFilled,
} from "@element-plus/icons-vue";
import { getAutoStartChatSteps } from "../../../../common/prerequisite-step-by-step-check";
import {
  useTaskManagerStore,
  useUpdateStore,
  useRunDataJumpStore,
} from "../../store";
import buildInfo from "../../../../common/build-info.json";
import "./filter-data.js";
import "./keyword-examples.js";
import "./ux.css";
import { refractionMap } from "./glass.js";
import {
  missingJobFields,
  scopedMarkStrategy,
} from "@geekgeekrun/geek-auto-start-chat-with-boss/job-safety.mjs";
import {
  readRunSettings,
  waitSeconds,
  DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
  DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
} from "@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs";
import {
  createNativeState,
  validModelList,
  followErrors,
  normalizeCache,
} from "./native-state.js";
import {
  isSearchRotationEnabled,
  searchOptionsForRun,
  countPlatformCombinations,
} from "./search-settings.js";

export default Vue.defineComponent({
  name: "UxWorkspace",
  async setup() {
    const R = { ...Vue, message: toast },
      h = R.h,
      ref = R.ref;
    const clone = (x) => JSON.parse(JSON.stringify(x));
    let native;
    const [request, restoreContext] = Vue.withAsyncContext(() =>
      createNativeState(),
    );
    try {
      native = await request;
      restoreContext();
    } catch {
      restoreContext();
      return () =>
        h("section", { class: "ux-card" }, [
          h("h1", "配置加载失败"),
          h("p", "请检查数据目录是否可读。原有配置不会被替换。"),
          h("button", { onClick: () => location.reload() }, "重新加载"),
        ]);
    }
    const initial = native.state();
    const taskStore = useTaskManagerStore(),
      updateStore = useUpdateStore();
    const activeLabels = [
      "",
      "半年前活跃",
      "近半年活跃",
      "5月内活跃",
      "4月内活跃",
      "3月内活跃",
      "2月内活跃",
      "本月活跃",
      "2周内活跃",
      "本周活跃",
      "3日内活跃",
      "昨日活跃",
      "今日活跃",
      "刚刚活跃",
    ];
    const defaults = {
      titles: [],
      cities: [],
      salary: false,
      unit: null,
      low: null,
      high: null,
      extra: [],
      companies: [],
      excluded: [],
      experience: [],
      categories: [],
      description: [],
      hr: false,
      activity: "不限",
      source: "search",
      sourceWords: [],
      independentWords: false,
      moreSources: [],
      pause: true,
      actions: 100,
      minutes: 15,
      strategy: 3,
      overrides: {},
      scopes: {},
      inherit: false,
      inheritedFields: [
        "titles",
        "cities",
        "salary",
        "companies",
        "excluded",
        "categories",
        "description",
        "hr",
      ],
      regexMode: false,
      regexTitle: "",
      regexType: "",
      regexDesc: "",
      regexExclude: "",
      regexLogic: 1,
    };
    const cached = normalizeCache(initial.uxState);
    const original = initial.config["boss.json"];
    // Existing expressions are never silently interpreted as ordinary keywords.
    const adopted = {
      ...defaults,
      titles: [],
      cities: original.expectCityList || [],
      salary:
        original.expectSalaryLow != null || original.expectSalaryHigh != null,
      low:
        original.expectSalaryLow == null
          ? null
          : original.expectSalaryLow *
            (original.expectSalaryCalculateWay === 2 ? 1 : 1000),
      high:
        original.expectSalaryHigh == null
          ? null
          : original.expectSalaryHigh *
            (original.expectSalaryCalculateWay === 2 ? 1 : 1000),
      unit: original.expectSalaryCalculateWay === 2 ? "year" : "month",
      pause: original.isSageTimeEnabled,
      actions: original.sageTimeOpTimes,
      minutes: original.sageTimePauseMinute,
      companies: initial.config["target-company-list.json"] || [],
      hr: original.isPosterHrFilterEnabled,
      hrRule: original.posterHrTitleRegExpStr,
      experience: (original.expectWorkExpList || [])
        .map(
          (v) =>
            ({
              101: "经验不限",
              102: "应届生",
              103: "1年以内",
              104: "1-3年",
              105: "3-5年",
              106: "5-10年",
              107: "10年以上",
            })[v],
        )
        .filter(Boolean),
      activity:
        original.markAsNotActiveSelectedTimeRange > 0
          ? activeLabels[original.markAsNotActiveSelectedTimeRange + 1] ||
            "不限"
          : "不限",
      legacySources: original.jobSourceList.some((s) => s.enabled),
      regexMode: Boolean(
        original.expectJobNameRegExpStr ||
          original.expectJobTypeRegExpStr ||
          original.expectJobDescRegExpStr ||
          original.blockCompanyNameRegExpStr,
      ),
      regexTitle: original.expectJobNameRegExpStr,
      regexType: original.expectJobTypeRegExpStr,
      regexDesc: original.expectJobDescRegExpStr,
      regexExclude: original.blockCompanyNameRegExpStr,
      regexLogic: original.jobDetailRegExpMatchLogic,
      overrides: {
        title: original.jobNotMatchStrategy,
        city: original.expectCityNotMatchStrategy,
        salary: original.expectSalaryNotMatchStrategy,
        experience: original.expectWorkExpNotMatchStrategy,
        company: original.blockCompanyNameRegMatchStrategy,
        hr: original.posterHrNotMatchStrategy,
        activity: original.jobNotActiveStrategy,
      },
      scopes: {
        city: original.strategyScopeOptionWhenMarkJobCityNotMatch,
        salary: original.strategyScopeOptionWhenMarkSalaryNotMatch,
        experience: original.strategyScopeOptionWhenMarkJobWorkExpNotMatch,
      },
    };
    const common = initial.config["common-job-condition-config.json"];
    // Materialize the original shared-field bindings before retiring the duplicate preference UI.
    if (!cached?.draft) {
      const flags = original.fieldsForUseCommonConfig || {};
      if (flags.city) adopted.cities = clone(common.expectCityList || []);
      if (flags.expectCompanies)
        adopted.companies = clone(common.expectCompanies || []);
      if (flags.salary) {
        adopted.low =
          common.expectSalaryLow == null
            ? null
            : common.expectSalaryLow *
              (common.expectSalaryCalculateWay === 2 ? 1 : 1000);
        adopted.high =
          common.expectSalaryHigh == null
            ? null
            : common.expectSalaryHigh *
              (common.expectSalaryCalculateWay === 2 ? 1 : 1000);
        adopted.unit = common.expectSalaryCalculateWay === 2 ? "year" : "month";
        adopted.salary = adopted.low != null || adopted.high != null;
      }
      if (flags.jobDetail) {
        for (const [raw, key] of [
          ["expectJobNameRegExpStr", "regexTitle"],
          ["expectJobTypeRegExpStr", "regexType"],
          ["expectJobDescRegExpStr", "regexDesc"],
          ["jobDetailRegExpMatchLogic", "regexLogic"],
        ])
          adopted[key] = common[raw];
        adopted.hr = common.isPosterHrFilterEnabled;
        adopted.hrRule = common.posterHrTitleRegExpStr;
      }
      if (flags.blockCompanyNameRegExpStr)
        adopted.regexExclude = common.blockCompanyNameRegExpStr;
      adopted.regexMode = Boolean(
        adopted.regexTitle ||
          adopted.regexType ||
          adopted.regexDesc ||
          adopted.regexExclude,
      );
    }
    const commonDraft = {
      ...clone(defaults),
      cities: common.expectCityList || [],
      companies: common.expectCompanies || [],
      regexMode: Boolean(
        common.expectJobNameRegExpStr ||
          common.expectJobTypeRegExpStr ||
          common.expectJobDescRegExpStr ||
          common.blockCompanyNameRegExpStr,
      ),
      regexTitle: common.expectJobNameRegExpStr,
      regexType: common.expectJobTypeRegExpStr,
      regexDesc: common.expectJobDescRegExpStr,
      regexExclude: common.blockCompanyNameRegExpStr,
      regexLogic: common.jobDetailRegExpMatchLogic,
      hr: common.isPosterHrFilterEnabled,
      hrRule: common.posterHrTitleRegExpStr,
      low:
        common.expectSalaryLow == null
          ? null
          : common.expectSalaryLow *
            (common.expectSalaryCalculateWay === 2 ? 1 : 1000),
      high:
        common.expectSalaryHigh == null
          ? null
          : common.expectSalaryHigh *
            (common.expectSalaryCalculateWay === 2 ? 1 : 1000),
      salary: common.expectSalaryLow != null || common.expectSalaryHigh != null,
      unit: common.expectSalaryCalculateWay === 2 ? "year" : "month",
    };
    const draft = ref(cached?.draft || adopted),
      shared = ref(cached?.shared || commonDraft);
    // Run settings were added after drafts could be cached; fill them from the saved config.
    {
      const runSettings = readRunSettings(original);
      for (const key of Object.keys(runSettings))
        if (draft.value[key] === undefined) draft.value[key] = runSettings[key];
      if (draft.value.useGlobalPace === undefined)
        draft.value.useGlobalPace = original.useGlobalRunPace === true;
    }
    // Previously unchecked salary fields were inactive drafts, not constraints.
    for (const d of [draft.value, shared.value])
      if (!d.salary) {
        d.low = null;
        d.high = null;
        d.unit = null;
      }
    if (!draft.value.sourceList) {
      const d = draft.value;
      d.sourceList = d.legacySources
        ? clone(original.jobSourceList)
        : [d.source, ...d.moreSources.filter((x) => x !== d.source)].map(
            (type) => ({
              type,
              enabled: true,
              ...(type === "search"
                ? {
                    children: (d.independentWords
                      ? d.sourceWords
                      : d.titles
                    ).map((keyword) => ({
                      type: "search-kw",
                      enabled: true,
                      keyword,
                    })),
                  }
                : {}),
            }),
          );
      for (const type of ["search", "expect", "recommend"])
        if (!d.sourceList.some((s) => s.type === type))
          d.sourceList.push({
            type,
            enabled: false,
            ...(type === "search" ? { children: [] } : {}),
          });
    }
    if (
      !draft.value.sourceList.find((s) => s.type === "search").children?.length
    )
      draft.value.sourceList.find((s) => s.type === "search").children = [
        { type: "search-kw", enabled: true, keyword: "" },
      ];
    draft.value.platformFilters ??= clone(
      original.anyCombineRecommendJobFilter || {
        cityList: [],
        salaryList: [],
        experienceList: [],
        degreeList: [],
        industryList: [],
        scaleList: [],
      },
    );
    draft.value.platformMode ??= original.combineRecommendJobFilterType || 1;
    draft.value.platformCombos ??= clone(
      original.staticCombineRecommendJobFilterConditions || [],
    );
    draft.value.skipEmpty ??=
      original.isSkipEmptyConditionForCombineRecommendJobFilter;
    const follow = ref(
      cached?.follow || {
        source:
          original.autoReminder.rechatContentSource === 2 ? "ai" : "emotion",
        opening: original.autoReminder.openContentSource === 2 ? "ai" : "fixed",
        openingText: original.autoReminder.constantOpenContent || "",
        days: original.autoReminder.rechatLimitDay,
        interval: original.autoReminder.throttleIntervalMinutes,
        roleOnly: original.autoReminder.onlyRemindBossWithExpectJobType,
        exclude: original.autoReminder.onlyRemindBossWithoutBlockCompanyName,
        context: original.autoReminder.recentMessageQuantityForLlm,
        fallback:
          original.autoReminder.rechatLlmFallback === 2 ? "stop" : "emotion",
      },
    );
    if (follow.value.source === "fixed") follow.value.source = "emotion";
    if (follow.value.opening === "platform") follow.value.opening = "fixed";
    if (!["emotion", "stop"].includes(follow.value.fallback))
      follow.value.fallback = "stop";
    const route = ref("auto"),
      dirty = ref(
        Boolean(
          initial.pendingDraft?.autoDirty || initial.pendingDraft?.followDirty,
        ),
      ),
      savedAt = ref(cached?.savedAt || ""),
      errors = ref([]);
    const validationAttempted = ref(false);
    let validationTask = "auto";
    const draftSaveState = ref(dirty.value ? "修改已保留，尚未保存" : "已保存"),
      draftSaveError = ref("");
    let draftSaveTimer;
    const preview = ref(null),
      imagePreview = ref(null),
      modal = ref(""),
      modalTitle = ref(""),
      modalRoute = ref("");
    const tasksTab = ref("current"),
      jumpStore = useRunDataJumpStore();
    const recordTab = ref("chat"),
      libraryTab = ref("jobs"),
      settingTab = ref("account");
    const platformOpen = ref(false),
      searchRotationOpen = ref(false),
      platformFiltersOpen = ref(false),
      policyExceptionsOpen = ref(false),
      activeAutoSection = ref("job-run-mode");
    // the 找岗位 configuration is a step-by-step form; this is the step on screen
    const autoStep = ref("job-run-mode"),
      // global run pace (settings → 运行节奏); paceForm is its edit copy
      globalPace = ref(null),
      paceForm = ref(null),
      paceSaving = ref(false);
    const companyEditor = ref(null),
      companyKey = ref("companies"),
      companyBusy = ref(false),
      companyError = ref("");
    let companyHost;
    const templates = ref(cached?.templates || []),
      activeTemplate = ref(cached?.activeTemplate || ""),
      templateBaseline = ref(cached?.templateBaseline || "");
    const templateName = ref(""),
      templateError = ref(""),
      templateDrafts = ref(cached?.templateDrafts || {});
    const templatePickerOpen = ref(false),
      templateMenu = ref(""),
      templateRename = ref(""),
      renameName = ref(""),
      renameError = ref(""),
      templateDelete = ref("");
    const running = ref({ auto: false, follow: false }),
      // waiting in the daemon's task queue (BOSS tasks run one at a time)
      queued = ref({ auto: false, follow: false }),
      checks = ref(""),
      preparing = ref(false),
      runtimeSteps = ref([]),
      starting = ref(false),
      stopping = ref(false),
      taskPanel = ref(false),
      shortResume = ref(false);
    const taskProgress = ref({ auto: null, follow: null }),
      progressClock = ref(Date.now());
    const progressTimer = setInterval(() => {
      progressClock.value = Date.now();
    }, 1000);
    const requestedStop = { auto: false, follow: false };
    const login = ref(initial.cookie.length > 0),
      browser = ref(Boolean(initial.browser?.executablePath));
    // empty entries (e.g. a fresh install's llm.json) show the default model in the form only;
    // the run itself still treats them as unconfigured until saved
    const formModels = (list) =>
      modelPair(list).map((m) =>
        !m.model && !m.providerCompleteApiUrl ? { ...m, ...DEFAULT_MODEL } : m,
      );
    const modelForm = ref(
      formModels(initial.modelDraft || initial.config["llm.json"]),
    );
    const otherModelsOpen = ref(false),
      browserForm = ref({ path: initial.browser?.executablePath || "" }),
      browserBusy = ref(false),
      dingtalkForm = ref({ token: "" }),
      // model ids fetched from each model's API, keyed by role
      modelLists = ref({}),
      modelListLoading = ref({}),
      modelListError = ref({}),
      dingtalkBusy = ref(false),
      browserError = ref("");
    const promptKind = ref("rechat"),
      promptText = ref("");
    const nav = [
      ["auto", "找岗位"],
      ["follow", "消息跟进"],
      ["records", "求职记录"],
      ["library", "资料库"],
      ["tasks", "任务列表"],
      ["settings", "设置"],
    ];
    // groups of the left navigation; "browse" is the 自己逛 action, not a page
    const navGroups = [
      ["逛BOSS", ["auto", "follow", "browse"]],
      ["数据", ["records", "library"]],
      ["系统", ["tasks", "settings"]],
    ];
    function navLink(key, taskCount) {
      const label = nav.find((n) => n[0] === key)[1];
      return h(
        "a",
        {
          href: "#/ux/" + key,
          "data-v-e836690d": "",
          class: route.value === key ? "router-link-active" : "",
          "aria-current": route.value === key ? "page" : undefined,
          "aria-label": navCollapsed.value ? label : undefined,
          title: navCollapsed.value ? label : undefined,
          onClick: (e) => {
            e.preventDefault();
            // the navigation entry opens the list, not the last task looked at
            if (key === "tasks") taskDetailId.value = null;
            navigate(key);
          },
        },
        [
          E("ElIcon", { class: "ux-nav-icon", size: 16 }, () => h(navIcons[key])),
          h("span", { class: "ux-nav-label" }, label),
          key === "tasks" && taskCount
            ? h(
                "span",
                {
                  class: "ux-nav-badge",
                  "aria-label": taskCount + " 个任务运行或排队中",
                },
                String(taskCount),
              )
            : null,
        ],
      );
    }
    // 自己逛: the user's own BOSS session in a browser; what they view, chat and mark is
    // still recorded in the library
    function browseLink() {
      return h(
        "a",
        {
          href: "#",
          "data-v-e836690d": "",
          class: "ux-nav-browse",
          "aria-label": navCollapsed.value ? "自己逛（打开BOSS直聘）" : undefined,
          title: navCollapsed.value
            ? "自己逛"
            : "打开已登录的BOSS直聘自己浏览；浏览、开聊、标记都会记录到资料库",
          onClick: (e) => {
            e.preventDefault();
            browseBossSelf();
          },
        },
        [
          E("ElIcon", { class: "ux-nav-icon", size: 16 }, () => h(Compass)),
          h("span", { class: "ux-nav-label" }, "自己逛"),
          E("ElIcon", { class: "ux-nav-label ux-nav-external", size: 12 }, () =>
            h(TopRight),
          ),
        ],
      );
    }
    const navIcons = {
      auto: ChatDotRound,
      follow: Bell,
      records: Document,
      library: Collection,
      tasks: List,
      settings: Setting,
    };
    // collapsed side bars are a per-device preference
    const readFlag = (key) => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    };
    const writeFlag = (key, value) => {
      try {
        localStorage.setItem(key, value ? "1" : "0");
      } catch {
        // storage unavailable: the choice lasts for this session only
      }
    };
    const navCollapsed = ref(readFlag("ux-nav-collapsed")),
      // the section rail starts folded; only a rail the user opened stays open
      railCollapsed = ref(!readFlag("ux-rail-expanded"));
    function toggleNav() {
      navCollapsed.value = !navCollapsed.value;
      writeFlag("ux-nav-collapsed", navCollapsed.value);
    }
    function toggleRail() {
      railCollapsed.value = !railCollapsed.value;
      writeFlag("ux-rail-expanded", !railCollapsed.value);
    }
    const allowedShared = [
      "titles",
      "cities",
      "salary",
      "companies",
      "excluded",
      "categories",
      "description",
      "hr",
    ];
    const cityOptions = [
      "北京",
      "上海",
      "深圳",
      "广州",
      "杭州",
      "成都",
      "武汉",
      "南京",
      "苏州",
      "西安",
      "天津",
      "重庆",
      "长沙",
      "郑州",
      "东莞",
      "佛山",
    ];
    const roleOptions = [
      "软件工程师",
      "销售专员",
      "会计",
      "机械工程师",
      "电商运营",
      "行政专员",
      "护士",
      "物流专员",
      "产品经理",
      "设计师",
    ];
    const companyExamples = [
      { label: "互联网公司示例", keywords: ["腾讯", "网易", "百度"] },
      { label: "制造业公司示例", keywords: ["美的", "海尔", "比亚迪"] },
      { label: "零售与物流公司示例", keywords: ["京东", "顺丰", "永辉"] },
    ];
    const optional = [
      ["companies", "只看这些公司"],
      ["excluded", "不看这些公司"],
      ["experience", "岗位经验要求"],
      ["categories", "职位分类关键词"],
      ["description", "岗位描述包含"],
      ["hr", "只看人事发布的岗位"],
      ["activity", "招聘者最近活跃"],
    ];
    let app = { _context: R.getCurrentInstance().appContext };
    function E(name, props = {}, children) {
      return h(
        app._context.components[name],
        props,
        typeof children === "function"
          ? { default: children }
          : children == null
            ? undefined
            : // an object of slot functions, e.g. { prepend, append } of ElInput
              !Array.isArray(children) &&
                typeof children === "object" &&
                !children.__v_isVNode &&
                Object.values(children).length &&
                Object.values(children).every((slot) => typeof slot === "function")
              ? children
              : { default: () => children },
      );
    }
    const button = (text, onClick, props = {}) =>
      E(
        "ElButton",
        {
          onClick: async (...args) => {
            try {
              await onClick(...args);
            } catch (error) {
              R.message({
                type: "error",
                message: "操作未完成：" + error.message,
              });
            }
          },
          ...props,
        },
        text,
      );
    const hint = (text) => h("p", { class: "ux-hint" }, text);
    const explain = (text) => h("p", { class: "ux-explanation" }, text);
    // the explanation stays behind a small "?" until the pointer or keyboard focus is on it
    const tip = (text, label = "说明") =>
      E(
        "ElTooltip",
        { content: text, placement: "top", showAfter: 150, popperClass: "ux-tip-popper" },
        () =>
          h(
            "span",
            { class: "ux-tip", tabindex: 0, role: "img", "aria-label": label + "：" + text },
            h(QuestionFilled),
          ),
      );
    // a control (checkbox, radio group…) followed by its explanation as a tip
    const withTip = (node, text, label) =>
      h("div", { class: "ux-with-tip" }, [node, tip(text, label)]);
    const metric = (value) =>
      h("strong", { class: "ux-metric" }, String(value));
    const alert = (text, type = "info") =>
      E("ElAlert", { title: text, type, closable: false, showIcon: true });
    // props.tip: the card's explanation, shown as a "?" after its title
    const card = (title, children, { tip: cardTip, ...props } = {}) =>
      h("section", { class: "ux-card", ...props }, [
        h("h2", cardTip ? [title, tip(cardTip, title)] : title),
        ...children,
      ]);
    // a collapsible section; the whole header row toggles it, its tip sits right after the title
    function disclosure(title, state, id, children, titleTip) {
      const toggle = () => (state.value = !state.value);
      return h(
        "section",
        { class: ["ux-disclosure", state.value ? "is-open" : ""] },
        [
          h("div", { class: "ux-disclosure-head", onClick: toggle }, [
            // the button is what keyboard and screen readers use; its click reaches the header
            h(
              "button",
              {
                type: "button",
                id: id + "-toggle",
                class: "ux-disclosure-toggle",
                "aria-expanded": state.value,
                "aria-controls": id,
              },
              [
                h(
                  "svg",
                  {
                    viewBox: "0 0 24 24",
                    width: 18,
                    height: 18,
                    "aria-hidden": "true",
                  },
                  [
                    h("path", {
                      d: "m9 5 7 7-7 7",
                      fill: "none",
                      stroke: "currentColor",
                      "stroke-width": 2,
                    }),
                  ],
                ),
                h("span", title),
              ],
            ),
            titleTip
              ? h("span", { class: "ux-disclosure-tip", onClick: (e) => e.stopPropagation() }, [
                  tip(titleTip, title),
                ])
              : null,
            h(
              "span",
              { class: "ux-disclosure-state", "aria-hidden": "true" },
              state.value ? "已展开，收起" : "已收起，展开",
            ),
          ]),
          state.value
            ? h(
                "div",
                {
                  id,
                  role: "region",
                  "aria-labelledby": id + "-toggle",
                  class: "ux-disclosure-body",
                },
                children,
              )
            : null,
        ],
      );
    }
    let imageTrigger;
    function imageButton(src, title) {
      return h(
        "button",
        {
          type: "button",
          class: "ux-image-preview",
          "aria-label": "放大查看" + title,
          onClick: (event) => {
            imageTrigger = event.currentTarget;
            imagePreview.value = { src, title };
          },
        },
        [h("img", { src, alt: title })],
      );
    }
    function closeImagePreview() {
      imagePreview.value = null;
      R.nextTick(() => imageTrigger?.isConnected && imageTrigger.focus());
    }
    function sourceTitle() {
      return inline([
        h("span", "从哪里找岗位"),
        E(
          "ElPopover",
          { trigger: "click", width: 360, placement: "bottom-start" },
          {
            reference: () =>
              button("?", () => {}, {
                circle: true,
                size: "small",
                "aria-label": "职位来源说明",
              }),
            default: () => [
              h("strong", "BOSS页面上的三个入口"),
              ...Object.values(sourceInfo).map(([name, text]) =>
                h("p", [h("strong", name + "："), text]),
              ),
              withTip(
                imageButton(
                "assets/intro-of-job-source-B4GbQdJp.png",
                "职位来源位置示意图",
              ),
                "点图片可以放大，用滚轮或下面的按钮缩放。",
              ),
            ],
          },
        ),
      ]);
    }
    let autoDirty = Boolean(initial.pendingDraft?.autoDirty),
      followDirty = Boolean(initial.pendingDraft?.followDirty);
    const modelDirty = ref(Boolean(initial.modelDraft)),
      modelBusy = ref(false),
      modelTesting = ref(false),
      modelResults = ref([]);
    function changed(scope) {
      preview.value = null;
      if (validationAttempted.value && ["auto", "follow"].includes(route.value))
        errors.value = taskErrors(validationTask);
      if (route.value === "settings") {
        modelDirty.value = true;
        modelResults.value = [];
        return;
      }
      if (scope === "follow" || (!scope && route.value === "follow"))
        followDirty = true;
      else autoDirty = true;
      dirty.value = true;
      draftSaveState.value = "保存中…";
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => persist(), 250);
    }
    function update(obj, key, value) {
      if (Array.isArray(value))
        value = [
          ...new Set(
            value
              .map((v) => (typeof v === "string" ? v.trim() : v))
              .filter((v) => v !== ""),
          ),
        ];
      obj[key] = value;
      // standalone settings forms with their own save buttons; don't mark the AI form dirty
      if (
        obj === browserForm.value ||
        obj === dingtalkForm.value ||
        obj === paceForm.value
      )
        return;
      if (["low", "high"].includes(key))
        obj.salary = obj.low != null || obj.high != null;
      if (
        obj.legacyNeedsReview?.includes(key) &&
        Array.isArray(value) &&
        value.length
      )
        obj.legacyNeedsReview = obj.legacyNeedsReview.filter((k) => k !== key);
      if (obj.legacyPatterns?.[key] && Array.isArray(value))
        delete obj.legacyPatterns[key];
      if (
        obj === draft.value &&
        ["source", "sourceWords", "moreSources", "independentWords"].includes(
          key,
        )
      )
        obj.legacySources = false;
      if (obj === companyEditor.value) return;
      changed(obj === follow.value ? "follow" : undefined);
    }
    const select = (obj, key, options, props = {}) =>
      E(
        "ElSelect",
        {
          modelValue: obj[key],
          "onUpdate:modelValue": (v) => update(obj, key, v),
          filterable: true,
          ...props,
        },
        options.map((o) =>
          E("ElOption", {
            label: Array.isArray(o) ? o[1] : o,
            value: Array.isArray(o) ? o[0] : o,
          }),
        ),
      );
    const tags = (obj, key, options, props = {}) =>
      select(obj, key, options, {
        multiple: true,
        allowCreate: true,
        defaultFirstOption: true,
        clearable: true,
        onClear: () => {
          obj.legacyNeedsReview = obj.legacyNeedsReview?.filter(
            (k) => k !== key,
          );
          update(obj, key, []);
        },
        placeholder: "输入后按回车添加，可选择多个",
        ...props,
      });
    const input = (obj, key, props = {}) =>
      E("ElInput", {
        modelValue: obj[key],
        "onUpdate:modelValue": (v) => update(obj, key, v),
        ...props,
      });
    const number = (obj, key, props = {}) =>
      E("ElInputNumber", {
        modelValue: obj[key],
        "onUpdate:modelValue": (v) => update(obj, key, v),
        min: 1,
        controlsPosition: "right",
        ...props,
      });
    const check = (obj, key, text, props = {}) =>
      E(
        "ElCheckbox",
        {
          modelValue: obj[key],
          "onUpdate:modelValue": (v) => update(obj, key, v),
          ...props,
        },
        text,
      );
    function fieldErrors(key) {
      return key ? errors.value.filter((issue) => issue.field === key) : [];
    }
    function requiredNote(key) {
      if (key === "source-selection") return "必选，至少一项";
      if (/^ai-(primary|backup)-(model|url)$/.test(key)) return "必填";
      if (key === "template-name") return "创建时必填";
      if (key === "source") return "启用搜索后必填";
      if (key === "salary" && effective().salary) return "单位必选";
      if (["follow-days", "follow-interval", "follow-context"].includes(key))
        return "必填";
      if (key === "follow-categories" && follow.value.roleOnly)
        return "启用后需设置分类";
      if (key === "rhythm" && draft.value.pause) return "启用休息后必填";
      if (key === "companies" && needsCompanyList(effective()))
        return "当前处理方式必填";
      return "";
    }
    function requiredBadge(key) {
      const note = requiredNote(key);
      return note ? h("span", { class: "ux-required" }, note) : null;
    }
    function inlineErrors(key) {
      const issues = fieldErrors(key);
      return issues.length
        ? h(
            "p",
            { id: "error-" + key, class: "ux-field-error" },
            issues.map((e) => e.text).join(" "),
          )
        : null;
    }
    function validationArea(key, children, props = {}) {
      const invalid = fieldErrors(key).length > 0;
      return h(
        "div",
        {
          ...props,
          id: "field-" + key,
          class: [
            props.class,
            "ux-validation-area",
            invalid ? "ux-field--invalid" : "",
          ],
          "data-validation-field": key,
          "data-required": Boolean(requiredNote(key)),
          "aria-invalid": invalid ? "true" : undefined,
        },
        [...children, inlineErrors(key)],
      );
    }
    function field(label, control, help = "", wide = false, id = "") {
      return h(
        "div",
        {
          class: [
            "ux-field",
            wide ? "ux-wide" : "",
            fieldErrors(id).length ? "ux-field--invalid" : "",
          ],
          id: id ? "field-" + id : undefined,
          "data-validation-field": id || undefined,
          "data-required": Boolean(requiredNote(id)),
        },
        [
          h("label", { for: id || undefined }, [
            label,
            typeof help === "string" && help ? tip(help, typeof label === "string" ? label : "说明") : null,
            requiredBadge(id),
          ]),
          control,
          inlineErrors(id),
          help && typeof help !== "string" ? hint(help) : null,
        ],
      );
    }
    const inline = (children) => h("div", { class: "ux-inline" }, children);
    const escape = (text) =>
      String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = (list) => (list.length ? list.map(escape).join("|") : "");
    function decodeKeywords(pattern) {
      if (!pattern) return [];
      const out = [""];
      for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "\\") {
          const next = pattern[++i];
          if (!next || !".*+?^${}()|[]\\".includes(next)) return null;
          out[out.length - 1] += next;
        } else if (c === "|") out.push("");
        else if (".*+?^${}()[]".includes(c)) return null;
        else out[out.length - 1] += c;
      }
      return out.every(Boolean) && regex(out) === pattern ? out : null;
    }
    function keywordDraft(d) {
      const search = d.sourceList?.find((s) => s.type === "search");
      if (search && !search.children?.length)
        search.children = [{ type: "search-kw", enabled: true, keyword: "" }];
      if (!d.regexMode) return d;
      d.legacyRulesBackup ??= clone({
        regexTitle: d.regexTitle,
        regexType: d.regexType,
        regexDesc: d.regexDesc,
        regexExclude: d.regexExclude,
        regexLogic: d.regexLogic,
      });
      d.legacyNeedsReview = [];
      for (const [key, raw] of [
        ["titles", "regexTitle"],
        ["categories", "regexType"],
        ["description", "regexDesc"],
        ["excluded", "regexExclude"],
      ]) {
        const words = decodeKeywords(d[raw] || "");
        if (words && (key !== "description" || words.length <= 1))
          d[key] = words;
        else {
          d[key] = [];
          d.legacyNeedsReview.push(key);
        }
      }
      d.regexMode = false;
      return d;
    }
    function effective() {
      const value = clone(draft.value);
      if (value.inherit)
        for (const key of value.inheritedFields) {
          if (key === "salary")
            for (const x of ["salary", "low", "high", "unit"])
              value[x] = shared.value[x];
          else value[key] = clone(shared.value[key]);
        }
      // Preserve each inherited expression, including partial overrides of the backend group.
      const group = ["titles", "categories", "description"];
      if (
        value.inherit &&
        shared.value.regexMode &&
        [...group, "excluded"].some((k) => value.inheritedFields.includes(k))
      )
        value.regexMode = true;
      if (value.inherit && value.regexMode) {
        for (const [key, pattern] of [
          ["titles", "regexTitle"],
          ["categories", "regexType"],
          ["description", "regexDesc"],
          ["excluded", "regexExclude"],
        ]) {
          const src = value.inheritedFields.includes(key)
            ? shared.value
            : draft.value;
          value[pattern] = src.regexMode
            ? src[pattern]
            : key === "description"
              ? src.description
                  .map(escape)
                  .map((v) => `(?=[\\s\\S]*${v})`)
                  .join("")
              : regex(src[key]);
        }
        if (group.every((k) => value.inheritedFields.includes(k)))
          value.regexLogic = shared.value.regexLogic;
      }
      value.salary = value.low != null || value.high != null;
      return value;
    }
    // Retire the second preference entry without dropping previously inherited values.
    if (draft.value.inherit) {
      draft.value = effective();
      draft.value.inherit = false;
      draft.value.inheritedFields = [];
    }
    keywordDraft(draft.value);
    keywordDraft(shared.value);
    function templateSnapshot() {
      const d = effective();
      d.inherit = false;
      d.inheritedFields = [];
      return d;
    }
    function templateModified() {
      return (
        Boolean(activeTemplate.value) &&
        JSON.stringify(templateSnapshot()) !== templateBaseline.value
      );
    }
    async function writeTemplateState(
      items,
      id,
      baseline,
      nextDraft = draft.value,
      nextTemplateDrafts = templateDrafts.value,
    ) {
      try {
        await native.saveUx({
          draft: nextDraft,
          shared: shared.value,
          follow: follow.value,
          savedAt: savedAt.value,
          templates: items,
          activeTemplate: id,
          templateBaseline: baseline,
          templateDrafts: nextTemplateDrafts,
        });
        return true;
      } catch (error) {
        templateError.value = "模板未保存：" + error.message;
        R.message({
          type: "error",
          offset: 70,
          customClass: "ux-template-feedback",
          message: templateError.value,
        });
        return false;
      }
    }
    function clearTemplateActions() {
      templateMenu.value = "";
      templateRename.value = "";
      templateDelete.value = "";
      renameError.value = "";
      templateError.value = "";
    }
    function openTemplate() {
      templatePickerOpen.value = false;
      clearTemplateActions();
      templateName.value = "";
      modal.value = "template";
    }
    async function restoreTemplate(record) {
      if (!(await flushDraft())) return;
      if (templates.value.some((t) => t.id === record.item.id)) {
        R.message({ message: "此模板已恢复", type: "info" });
        return;
      }
      if (templates.value.some((t) => t.name === record.item.name)) {
        R.message({
          message: "已有同名模板，请先改名后再撤销删除",
          type: "error",
        });
        return;
      }
      const items = clone(templates.value);
      items.splice(Math.min(record.index, items.length), 0, record.item);
      const reselect =
        record.selected &&
        !activeTemplate.value &&
        JSON.stringify(templateSnapshot()) === record.draft;
      const id = reselect ? record.item.id : activeTemplate.value,
        baseline = reselect ? record.baseline : templateBaseline.value;
      const drafts = clone(templateDrafts.value);
      if (record.pendingDraft) drafts[record.item.id] = record.pendingDraft;
      if (!(await writeTemplateState(items, id, baseline, draft.value, drafts)))
        return;
      templates.value = items;
      activeTemplate.value = id;
      templateBaseline.value = baseline;
      templateDrafts.value = drafts;
      R.message({
        type: "success",
        offset: 70,
        customClass: "ux-template-feedback",
        message: "已恢复模板“" + record.item.name + "”",
      });
      return true;
    }
    function templateNameError(name, target = "") {
      if (!name || name.length > 40) return "请输入1—40个字符的模板名。";
      if (templates.value.some((t) => t.name === name && t.id !== target))
        return "已有同名模板，请换一个名称。";
      return "";
    }
    let templateSaving = false;
    async function commitTemplate(
      action = "new",
      name = templateName.value.trim(),
      target = activeTemplate.value,
    ) {
      if (templateSaving) return;
      if (!(await flushDraft())) {
        templateError.value = "当前草稿保存失败，请重试后管理模板。";
        return;
      }
      if (running.value.auto) return;
      const items = clone(templates.value),
        current = items.find((t) => t.id === target),
        drafts = clone(templateDrafts.value);
      if (["new", "rename"].includes(action)) {
        templateError.value = templateNameError(
          name,
          action === "rename" ? target : "",
        );
        if (templateError.value) return;
      }
      let id = activeTemplate.value,
        baseline = templateBaseline.value;
      if (action === "new") {
        if (id && templateModified()) drafts[id] = templateSnapshot();
        id =
          globalThis.crypto?.randomUUID?.() ||
          "template-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        const snapshot = templateSnapshot();
        items.push({ id, name, snapshot });
        baseline = JSON.stringify(snapshot);
      } else if (!current) {
        templateError.value = "请先选择一个模板。";
        return;
      } else if (action === "rename") current.name = name;
      else if (action === "update") {
        current.snapshot = templateSnapshot();
        baseline = JSON.stringify(current.snapshot);
        delete drafts[current.id];
      }
      let deleted;
      if (action === "delete") {
        const index = items.findIndex((t) => t.id === current.id);
        deleted = {
          item: clone(current),
          index,
          selected: id === current.id,
          baseline,
          draft: JSON.stringify(templateSnapshot()),
          pendingDraft:
            id === current.id && templateModified()
              ? templateSnapshot()
              : drafts[current.id],
        };
        items.splice(index, 1);
        delete drafts[current.id];
        if (id === current.id) {
          id = "";
          baseline = "";
        }
      }
      templateSaving = true;
      let written;
      try {
        written = await writeTemplateState(
          items,
          id,
          baseline,
          draft.value,
          drafts,
        );
      } finally {
        templateSaving = false;
      }
      if (!written) return;
      templates.value = items;
      activeTemplate.value = id;
      templateBaseline.value = baseline;
      templateDrafts.value = drafts;
      clearTemplateActions();
      if (action === "new") modal.value = "";
      if (deleted) {
        let undoToast;
        undoToast = R.message({
          type: "success",
          duration: 8000,
          message: "已删除模板“" + deleted.item.name + "”",
          action: {
            label: "撤销",
            onClick: async () => {
              if (await restoreTemplate(deleted)) undoToast?.close();
            },
          },
        });
      } else
        R.message({
          type: "success",
          offset: 70,
          customClass: "ux-template-feedback",
          message:
            action === "rename"
              ? "模板已重命名"
              : action === "update"
                ? "当前模板已保存"
                : "模板已创建并保存；后续修改后再保存模板",
        });
      return true;
    }
    async function applyTemplate(id) {
      if (!(await flushDraft())) return;
      const t = templates.value.find((x) => x.id === id);
      if (!t || running.value.auto) return;
      const drafts = clone(templateDrafts.value);
      if (activeTemplate.value) {
        if (templateModified())
          drafts[activeTemplate.value] = templateSnapshot();
        else delete drafts[activeTemplate.value];
      }
      const saved = keywordDraft(clone(t.snapshot)),
        next = keywordDraft(clone(drafts[id] || saved));
      // templates saved before the run settings existed keep the current values
      for (const target of [saved, next])
        for (const key of Object.keys(readRunSettings({})))
          if (target[key] === undefined) target[key] = draft.value[key];
      const baseline = JSON.stringify(saved);
      if (
        !(await writeTemplateState(templates.value, id, baseline, next, drafts))
      )
        return;
      draft.value = next;
      activeTemplate.value = id;
      templateBaseline.value = baseline;
      templateDrafts.value = drafts;
      changed();
      R.message({
        type: "success",
        offset: 70,
        customClass: "ux-template-feedback",
        message: drafts[id]
          ? "已恢复“" + t.name + "”的未保存修改"
          : "已选中“" + t.name + "”，可直接修改下面的条件",
      });
    }
    function selectTemplate(id) {
      templatePickerOpen.value = false;
      clearTemplateActions();
      if (id !== activeTemplate.value) applyTemplate(id);
    }
    function saveTemplate() {
      document.activeElement?.blur();
      templateError.value = "";
      commitTemplate("update");
    }
    function templateItemMenu(t) {
      return button(
        "⋯",
        () => {
          const next = templateMenu.value === t.id ? "" : t.id;
          clearTemplateActions();
          templateMenu.value = next;
        },
        {
          link: true,
          "data-template-id": t.id,
          "aria-label": "管理模板" + t.name,
          "aria-expanded": templateMenu.value === t.id,
          disabled: running.value.auto,
        },
      );
    }
    function focusTemplateMenu(id) {
      R.nextTick(() =>
        [...document.querySelectorAll("[data-template-id]")]
          .find((el) => el.getAttribute("data-template-id") === id)
          ?.focus(),
      );
    }
    function cancelTemplateRename(t) {
      templateRename.value = "";
      renameError.value = "";
      focusTemplateMenu(t.id);
    }
    function startTemplateRename(t) {
      templateRename.value = t.id;
      templateDelete.value = "";
      renameName.value = t.name;
      renameError.value = "";
      R.nextTick(() => {
        const el = document.querySelector(".ux-template-rename input");
        el?.focus();
        el?.select();
      });
    }
    async function saveTemplateName(t) {
      renameError.value = templateNameError(renameName.value.trim(), t.id);
      if (renameError.value) return;
      if (await commitTemplate("rename", renameName.value.trim(), t.id))
        focusTemplateMenu(t.id);
      else renameError.value = templateError.value;
    }
    function templateIcon(kind) {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 14,
          height: 14,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 1.8,
          "aria-hidden": "true",
        },
        kind === "rename"
          ? [
              h("path", {
                d: "m15 5 4 4M4 20l4-1 12-12a3 3 0 0 0-4-4L5 16l-1 4Z",
              }),
            ]
          : [
              h("path", {
                d: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
              }),
            ],
      );
    }
    function templateActions(t) {
      if (templateRename.value === t.id)
        return h(
          "form",
          {
            class: "ux-template-rename",
            onSubmit: (e) => {
              e.preventDefault();
              saveTemplateName(t);
            },
            onKeydown: (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelTemplateRename(t);
              }
            },
          },
          [
            h("label", { for: "template-rename-name" }, "模板名称"),
            h("div", { class: "ux-template-rename-controls" }, [
              E("ElInput", {
                id: "template-rename-name",
                modelValue: renameName.value,
                "onUpdate:modelValue": (v) => {
                  renameName.value = v;
                  renameError.value = "";
                },
                onBlur: () =>
                  (renameError.value = templateNameError(
                    renameName.value.trim(),
                    t.id,
                  )),
                maxlength: 40,
                "aria-label": "新的模板名称",
                "aria-invalid": Boolean(renameError.value),
                "aria-describedby": renameError.value
                  ? "template-rename-error"
                  : undefined,
              }),
              button("保存", () => {}, {
                nativeType: "submit",
                size: "small",
                type: "primary",
                "aria-label": "保存模板名称",
              }),
              button("取消", () => cancelTemplateRename(t), {
                size: "small",
                "aria-label": "取消重命名",
              }),
            ]),
            renameError.value
              ? h(
                  "p",
                  {
                    id: "template-rename-error",
                    class: "ux-error",
                    role: "alert",
                  },
                  renameError.value,
                )
              : null,
          ],
        );
      if (templateDelete.value === t.id)
        return h(
          "div",
          {
            class: "ux-template-delete",
            role: "group",
            "aria-label": "删除模板" + t.name + "确认",
          },
          [
            h("p", "删除模板“" + t.name + "”？"),
            hint("只删除此模板，当前页面条件和其他模板保留。"),
            h("div", { class: "ux-template-item-actions" }, [
              button(
                "取消",
                () => {
                  templateDelete.value = "";
                  templateError.value = "";
                  focusTemplateMenu(t.id);
                },
                { size: "small", "aria-label": "取消删除模板" },
              ),
              button("确认删除", () => commitTemplate("delete", "", t.id), {
                size: "small",
                type: "danger",
                "aria-label": "确认删除模板" + t.name,
              }),
            ]),
            templateError.value
              ? h(
                  "p",
                  { class: "ux-error", role: "alert" },
                  templateError.value,
                )
              : null,
          ],
        );
      return h("div", { class: "ux-template-item-actions" }, [
        button(
          [templateIcon("rename"), h("span", "重命名")],
          () => startTemplateRename(t),
          {
            size: "small",
            "aria-label": "重命名模板" + t.name,
          },
        ),
        button(
          [templateIcon("delete"), h("span", "删除模板")],
          () => {
            templateDelete.value = t.id;
            templateError.value = "";
          },
          {
            size: "small",
            type: "danger",
            plain: true,
            "aria-label": "删除模板" + t.name,
          },
        ),
      ]);
    }
    function templateItem(t) {
      return h("div", { role: "listitem", key: t.id }, [
        h(
          "div",
          {
            class: [
              "ux-template-item",
              t.id === activeTemplate.value ? "is-selected" : "",
            ],
          },
          [
            button(t.name, () => selectTemplate(t.id), {
              link: true,
              class: "ux-template-name",
              "aria-label": "使用模板" + t.name,
              disabled: running.value.auto,
            }),
            t.id === activeTemplate.value
              ? h("span", { class: "ux-hint" }, "当前")
              : null,
            templateItemMenu(t),
          ],
        ),
        templateMenu.value === t.id ? templateActions(t) : null,
      ]);
    }
    function templatePicker() {
      return h(
        "div",
        {
          class: "el-popper is-light el-popover ux-template-picker",
          role: "dialog",
          "aria-label": "配置模板列表",
        },
        [
          h("p", { class: "ux-template-picker-title" }, [
            "选择要使用的模板",
            tip("选中一个模板后，直接在下面改条件就行；点模板右边的“⋯”可以改名或删除。", "选择要使用的模板"),
          ]),
          templates.value.length
            ? h(
                "div",
                { class: "ux-template-list", role: "list" },
                templates.value.map(templateItem),
              )
            : hint("还没有模板。先新建并命名，再修改下面的条件。"),
        ],
      );
    }
    function templateBar() {
      return h("div", { class: "ux-template-bar" }, [
        h("span", { class: "ux-template-label" }, [
          h("label", { id: "template-label" }, "配置模板"),
          E(
            "ElPopover",
            { trigger: "click", width: 320, placement: "bottom-start" },
            {
              reference: () =>
                button("?", () => {}, {
                  circle: true,
                  size: "small",
                  "aria-label": "模板包含哪些设置",
                }),
              default: () => [
                h("p", "模板保存求职条件、职位来源、处理方式与运行节奏。"),
                hint("选择模板不会切换消息跟进、消息内容或AI配置。"),
              ],
            },
          ),
        ]),
        h("span", { class: "ux-template-trigger" }, [
          button(
            [
              h(
                "span",
                templates.value.find((t) => t.id === activeTemplate.value)
                  ?.name ||
                  (templates.value.length ? "选择模板" : "先新建一个模板"),
              ),
              h(
                "svg",
                {
                  width: 14,
                  height: 14,
                  viewBox: "0 0 24 24",
                  "aria-hidden": "true",
                },
                [
                  h("path", {
                    d: "m6 9 6 6 6-6",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 2,
                  }),
                ],
              ),
            ],
            () => {
              templatePickerOpen.value = !templatePickerOpen.value;
              if (!templatePickerOpen.value) clearTemplateActions();
            },
            {
              class: "ux-template-select",
              disabled: running.value.auto,
              "aria-label": "选择配置模板",
              "aria-haspopup": "dialog",
              "aria-expanded": templatePickerOpen.value,
            },
          ),
          templatePickerOpen.value ? templatePicker() : null,
        ]),
        h(
          "span",
          { class: "ux-template-status", role: "status" },
          activeTemplate.value
            ? templateModified()
              ? "模板待保存"
              : "模板已保存"
            : "未选择",
        ),
        button("新建模板", openTemplate, {
          size: "small",
          type: undefined,
          plain: true,
          disabled: running.value.auto,
        }),
        button("保存模板", saveTemplate, {
          size: "small",
          type: "primary",
          disabled:
            running.value.auto || !activeTemplate.value || !templateModified(),
          "aria-label": "保存当前模板",
        }),
      ]);
    }
    async function persist() {
      const stamp = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const captured = {
        draft: clone(draft.value),
        shared: clone(shared.value),
        follow: clone(follow.value),
        savedAt: stamp,
        templates: clone(templates.value),
        activeTemplate: activeTemplate.value,
        templateBaseline: templateBaseline.value,
        templateDrafts: clone(templateDrafts.value),
      };
      const patch = {};
      let pending = false;
      if (autoDirty) {
        if (!validation(captured.draft).length)
          Object.assign(patch, configForDraft(captured.draft));
        else pending = true;
      }
      if (followDirty) {
        if (!followErrors(captured.follow).length)
          Object.assign(
            patch,
            configForFollowOnly(captured.follow, captured.draft, {
              ...native.state().config["boss.json"],
              ...patch,
            }),
          );
        else pending = true;
      }
      try {
        await native.saveUx(captured, Object.keys(patch).length ? patch : null);
      } catch (error) {
        draftSaveState.value = "保存失败";
        draftSaveError.value = "保存失败，请保留页面并重试：" + error.message;
        return false;
      }
      savedAt.value = stamp;
      dirty.value =
        JSON.stringify(captured.draft) !== JSON.stringify(draft.value) ||
        JSON.stringify(captured.follow) !== JSON.stringify(follow.value);
      draftSaveState.value = pending
        ? "草稿已保存（条件待完善）"
        : "已自动保存";
      draftSaveError.value = "";
      if (!dirty.value) {
        autoDirty = false;
        followDirty = false;
      }
      return true;
    }
    // settings every run uses, whatever the run mode
    function runConfig(d) {
      // the global pace is read when the configuration is saved (begin() loads it first)
      const pace = d.useGlobalPace && globalPace.value ? globalPace.value : d;
      return {
        autoChatRunMode: d.runMode === "collect" ? "collect" : "chat",
        collectOnlyMatchingJobs: d.collectOnlyMatchingJobs !== false,
        skipUnparseableSalaryJob: d.skipUnparseableSalaryJob !== false,
        useGlobalRunPace: Boolean(d.useGlobalPace),
        isSageTimeEnabled: pace.pause,
        ...(pace.pause
          ? { sageTimeOpTimes: pace.actions, sageTimePauseMinute: pace.minutes }
          : {}),
        jobListLoadWaitSeconds: waitSeconds(
          pace.jobListLoadWaitSeconds,
          DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
        ),
        jobDetailViewWaitSeconds: waitSeconds(
          pace.jobDetailViewWaitSeconds,
          DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS,
        ),
      };
    }
    function basicToConfig(d) {
      // collecting every job uses no conditions: the saved ones stay as they are and are
      // checked again once a mode that uses them is chosen
      if (isCollectAll(d)) return runConfig(d);
      if (d.legacyNeedsReview?.length)
        throw new Error("请重新填写或确认旧筛选条件，避免扩大筛选范围。");
      const hasSalary = d.low != null || d.high != null;
      if (hasSalary && !["month", "year"].includes(d.unit))
        throw new Error("填写薪资金额后，请选择薪资单位。");
      return {
        expectCityList: d.cities,
        expectSalaryCalculateWay: d.unit === "year" ? 2 : 1,
        expectSalaryLow:
          hasSalary && d.low != null
            ? d.low / (d.unit === "month" ? 1000 : 1)
            : null,
        expectSalaryHigh:
          hasSalary && d.high != null
            ? d.high / (d.unit === "month" ? 1000 : 1)
            : null,
        expectCompanies: d.companies.join(","),
        blockCompanyNameRegExpStr: d.regexMode
          ? d.regexExclude
          : d.legacyPatterns?.excluded || regex(d.excluded),
        expectJobNameRegExpStr: d.regexMode
          ? d.regexTitle
          : d.legacyPatterns?.titles || regex(d.titles),
        expectJobTypeRegExpStr: d.regexMode
          ? d.regexType
          : d.legacyPatterns?.categories || regex(d.categories),
        expectJobDescRegExpStr: d.regexMode
          ? d.regexDesc
          : d.legacyPatterns?.description ||
            d.description
              .map(escape)
              .map((v) => `(?=[\\s\\S]*${v})`)
              .join(""),
        jobDetailRegExpMatchLogic: d.regexLogic || 1,
        isPosterHrFilterEnabled: d.hr,
        posterHrTitleRegExpStr:
          d.hrRule ??
          (original.fieldsForUseCommonConfig?.jobDetail ? common : original)
            .posterHrTitleRegExpStr,
        ...runConfig(d),
        expectWorkExpList: d.experience
          .map(
            (v) =>
              ({
                经验不限: 101,
                应届生: 102,
                "1年以内": 103,
                "1-3年": 104,
                "3-5年": 105,
                "5-10年": 106,
                "10年以上": 107,
              })[v],
          )
          .filter(Boolean),
        jobNotMatchStrategy: d.overrides.title || d.strategy,
        expectCityNotMatchStrategy: d.overrides.city || d.strategy,
        expectSalaryNotMatchStrategy: d.overrides.salary || d.strategy,
        expectWorkExpNotMatchStrategy: d.overrides.experience || d.strategy,
        blockCompanyNameRegMatchStrategy: d.overrides.company || d.strategy,
        posterHrNotMatchStrategy: d.overrides.hr || d.strategy,
        jobNotActiveStrategy: d.overrides.activity || d.strategy,
        markAsNotActiveSelectedTimeRange:
          d.activity === "不限"
            ? 0
            : Math.max(0, activeLabels.indexOf(d.activity) - 1),
        fieldsForUseCommonConfig: {
          city: false,
          salary: false,
          expectCompanies: false,
          blockCompanyNameRegExpStr: false,
          jobDetail: false,
        },
        strategyScopeOptionWhenMarkJobCityNotMatch: d.scopes.city || 2,
        strategyScopeOptionWhenMarkSalaryNotMatch: d.scopes.salary || 2,
        strategyScopeOptionWhenMarkJobWorkExpNotMatch: d.scopes.experience || 2,
      };
    }
    function configForDraft(d) {
      return {
        ...basicToConfig(d),
        jobSourceList: clone(d.sourceList).map((s) => ({
          ...s,
          ...(s.type === "search"
            ? {
                children: searchOptionsForRun(d, s),
              }
            : {}),
        })),
        anyCombineRecommendJobFilter: clone(d.platformFilters),
        combineRecommendJobFilterType: d.platformMode,
        staticCombineRecommendJobFilterConditions: clone(d.platformCombos),
        isSkipEmptyConditionForCombineRecommendJobFilter: d.skipEmpty,
      };
    }
    function configForFollow(f) {
      return {
        ...original.autoReminder,
        rechatLimitDay: f.days,
        throttleIntervalMinutes: f.interval,
        recentMessageQuantityForLlm: f.context,
        onlyRemindBossWithExpectJobType: f.roleOnly,
        onlyRemindBossWithoutBlockCompanyName: f.exclude,
        rechatContentSource: f.source === "ai" ? 2 : 1,
        openContentSource: f.opening === "ai" ? 2 : 1,
        constantOpenContent: f.openingText,
        rechatLlmFallback: f.fallback === "emotion" ? 1 : 2,
      };
    }
    function configForFollowOnly(f, d, bossOverride) {
      const current = native.state().config,
        boss = bossOverride || current["boss.json"],
        common = current["common-job-condition-config.json"],
        flags = { ...(boss.fieldsForUseCommonConfig || {}) };
      const patch = { autoReminder: configForFollow(f) };
      if (f.roleOnly && !d.legacyNeedsReview?.includes("categories")) {
        const source = flags.jobDetail ? common : boss;
        for (const key of [
          "expectJobNameRegExpStr",
          "expectJobDescRegExpStr",
          "jobDetailRegExpMatchLogic",
          "isPosterHrFilterEnabled",
          "posterHrTitleRegExpStr",
        ])
          patch[key] = source[key];
        patch.expectJobTypeRegExpStr =
          d.legacyPatterns?.categories || regex(d.categories);
        flags.jobDetail = false;
      }
      if (f.exclude && !d.legacyNeedsReview?.includes("excluded")) {
        patch.blockCompanyNameRegExpStr =
          d.legacyPatterns?.excluded || regex(d.excluded);
        flags.blockCompanyNameRegExpStr = false;
      }
      patch.fieldsForUseCommonConfig = flags;
      return patch;
    }
    async function save(
      show = true,
      task = route.value === "follow" ? "follow" : "auto",
    ) {
      clearTimeout(draftSaveTimer);
      const errs = taskErrors(task);
      if (errs.length) {
        presentErrors(errs, task);
        return false;
      }
      if (task === "auto") autoDirty = true;
      else followDirty = true;
      const ok = await persist();
      if (ok && show) R.message({ type: "success", message: "当前配置已保存" });
      return ok;
    }

    function needsCompanyList(d) {
      return ["city", "salary", "experience"].some(
        (key) =>
          (key === "city"
            ? d.cities.length
            : key === "salary"
              ? d.salary
              : d.experience.length) &&
          (d.overrides[key] || d.strategy) === 1 &&
          (d.scopes[key] || 2) === 2,
      );
    }
    function taskErrors(task) {
      if (task === "auto") return validation(effective());
      const issues = followIssues(follow.value),
        d = effective();
      if (
        follow.value.roleOnly &&
        ((!d.categories.length && !d.legacyPatterns?.categories) ||
          d.legacyNeedsReview?.includes("categories"))
      )
        issues.push({
          field: "follow-categories",
          text: "请设置职位分类，或关闭“只跟进这些职位分类”。",
        });
      if (follow.value.exclude && d.legacyNeedsReview?.includes("excluded"))
        issues.push({
          field: "follow-excluded",
          text: "请确认排除公司条件，或关闭公司排除。",
        });
      return issues;
    }
    function presentErrors(issues, task) {
      validationAttempted.value = true;
      validationTask = task;
      errors.value = issues;
      if (!issues.length) return;
      R.message.closeAll?.();
      R.message({
        type: "error",
        message: "还不能开始：" + issues[0].text,
        duration: 5000,
        showClose: true,
      });
      focusError(issues[0]);
    }
    // collect mode without "只收集符合求职条件的岗位" saves every job: conditions and the
    // not-matching policy don't apply
    const isCollectAll = (d) =>
      d.runMode === "collect" && d.collectOnlyMatchingJobs === false;
    function validation(d) {
      const a = [];
      if (!isCollectAll(d)) conditionIssues(d, a);
      sourceIssues(d, a);
      if (
        !d.useGlobalPace &&
        d.pause &&
        (!Number.isInteger(d.actions) ||
          d.actions < 1 ||
          !Number.isFinite(d.minutes) ||
          d.minutes < 0)
      )
        a.push({
          field: "rhythm",
          text: "休息前操作次数须为正整数，休息时长不能留空或小于0。",
        });
      return a;
    }
    function conditionIssues(d, a) {
      for (const field of d.legacyNeedsReview || [])
        a.push({
          field,
          text: "旧筛选条件已备份，请填写关键词或明确取消该项限制。",
        });
      if (d.regexMode) {
        for (const [key, label] of [
          ["regexTitle", "岗位名称"],
          ["regexType", "岗位类别"],
          ["regexDesc", "岗位描述"],
          ["regexExclude", "排除公司"],
        ])
          if (d[key])
            try {
              new RegExp(d[key], "i");
            } catch {
              a.push({
                field: key,
                text: `${label}正则格式错误，请检查括号或转义符。`,
              });
            }
      }
      if (needsCompanyList(d) && !d.companies.length)
        a.push({
          field: "companies",
          text: "只标记指定公司需要公司名单。请填写“只看这些公司”，或改为略过岗位。",
        });
      for (const [key, pattern] of Object.entries(d.legacyPatterns || {}))
        try {
          new RegExp(pattern, "im");
        } catch {
          a.push({ field: key, text: "原有规则格式无效，请改用关键词。" });
        }
      for (const key of ["low", "high"])
        if (d[key] != null && (!Number.isFinite(d[key]) || d[key] < 0))
          a.push({ field: "salary", text: "薪资须为非负数。" });
      if (d.salary && d.low != null && d.high != null && d.low > d.high)
        a.push({
          field: "salary",
          text: "薪资上限不能低于下限，请修改上限或下限。",
        });
      if (d.salary && !["month", "year"].includes(d.unit))
        a.push({ field: "salary", text: "填写薪资金额后，请选择薪资单位。" });
    }
    function sourceIssues(d, a) {
      if (d.sourceList) {
        if (!d.sourceList.some((s) => s.enabled))
          a.push({
            field: "source-selection",
            text: "请选择至少一个职位来源。",
          });
        const search = d.sourceList.find(
          (s) => s.type === "search" && s.enabled,
        );
        const searchRows = searchOptionsForRun(d, search);
        if (search && !searchRows.some((c) => c.enabled && c.keyword))
          a.push({
            field: "source",
            text: "请输入搜索内容，或取消搜索结果来源。",
          });
        if (
          search &&
          searchRows.some((c) => c.enabled && c.keyword.length > 50)
        )
          a.push({ field: "source", text: "每个搜索词最多50个字符。" });
      } else {
        if (
          d.source === "search" &&
          d.independentWords &&
          !d.sourceWords.length
        )
          a.push({ field: "source", text: "请输入搜索内容。" });
        if (
          d.source === "search" &&
          d.regexMode &&
          !d.titles.length &&
          !d.sourceWords.length
        )
          a.push({ field: "source", text: "请输入用于BOSS搜索的普通关键词。" });
      }
    }
    function focusError(e) {
      if (e.action === "model") {
        navigate("settings");
        settingTab.value = "ai";
        return;
      }
      if (e.action === "resume") {
        openLegacy("简历编辑", "/resumeEditor");
        return;
      }
      if (e.action === "prompt") {
        openPrompt(e.prompt || "rechat");
        return;
      }
      if (e.field === "companies") {
        openCompanies("companies");
        companyError.value = e.text;
        return;
      }
      if (route.value === "auto" && stepOfField(e.field)) {
        autoStep.value = stepOfField(e.field);
        activeAutoSection.value = autoStep.value;
      }
      const extra = {
        regexTitle: "titles",
        regexType: "categories",
        regexDesc: "description",
        regexExclude: "excluded",
        categories: "categories",
        description: "description",
        excluded: "excluded",
      }[e.field];
      R.nextTick(() => {
        const target =
          document.getElementById("field-" + e.field) ||
          document.getElementById(e.field) ||
          (extra &&
            (document.getElementById("field-" + extra) ||
              document.querySelector('[data-condition="' + extra + '"]'))) ||
          document.getElementById("validation-summary");
        target?.scrollIntoView({ block: "center", behavior: "auto" });
        spotlight(target);
        const control = target?.querySelector(
          e.field?.startsWith("follow-") &&
            ["follow-categories", "follow-excluded"].includes(e.field)
            ? "button:not(:disabled)"
            : 'input:not(:disabled):not([type="checkbox"]),textarea:not(:disabled),button:not(:disabled),input:not(:disabled)',
        );
        (control || target)?.focus({ preventScroll: true });
      });
    }
    // Marks the field an unfinished item points to until the user starts on it, so it is
    // obvious where to fill in after the page has scrolled there.
    let spotlit = null,
      spotlightTimer;
    function clearSpotlight() {
      clearTimeout(spotlightTimer);
      spotlit?.classList.remove("ux-spotlight");
      spotlit?.removeAttribute("data-spotlight");
      spotlit = null;
    }
    function spotlight(el, label = "在这里填写") {
      if (!el || el.id === "validation-summary") return;
      clearSpotlight();
      // restart the pulse when the same field is pointed at again
      void el.offsetWidth;
      el.classList.add("ux-spotlight");
      el.setAttribute("data-spotlight", label);
      spotlit = el;
      for (const type of ["input", "change", "click"])
        el.addEventListener(type, () => spotlit === el && clearSpotlight(), {
          once: true,
          capture: true,
        });
      spotlightTimer = setTimeout(clearSpotlight, 10 * 1000);
    }
    function syncValidationAccessibility() {
      document.querySelectorAll("[data-validation-field]").forEach((area) => {
        const key = area.dataset.validationField,
          invalid = fieldErrors(key).length > 0;
        area
          .querySelectorAll('input,textarea,[role="combobox"]')
          .forEach((control) => {
            control.setAttribute("aria-invalid", String(invalid));
            const ids = (control.getAttribute("aria-describedby") || "")
              .split(/\s+/)
              .filter((id) => id && !id.startsWith("error-"));
            if (invalid) ids.push("error-" + key);
            if (ids.length)
              control.setAttribute("aria-describedby", ids.join(" "));
            else control.removeAttribute("aria-describedby");
            if (key !== "source-selection") {
              const required =
                Boolean(requiredNote(key)) &&
                (key !== "salary" ||
                  control.getAttribute("role") === "combobox");
              control.setAttribute("aria-required", String(required));
            }
          });
      });
    }
    R.watchPostEffect(() => {
      errors.value;
      route.value;
      modal.value;
      draft.value.salary;
      draft.value.pause;
      follow.value.source;
      syncValidationAccessibility();
    });
    function problems(items) {
      return items.length
        ? h(
            "div",
            {
              role: "alert",
              id: "validation-summary",
              class: "ux-problems",
              tabIndex: -1,
            },
            [
              alert("还有 " + items.length + " 项需要完善", "error"),
              ...items.map((e) =>
                button(
                  e.label ? e.text + "（" + e.label + "）" : e.text,
                  () => focusError(e),
                  {
                    link: true,
                    type: "danger",
                  },
                ),
              ),
            ],
          )
        : null;
    }
    async function openLegacy(title, path) {
      const channels = {
        "/cookieAssistant": "login-with-cookie-assistant",
        "/resumeEditor": "resume-edit",
        "/browserAssistant": "config-with-browser-assistant",
        "/llmConfig": "llm-config",
      };
      const channel = channels[path];
      if (!channel) return;
      try {
        await window.electron.ipcRenderer.invoke(channel);
        if (path === "/cookieAssistant") refreshLoginStatus();
      } catch (error) {
        if (!/cancel/i.test(error.message))
          R.message({ type: "error", message: "未完成设置：" + error.message });
      } finally {
        try {
          const s = await native.refresh();
          login.value = s.cookie.length > 0;
          browser.value = Boolean(s.browser?.executablePath);
          browserForm.value.path = s.browser?.executablePath || "";
          if (!modelDirty.value)
            modelForm.value = formModels(s.config["llm.json"]);
        } catch {
          R.message({ type: "warning", message: "无法重新读取设置，请重试。" });
        }
      }
    }
    const dataComponents = {
      JobLibrary,
      BossLibrary,
      CompanyLibrary,
      StartChatRecord,
      MarkAsNotSuitRecord,
      FavoriteJobs,
    };
    function legacyFrame(path, key = "legacy") {
      const name = path.split("/").pop();
      return dataComponents[name]
        ? h(dataComponents[name], { key, class: "ux-native-data" })
        : null;
    }
    function fieldLocation(key, label) {
      const company = ["companies", "excluded"].includes(key),
        category = key === "categories";
      const src =
        "assets/" +
        (company
          ? "intro-of-job-entry-CigFWFYM.png"
          : category
            ? "job-type-source-entry-CB34JKuE.png"
            : "intro-of-job-info-PO2RohzI.png");
      const text = company
        ? "对应BOSS职位卡片中，Logo旁的公司品牌名称，不是招聘者姓名。"
        : category
          ? "在BOSS顶部“职位类型”筛选中查看分类；它与岗位详情里的职位名称不同。"
          : key === "description"
            ? "对应右侧岗位详情中的“职位描述”正文，不是职位标题。"
            : "对应右侧岗位详情上方的职位名称。";
      return E(
        "ElPopover",
        {
          trigger: "click",
          width: Math.min(520, innerWidth - 32),
          placement: "bottom-start",
          popperClass: "ux-location-popover",
        },
        {
          reference: () =>
            button("?", () => {}, {
              circle: true,
              size: "small",
              "aria-label": label + "位置图示",
            }),
          default: () => [
            h("strong", label + "看哪里"),
            h("p", text),
            withTip(
              imageButton(src, label + "位置示意图"),
              "点图片可以放大，用滚轮或下面的按钮缩放。",
            ),
          ],
        },
      );
    }
    function addExampleWords(obj, key, words) {
      const merged = [...obj[key]];
      for (const word of words)
        if (!merged.some((v) => v.toLowerCase() === word.toLowerCase()))
          merged.push(word);
      update(obj, key, merged);
    }
    function companySummary(obj, key) {
      const words = obj[key] || [];
      const legacy =
        obj.legacyPatterns?.[key] || obj.legacyNeedsReview?.includes(key);
      return h(
        "div",
        { class: "ux-company-summary", "data-company-preview": key },
        [
          h(
            "p",
            { class: "ux-company-count" },
            words.length
              ? ["已设置 ", metric(words.length), " 个公司关键词"]
              : legacy
                ? "保留原有公司规则"
                : key === "companies"
                  ? "不限公司"
                  : "未排除公司",
          ),
          words.length
            ? h(
                "p",
                { class: "ux-company-names", title: words.join("、") },
                words.slice(0, 3).join("、") + (words.length > 3 ? " 等" : ""),
              )
            : null,
        ],
      );
    }
    function clearCompanyList(obj, key) {
      obj.legacyNeedsReview = (obj.legacyNeedsReview || []).filter(
        (item) => item !== key,
      );
      if (obj.legacyPatterns) delete obj.legacyPatterns[key];
      if (key === "excluded") obj.regexExclude = "";
      update(obj, key, []);
      preview.value = null;
    }
    async function clearSavedCompanyList(obj, key) {
      clearCompanyList(obj, key);
      if (await flushDraft())
        R.message({
          type: "success",
          message:
            key === "companies"
              ? "只看公司名单已清空，不再限制公司"
              : "排除公司名单已清空",
        });
    }
    function openCompanies(key, host = draft.value) {
      companyHost = host;
      companyEditor.value = clone(host);
      companyKey.value = key;
      companyError.value = "";
      modal.value = "companies";
    }
    async function applyCompanies() {
      if (companyBusy.value) return;
      companyBusy.value = true;
      companyError.value = "";
      try {
        for (const key of ["companies", "excluded"])
          companyHost[key] = clone(companyEditor.value[key]);
        const oldNeeds = (companyHost.legacyNeedsReview || []).filter(
          (key) => key !== "excluded",
        );
        companyHost.legacyNeedsReview =
          companyEditor.value.legacyNeedsReview?.includes("excluded")
            ? [...oldNeeds, "excluded"]
            : oldNeeds;
        companyHost.legacyPatterns ??= {};
        if (companyEditor.value.legacyPatterns?.excluded)
          companyHost.legacyPatterns.excluded =
            companyEditor.value.legacyPatterns.excluded;
        else delete companyHost.legacyPatterns.excluded;
        if (route.value === "follow") followDirty = true;
        changed("auto");
        if (!(await flushDraft())) {
          companyError.value = draftSaveError.value || "保存未完成，请重试。";
          return;
        }
        modal.value = "";
        R.message({ type: "success", message: "公司名单已应用" });
      } finally {
        companyBusy.value = false;
      }
    }
    function inlineExamples(obj, key, label, words) {
      return h("div", { class: "ux-keyword-examples" }, [
        h("span", "示例："),
        ...words.map((word) =>
          button(word, () => addExampleWords(obj, key, [word]), {
            plain: true,
            size: "small",
            "aria-label": "添加" + label + "示例：" + word,
          }),
        ),
      ]);
    }
    function prefs(d, sharedMode = false) {
      const inherited = !sharedMode && d.inherit;
      const useField = (key) => inherited && d.inheritedFields.includes(key);
      const v = (key) => (useField(key) ? shared.value : d);
      function sourceHint(key) {
        return useField(key)
          ? "沿用已保存偏好；修改请先选择“仅本次覆盖”。"
          : sharedMode
            ? "保存后会更新沿用此项的自动开聊规则。"
            : "本次独立条件";
      }
      function override(key) {
        return inherited
          ? button(
              useField(key) ? "仅本次覆盖" : "恢复沿用",
              () => {
                if (useField(key)) {
                  if (key === "salary")
                    for (const k of ["salary", "unit", "low", "high"])
                      d[k] = shared.value[k];
                  else {
                    d[key] = clone(shared.value[key]);
                    if (
                      [
                        "titles",
                        "categories",
                        "description",
                        "excluded",
                      ].includes(key)
                    ) {
                      d.regexMode = shared.value.regexMode;
                      d.regexLogic = shared.value.regexLogic;
                      for (const k of [
                        "regexTitle",
                        "regexType",
                        "regexDesc",
                        "regexExclude",
                      ])
                        d[k] = shared.value[k];
                    }
                  }
                  d.inheritedFields = d.inheritedFields.filter(
                    (k) => k !== key,
                  );
                } else d.inheritedFields.push(key);
                changed();
              },
              { link: true, type: "primary" },
            )
          : null;
      }
      const target = v("titles"),
        city = v("cities"),
        sal = v("salary");
      function review(obj, key) {
        return obj.legacyNeedsReview?.includes(key)
          ? h("div", { class: "ux-migration-note" }, [
              h(
                "p",
                "旧条件不能直接转换为关键词，已保留备份。可以继续沿用，或填写关键词替换。",
              ),
              button(
                "沿用原有条件",
                () => {
                  obj.legacyPatterns ??= {};
                  obj.legacyPatterns[key] =
                    obj.legacyRulesBackup[
                      {
                        titles: "regexTitle",
                        categories: "regexType",
                        description: "regexDesc",
                        excluded: "regexExclude",
                      }[key]
                    ];
                  obj.legacyNeedsReview = obj.legacyNeedsReview.filter(
                    (k) => k !== key,
                  );
                  changed();
                },
                { link: true, type: "primary" },
              ),
              key !== "titles"
                ? button(
                    "本项不限制",
                    () => {
                      obj[key] = [];
                      obj.legacyNeedsReview = obj.legacyNeedsReview.filter(
                        (k) => k !== key,
                      );
                      changed();
                    },
                    { link: true, type: "primary" },
                  )
                : null,
            ])
          : obj.legacyPatterns?.[key]
            ? hint("正在沿用原有条件；添加关键词将替换此项，其他条件不变。")
            : null;
      }
      const salaryChildren = [
        override("salary"),
        h("div", { class: "ux-salary" }, [
          select(
            sal,
            "unit",
            [
              ["month", "元 / 月"],
              ["year", "万元 / 年"],
            ],
            {
              disabled: useField("salary"),
              placeholder: "选择单位",
              clearable: true,
              "aria-label": "薪资计算方式",
            },
          ),
          number(sal, "low", {
            min: 0,
            controls: false,
            placeholder: "下限",
            disabled: useField("salary"),
            "aria-label": "薪资下限",
            id: "salary-low",
          }),
          h("span", "—"),
          number(sal, "high", {
            min: 0,
            controls: false,
            placeholder: "上限",
            disabled: useField("salary"),
            "aria-label": "薪资上限",
          }),
        ]),
      ];
      const content = [
        h("div", { class: "ux-form-row" }, [
          field(
            h("span", { class: "ux-filter-heading" }, [
              h("span", "想找什么岗位"),
              fieldLocation("titles", "岗位名称"),
            ]),
            h("div", [
              override("titles"),
              tags(target, "titles", roleOptions, {
                disabled: useField("titles"),
                id: "titles",
                "aria-label": "目标岗位",
                placeholder: "输入岗位关键词，如工程师、销售、会计；回车添加",
              }),
              review(target, "titles"),
            ]),
            "选填，不填则不限岗位名称。包含任一关键词即可，如“工程师”可匹配不同工程师岗位。",
            false,
            "titles",
          ),
          field(
            "工作城市",
            inline([
              tags(city, "cities", cityOptions, {
                disabled: useField("cities"),
                id: "cities",
                "aria-label": "工作城市",
              }),
              override("cities"),
            ]),
            city.cities.length
              ? "接受以上任一城市。" + sourceHint("cities")
              : "未选择表示不限城市，可输入列表外的城市。",
            false,
            "cities",
          ),
          field(
            "期望薪资",
            h("div", salaryChildren),
            "留空不限；支持只填下限或上限。",
            false,
            "salary",
          ),
        ]),
        // a run setting kept in this task's own config, so it binds to the draft even when
        // salary is shared with the common conditions; not part of the common-condition editor
        sharedMode
          ? null
          : h("div", { class: "ux-wide ux-skip-unparseable-salary" }, [
              withTip(
                check(
                  draft.value,
                  "skipUnparseableSalaryJob",
                  "跳过兼职、日结、实习等无法识别薪资的岗位",
                ),
                "不勾选的话，也会给这类岗位打招呼。但如果你填了期望薪资，这类岗位没法比较薪资，还是会跳过。",
              ),
            ]),
      ];
      const basicFilters = [],
        keywordFilters = [],
        companyFilters = [],
        moreFilters = [];
      for (const [key, label] of optional.filter(
        ([key]) => !sharedMode || allowedShared.includes(key),
      )) {
        const obj = v(key);
        let ctl,
          help = "";
        if (key === "hr") {
          moreFilters.push(
            h("div", { class: "ux-hr-rule ux-wide", "data-condition": key }, [
              withTip(
                check(obj, key, "只看人事发布的岗位", {
                  disabled: useField(key),
                }),
                "业务负责人自己发的岗位也可能被排除掉。",
              ),
            ]),
          );
          continue;
        } else if (["companies", "excluded"].includes(key)) {
          companyFilters.push(
            validationArea(
              key,
              [
                h("div", { class: "ux-filter-heading" }, [
                  h("label", label),
                  requiredBadge(key),
                  fieldLocation(key, label),
                  override(key),
                ]),
                h("div", { class: "ux-company-preview" }, [
                  companySummary(obj, key),
                  h("div", { class: "ux-company-actions" }, [
                    button("设置", () => openCompanies(key, obj), {
                      plain: true,
                      size: "small",
                      disabled: useField(key),
                      "aria-label":
                        key === "companies" ? "设置只看公司" : "设置排除公司",
                    }),
                    button("清空", () => clearSavedCompanyList(obj, key), {
                      plain: true,
                      size: "small",
                      disabled:
                        useField(key) ||
                        !(
                          obj[key]?.length ||
                          obj.legacyPatterns?.[key] ||
                          obj.legacyNeedsReview?.includes(key)
                        ),
                      "aria-label":
                        key === "companies"
                          ? "清空只看这些公司"
                          : "清空不看这些公司",
                    }),
                  ]),
                ]),
              ],
              { class: "ux-field", "data-condition": key },
            ),
          );
          continue;
        } else if (key === "activity") {
          const opts = ["不限", ...activeLabels.slice(1, 11).reverse()];
          if (!opts.includes(obj[key]))
            opts.push([obj[key], obj[key] + "（原有设置）"]);
          ctl = select(obj, key, opts, { "aria-label": label });
          help = "接受所选活跃状态及更新的状态。";
        } else {
          const opts =
            key === "experience"
              ? [
                  "经验不限",
                  "应届生",
                  "1年以内",
                  "1-3年",
                  "3-5年",
                  "5-10年",
                  "10年以上",
                ]
              : key === "categories"
                ? [
                    ...new Set(
                      initial.datasets.jobLibrary
                        .map((r) => r.positionName)
                        .filter(Boolean),
                    ),
                  ]
                : key === "companies" || key === "excluded"
                  ? ["腾讯", "字节跳动", "阿里巴巴", "美团", "网易"]
                  : [];
          const placeholders = {
            companies: "例如：腾讯。输入公司名后按回车添加…",
            excluded: "例如：某某外包。输入后按回车添加…",
            categories: "例如：软件开发、销售、财务…",
            description: "输入岗位要求的技能或工作内容，回车添加…",
            experience: "选择你接受的岗位要求…",
          };
          ctl = h("div", [
            tags(obj, key, opts, {
              disabled: useField(key),
              "aria-label": label,
              allowCreate: key !== "experience",
              placeholder: placeholders[key],
              ...(["companies", "excluded"].includes(key)
                ? {
                    collapseTags: true,
                    collapseTagsTooltip: true,
                    maxCollapseTags: 2,
                  }
                : {}),
            }),
            review(obj, key),
          ]);
          help =
            key === "excluded"
              ? ""
              : key === "description"
                ? "岗位描述必须包含你添加的每个词。"
                : key === "companies"
                  ? ""
                  : key === "experience"
                    ? "招聘岗位要求的经验，不是你的工作年限。"
                    : "匹配BOSS职位分类；包含任一关键词即可。";
        }
        const company = ["companies", "excluded"].includes(key),
          exampleWords =
            key === "categories"
              ? ["软件开发", "销售", "财务"]
              : key === "description"
                ? [
                    "Python",
                    "客户开发",
                    "财务报表",
                    "设备维护",
                    "内容运营",
                    "需求分析",
                  ]
                : null;
        const item = h("div", { class: "ux-field", "data-condition": key }, [
          h("div", { class: "ux-filter-heading" }, [
            h("label", label),
            help ? tip(help, label) : null,
            ["companies", "excluded", "categories", "description"].includes(key)
              ? fieldLocation(key, label)
              : null,
            override(key),
          ]),
          ctl,
          exampleWords && !useField(key)
            ? inlineExamples(obj, key, label, exampleWords)
            : null,
        ]);
        (["experience", "activity"].includes(key)
          ? basicFilters
          : ["categories", "description"].includes(key)
            ? keywordFilters
            : company
              ? companyFilters
              : moreFilters
        ).push(item);
      }
      const keywordLogic = field(
        "以上岗位条件如何匹配",
        select(
          target,
          "regexLogic",
          [
            [1, "全部已填写条件都满足"],
            [2, "满足其中一项即可"],
          ],
          { disabled: useField("titles"), "aria-label": "职位条件关系" },
        ),
        "仅控制名称、分类和描述；城市、薪资、公司仍需符合。",
      );
      const [titleField, ...otherFields] = content[0].children;
      const skipUnparseableSalary = content[1];
      const group = (title, items, note) =>
        h("div", { class: "ux-preference-group" }, [
          h("h3", note ? [title, tip(note, title)] : title),
          h("div", { class: "ux-form-row" }, items),
        ]);
      return [
        group("岗位关键词", [titleField, ...keywordFilters, keywordLogic]),
        group("工作地点与待遇", [
          ...otherFields,
          ...basicFilters,
          ...moreFilters,
          skipUnparseableSalary,
        ]),
        group(
          "公司偏好",
          companyFilters,
          "公司名按关键词匹配；“不看”优先，留空不限制。",
        ),
      ];
    }
    // 开始前确认: one line on what the run will do, then only the settings this run mode uses
    function checkLead() {
      if (checks.value === "follow")
        return ["确认开始后将向已读未回复的招聘者发送跟进消息。", "warning"];
      const d = draft.value;
      if (d.runMode !== "collect")
        return [
          "确认开始后将向符合条件的招聘者打招呼，不符合的岗位按处理方式处理（可能在BOSS标记不合适）。",
          "warning",
        ];
      return [
        isCollectAll(d)
          ? "确认开始后将浏览岗位并把全部岗位保存到资料库；不会打招呼，也不会标记不合适。"
          : "确认开始后将浏览岗位，只把符合求职条件的岗位保存到资料库；不会打招呼，也不会标记不合适。",
        "info",
      ];
    }
    function checkFactRows() {
      if (checks.value === "follow") {
        const f = follow.value;
        return [
          ["会话范围", (f.days === 0 ? "不限时间" : "最近" + f.days + "天") + "的已读未回复会话"],
          ["消息来源", f.source === "emotion" ? "期待回复表情" : "AI生成"],
          ["发送间隔", "每次间隔 " + f.interval + " 分钟"],
        ];
      }
      const d = effective();
      const facts = Object.fromEntries(templateFacts(d));
      const g = globalPace.value;
      const pace =
        d.useGlobalPace && g
          ? "全局设置：" +
            (g.pause ? `每 ${g.actions} 次操作休息 ${g.minutes} 分钟` : "不定时休息")
          : facts["运行节奏"];
      const keys = isCollectAll(d)
        ? ["运行方式", "职位来源"]
        : [
            "运行方式",
            "职位来源",
            "目标岗位",
            "工作城市",
            "期望薪资",
            ...[
              "职位分类",
              "岗位描述包含",
              "工作经验",
              "只看公司",
              "排除公司",
              "招聘者活跃",
            ].filter((k) => !["不限", "无"].includes(facts[k])),
            ...(d.runMode === "collect" ? [] : ["默认处理方式"]),
          ];
      return [...keys.map((k) => [k, facts[k]]), ["运行节奏", pace]];
    }
    function checkFacts() {
      const rows = checkFactRows();
      return h("details", { class: "ux-check-facts" }, [
        h("summary", [
          h("span", "本次使用的配置"),
          h("span", { class: "ux-hint" }, rows.length + " 项，展开核对"),
        ]),
        h(
          "dl",
          rows.flatMap(([k, v]) => [h("dt", k), h("dd", v || "—")]),
        ),
      ]);
    }
    const strategies = [
      [3, "略过该岗位，下次仍可查看"],
      [2, "7天内不再查看该岗位"],
      [1, "在BOSS标记“不合适”"],
    ];
    const strategyLabel = (n) =>
      strategies.find((x) => x[0] === n)?.[1] || "沿用默认";
    const sourceInfo = {
      search: ["搜索结果", "BOSS顶部搜索框找到的岗位。"],
      recommend: ["推荐职位", "BOSS“推荐”列表中的岗位。"],
      expect: ["按BOSS求职期望推荐", "BOSS已设置的求职期望对应的岗位。"],
    };
    function moveItem(list, index, delta) {
      const next = index + delta;
      if (next < 0 || next >= list.length) return;
      [list[index], list[next]] = [list[next], list[index]];
      changed();
    }
    function orderButtons(list, index, label) {
      return inline([
        button("提前", () => moveItem(list, index, -1), {
          size: "small",
          disabled: index === 0,
          "aria-label": label + "提前",
        }),
        button("后移", () => moveItem(list, index, 1), {
          size: "small",
          disabled: index === list.length - 1,
          "aria-label": label + "后移",
        }),
      ]);
    }
    function sourceControls() {
      const d = draft.value,
        search = d.sourceList.find((s) => s.type === "search"),
        rotate = isSearchRotationEnabled(d),
        enabledSources = d.sourceList.filter((source) => source.enabled),
        searchRows = searchOptionsForRun(d, search),
        activeSearchCount = new Set(
          searchRows
            .filter((row) => row.enabled && row.keyword)
            .map((row) => row.keyword),
        ).size;
      const searchRow = (c, index) =>
        h("div", { class: "ux-search-row" }, [
          check(c, "enabled", "使用", {
            "aria-label": "使用搜索词 " + (index + 1),
          }),
          input(c, "keyword", {
            "aria-label": "搜索内容 " + (index + 1),
            placeholder: "输入一条BOSS搜索内容，如会计",
          }),
          index > 0
            ? orderButtons(search.children, index, "搜索词 " + (index + 1))
            : null,
          index > 0
            ? button(
                "删除",
                () => {
                  search.children.splice(index, 1);
                  changed();
                },
                {
                  size: "small",
                  type: "danger",
                  plain: true,
                  "aria-label": "删除搜索词 " + (index + 1),
                },
              )
            : null,
        ]);
      return [
        field(
          "职位来源",
          h(
            "div",
            {
              class: "ux-source-options",
              role: "group",
              "aria-label": "职位来源（至少选一项）",
            },
            d.sourceList.map((s) =>
              h("div", [
                withTip(
                  check(s, "enabled", sourceInfo[s.type]?.[0] || s.type),
                  sourceInfo[s.type]?.[1] || "保留已有来源。",
                ),
              ]),
            ),
          ),
          "",
          false,
          "source-selection",
        ),
        search.enabled
          ? field(
              ["BOSS搜索内容", tip("这里的词会填进BOSS顶部的搜索框，搜出来的岗位再按你的求职条件筛。", "BOSS搜索内容")],
              h("div", [
                searchRow(search.children[0], 0),
                rotate
                  ? explain([
                      "已开启轮换：",
                      metric(activeSearchCount),
                      " 个搜索内容。",
                    ])
                  : null,
              ]),
              "",
              false,
              "source",
            )
          : null,
        disclosure(
          "BOSS页面筛选（已设置 " +
            (d.platformMode === 2
              ? d.platformCombos.length + " 个组合"
              : Object.values(d.platformFilters).filter(
                  (values) => Array.isArray(values) && values.length,
                ).length + " 项") +
            "）",
          platformFiltersOpen,
          "platform-filters",
          platformControls(),
          "这只改变BOSS页面上列出哪些岗位，不会代替你的求职条件。",
        ),
        search.enabled
          ? disclosure("自动轮换搜索", searchRotationOpen, "search-rotation", [
              withTip(
                check(d, "searchRotation", "启用自动轮换搜索", {
                  modelValue: rotate,
                }),
                "一个搜索词的结果看完、没有能聊的岗位了，就换下一个词。不开的话只用第一个词，其余的词留着不删。",
              ),
              ...(rotate
                ? search.children
                    .slice(1)
                    .map((c, index) => searchRow(c, index + 1))
                : []),
              rotate
                ? button(
                    "添加轮换搜索内容",
                    () => {
                      search.children.push({
                        type: "search-kw",
                        enabled: true,
                        keyword: "",
                      });
                      changed();
                    },
                    { size: "small", plain: true },
                  )
                : null,
            ])
          : null,
        enabledSources.length > 1
          ? disclosure("来源切换顺序", platformOpen, "source-order", [
              ...enabledSources.map((s, index) =>
                h("div", { class: "ux-source-order" }, [
                  h(
                    "span",
                    index + 1 + ". " + (sourceInfo[s.type]?.[0] || s.type),
                  ),
                  inline(
                    [-1, 1].map((delta) =>
                      button(
                        delta < 0 ? "先查看" : "后查看",
                        () => {
                          const from = d.sourceList.indexOf(s),
                            to = d.sourceList.indexOf(
                              enabledSources[index + delta],
                            );
                          moveItem(d.sourceList, from, to - from);
                        },
                        {
                          size: "small",
                          disabled:
                            index + delta < 0 ||
                            index + delta >= enabledSources.length,
                          "aria-label":
                            (sourceInfo[s.type]?.[0] || s.type) +
                            (delta < 0 ? "先查看" : "后查看"),
                        },
                      ),
                    ),
                  ),
                ]),
              ),
            ], "先查排在上面的来源，查完再换下一个。这只是查找顺序，不代表岗位更重要。")
          : null,
      ];
    }
    function platformControls() {
      const d = draft.value,
        dict = window.__ggrFilterData,
        combinationStats = countPlatformCombinations(
          d.platformFilters,
          d.skipEmpty,
        );
      const options = (key) =>
        key === "industry"
          ? dict.industries.flatMap((g) => g.subLevelModelList || [])
          : dict.conditions[key + "List"];
      const names = [
        ["city", "城市"],
        ["salary", "薪资"],
        ["experience", "经验"],
        ["degree", "学历"],
        ["industry", "行业"],
        ["scale", "公司规模"],
      ];
      const control = (obj, key, multi) =>
        key === "city"
          ? tags(obj, multi ? "cityList" : "city", cityOptions, {
              multiple: multi,
              "aria-label": "平台城市",
              allowCreate: true,
              clearable: true,
              placeholder: "不限",
            })
          : select(
              obj,
              key + (multi ? "List" : ""),
              options(key)
                .filter((o) => o.code !== 0)
                .map((o) => [o.code, o.name]),
              {
                multiple: multi,
                clearable: true,
                placeholder: "不限",
                "aria-label": "平台" + names.find((n) => n[0] === key)[1],
              },
            );
      const form = (obj, multi) =>
        h(
          "div",
          { class: "ux-platform-grid" },
          names.map(([key, label]) => field(label, control(obj, key, multi))),
        );
      return [
        field(
          "如何组合平台条件",
          select(
            d,
            "platformMode",
            [
              [1, "自动轮换筛选组合（包含不限项）"],
              [2, "逐条设置固定组合"],
            ],
            { "aria-label": "平台条件组合方式" },
          ),
          d.platformMode === 2
            ? "按组合的顺序一个个查，全部查完再换下一个来源。"
            : "会自动轮换各种筛选组合，包括“不限”。想固定筛选范围的话，改选“逐条设置固定组合”。",
        ),
        d.platformMode === 1
          ? form(d.platformFilters, true)
          : h("div", [
              ...d.platformCombos.map((row, index) =>
                h("section", { class: "ux-combo-row" }, [
                  inline([
                    h("h3", "组合 " + (index + 1)),
                    orderButtons(
                      d.platformCombos,
                      index,
                      "组合 " + (index + 1),
                    ),
                    button(
                      "删除组合",
                      () => {
                        d.platformCombos.splice(index, 1);
                        changed();
                      },
                      { plain: true, size: "small", type: "danger" },
                    ),
                  ]),
                  form(row, false),
                ]),
              ),
              button(
                "添加组合",
                () => {
                  d.platformCombos.push({
                    city: "",
                    salary: null,
                    experience: null,
                    degree: null,
                    industry: null,
                    scale: null,
                  });
                  changed();
                },
                { plain: true },
              ),
            ]),
        d.platformMode === 1
          ? check(d, "skipEmpty", "跳过“所有筛选都不限”的列表", {
              disabled: !combinationStats.hasConditions,
              modelValue: Boolean(
                d.skipEmpty && combinationStats.hasConditions,
              ),
            })
          : null,
        d.platformMode === 1
          ? explain(
              combinationStats.hasConditions
                ? "跳过完全不限的列表；部分条件不限的组合仍会查看。"
                : "未设置页面筛选，查看BOSS默认列表；仍按求职条件筛选。",
            )
          : null,
        d.platformMode === 1 && combinationStats.hasConditions
          ? explain([
              "每个来源预计查看 ",
              metric(combinationStats.total.toLocaleString("zh-CN")),
              " 种组合，组合越多，查找越久。",
            ])
          : null,
      ];
    }
    function policyControls() {
      const d = draft.value;
      const exceptionCount = Object.values(d.overrides).filter(
        (value) => value && value !== d.strategy,
      ).length;
      const markRisk = ["city", "salary", "experience"].some(
        (key) =>
          (d.overrides[key] || d.strategy) === 1 && (d.scopes[key] || 2) === 2,
      );
      return [
        field(
          "不符合条件时，默认怎么处理",
          select(d, "strategy", strategies, {
            "aria-label": "默认不匹配处理",
            "onUpdate:modelValue": (value) => {
              for (const key of Object.keys(d.overrides))
                if (d.overrides[key] === d.strategy) d.overrides[key] = 0;
              update(d, "strategy", value);
            },
          }),
          "单独设置的例外优先。",
        ),
        markRisk && !effective().companies.length
          ? alert(
              "名单为空，不会标记任何公司。请设置公司名单，或改为略过岗位。",
              "warning",
            )
          : markRisk
            ? explain([
                "标记名单：",
                metric(effective().companies.length),
                " 家公司（来自“只看这些公司”）。",
              ])
            : null,
        markRisk
          ? button("查看公司名单", () => openCompanies("companies"), {
              link: true,
              type: "primary",
            })
          : null,
        disclosure(
          "单独处理某种情况（已设置 " + exceptionCount + " 项）",
          policyExceptionsOpen,
          "policy-exceptions",
          [
            ...[
              ["title", "岗位不符合"],
              ["company", "公司需排除"],
              ["city", "城市不符合"],
              ["salary", "薪资不符合"],
              ["experience", "经验不符合"],
              ["hr", "招聘者身份不符"],
              ["activity", "招聘者不活跃"],
            ].map(([key, label]) =>
              h("div", { class: "ux-policy-row" }, [
                h("span", label),
                select(
                  d.overrides,
                  key,
                  [[0, "使用默认处理方式"], ...strategies],
                  {
                    modelValue:
                      d.overrides[key] === d.strategy
                        ? 0
                        : d.overrides[key] || 0,
                    "aria-label": label + "处理",
                  },
                ),
                ["city", "salary", "experience"].includes(key) &&
                (d.overrides[key] || d.strategy) === 1
                  ? select(
                      d.scopes,
                      key,
                      [
                        [2, "只标记指定公司"],
                        [1, "标记所有公司"],
                      ],
                      { "aria-label": label + "标记范围" },
                    )
                  : null,
              ]),
            ),
          ],
          "“只标记指定公司”用的是求职条件里“只看这些公司”的名单。",
        ),
      ];
    }
    function rhythmControls(d = draft.value, key = "rhythm") {
      return [
        validationArea(key, [
          inline([
            check(d, "pause", "定时休息"),
            tip(
              "“操作”包括加载列表、看岗位详情和打招呼，不是打招呼成功的次数。休息也不能保证不被平台限制。",
              "定时休息",
            ),
            requiredBadge(key),
          ]),
          d.pause
            ? h("div", { class: "ux-rhythm-line" }, [
                h("span", "每操作"),
                number(d, "actions", { "aria-label": "休息前操作次数" }),
                h("span", "次，休息"),
                number(d, "minutes", { min: 0, "aria-label": "休息分钟数" }),
                h("span", "分钟"),
              ])
            : null,
        ]),
        h("div", { class: "ux-field", "data-condition": "pace" }, [
          h("label", "操作节奏"),
          h("div", { class: "ux-rhythm-line" }, [
            h("span", "加载下一批岗位后等待"),
            number(d, "jobListLoadWaitSeconds", {
              min: 0,
              max: MAX_WAIT_SECONDS,
              step: 0.5,
              precision: 1,
              "aria-label": "加载下一批岗位后等待秒数",
            }),
            h("span", "秒"),
          ]),
          h("div", { class: "ux-rhythm-line" }, [
            h("span", "查看岗位详情后等待"),
            number(d, "jobDetailViewWaitSeconds", {
              min: 0,
              max: MAX_WAIT_SECONDS,
              step: 0.5,
              precision: 1,
              "aria-label": "查看岗位详情后等待秒数",
            }),
            h("span", "秒，另加 0–1 秒随机时间"),
            tip(
              `默认分别是 ${DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS} 秒和 ${DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS} 秒。调短会快一些，但更容易被平台限制；不填就用默认值。`,
            ),
          ]),
        ]),
      ];
    }
    function evaluate(originalRow, d) {
      const row = {
        ...originalRow,
        jobDescription: originalRow.postDescription || originalRow.description,
        jobTypeName: originalRow.positionName,
        cityName:
          originalRow.cityName ||
          cityOptions.find((c) => (originalRow.address || "").startsWith(c)),
      };
      const reasons = [],
        unknown = missingJobFields(row, {
          title: d.regexMode
            ? d.regexTitle
            : d.titles.length || d.legacyPatterns?.titles,
          category: d.regexMode
            ? d.regexType
            : d.categories.length || d.legacyPatterns?.categories,
          description: d.regexMode
            ? d.regexDesc
            : d.description.length || d.legacyPatterns?.description,
          city: d.cities.length,
          company:
            d.companies.length ||
            d.excluded.length ||
            d.legacyPatterns?.excluded ||
            d.regexExclude,
          experience: d.experience.length,
          hr: d.hr,
          salary: d.salary,
        }),
        reasonKeys = [];
      function reject(key, text) {
        reasonKeys.push(key);
        reasons.push(text);
      }
      function test(pattern, value, label) {
        if (!pattern) return true;
        if (value == null || value === "") {
          unknown.push(label + "信息不足");
          return false;
        }
        return new RegExp(pattern, "im").test(value);
      }
      if (d.regexMode) {
        const tests = [
          ["regexTitle", row.jobName, "岗位名称"],
          ["regexType", row.jobTypeName, "岗位类别"],
          ["regexDesc", row.jobDescription, "岗位描述"],
        ]
          .filter(([k]) => d[k])
          .map(([k, v, l]) => test(d[k], v, l));
        if (
          tests.length &&
          !(d.regexLogic === 2 ? tests.some(Boolean) : tests.every(Boolean))
        )
          reject("title", "高级岗位规则未命中");
      } else {
        const tests = [];
        if (d.legacyPatterns?.titles || d.titles.length)
          tests.push([
            d.legacyPatterns?.titles
              ? test(d.legacyPatterns.titles, row.jobName, "岗位名称")
              : d.titles.some((t) => test(escape(t), row.jobName, "岗位名称")),
            "岗位名称未包含目标词",
          ]);
        if (d.legacyPatterns?.categories || d.categories.length)
          tests.push([
            d.legacyPatterns?.categories
              ? test(d.legacyPatterns.categories, row.jobTypeName, "岗位类别")
              : d.categories.some((t) =>
                  test(escape(t), row.jobTypeName, "岗位类别"),
                ),
            "岗位类别未命中",
          ]);
        if (d.legacyPatterns?.description || d.description.length)
          tests.push([
            d.legacyPatterns?.description
              ? test(
                  d.legacyPatterns.description,
                  row.jobDescription,
                  "岗位描述",
                )
              : d.description.every((t) =>
                  test(escape(t), row.jobDescription, "岗位描述"),
                ),
            "描述未包含全部关键词",
          ]);
        if (
          !(d.regexLogic === 2
            ? tests.some((t) => t[0])
            : tests.every((t) => t[0]))
        )
          reject(
            "title",
            tests
              .filter((t) => !t[0])
              .map((t) => t[1])
              .join("；"),
          );
      }
      if (d.cities.length && !d.cities.includes(row.cityName))
        reject("city", "工作城市不匹配");
      if (
        d.companies.length &&
        !d.companies.some((t) => test(escape(t), row.companyName, "公司"))
      )
        reject("company", "公司不在目标名单");
      if (
        d.regexMode
          ? test(d.regexExclude, row.companyName, "公司") &&
            Boolean(d.regexExclude)
          : d.legacyPatterns?.excluded
            ? test(d.legacyPatterns.excluded, row.companyName, "公司")
            : d.excluded.some((t) => test(escape(t), row.companyName, "公司"))
      )
        reject("company", "命中排除公司");
      if (
        !d.salary &&
        d.skipUnparseableSalaryJob !== false &&
        (row.salaryLow == null || row.salaryHigh == null)
      )
        unknown.push("薪资无法识别（兼职、日结、实习等）");
      if (d.salary) {
        if (row.salaryLow == null || row.salaryHigh == null)
          unknown.push("薪资信息不足");
        else {
          // same as the run: a missing 薪数 counts as 12 months
          const scale = d.unit === "year" ? (row.salaryMonth || 12) / 10 : 1000;
          if (
            (d.low != null && row.salaryHigh * scale < d.low) ||
            (d.high != null && row.salaryLow * scale > d.high)
          )
            reject("salary", "薪资区间无交集");
        }
      }
      if (d.experience.length && !d.experience.includes(row.experienceName))
        reject("experience", "经验要求不匹配");
      if (d.hr) {
        const rules =
          d.hrRule?.trim() ||
          "HR|HRBP|HRG|Recruiter|Talent Acquisition|招聘|人事|人力|人资";
        if (!row.bossTitle) unknown.push("招聘者身份无法确认");
        else if (!test(rules, row.bossTitle, "招聘者身份"))
          reject("hr", "招聘者身份不符合");
      }
      if (d.activity !== "不限") {
        let info = {};
        try {
          info =
            typeof row.extInfo === "string"
              ? JSON.parse(row.extInfo)
              : row.extInfo || {};
        } catch {}
        // same as the run: a missing or unrecognised status is not treated as inactive
        const active = row.bossActiveTimeDesc || info.bossActiveTimeDesc;
        const index =
            active == null ? -1 : activeLabels.indexOf(active || "半年前活跃"),
          threshold = Math.max(0, activeLabels.indexOf(d.activity) - 1);
        if (index > 0 && index <= threshold)
          reject("activity", "招聘者活跃状态较旧");
      }
      const actionCodes = [
        ...new Set(
          reasonKeys.map((key, index) => {
            if (key === "company" && reasons[index] === "公司不在目标名单")
              return 3;
            const code = d.overrides[key] || d.strategy;
            return ["city", "salary", "experience"].includes(key)
              ? scopedMarkStrategy(
                  code,
                  d.scopes[key] || 2,
                  d.companies,
                  row.companyName,
                )
              : code;
          }),
        ),
      ];
      const actions = actionCodes.map(strategyLabel);
      return {
        ...row,
        result: unknown.length
          ? "信息不足"
          : reasons.length
            ? "不匹配"
            : "匹配",
        reason:
          [...reasons, ...new Set(unknown)].join("；") || "全部已设置条件通过",
        actionLabels: unknown.length
          ? ["跳过"]
          : reasons.length
            ? actionCodes.map(
                (code) => ({ 1: "标记不合适", 2: "7天冷却", 3: "跳过" })[code],
              )
            : ["可打招呼"],
        action: unknown.length
          ? "信息不足，本次跳过；不发送、不标记"
          : reasons.length
            ? actions.join(" / ") + "（计划，受作用范围限制）"
            : "符合条件；开始任务后才执行开聊",
      };
    }
    const workerIds = {
      auto: "geekAutoStartWithBossMain",
      follow: "readNoReplyAutoReminderMain",
    };
    // every task that takes a turn in the daemon's BOSS task queue
    const queuedTaskLabels = {
      geekAutoStartWithBossMain: "找岗位",
      readNoReplyAutoReminderMain: "消息跟进",
      jobStatusPollMain: "检查收藏职位状态",
    };
    const exitCodeLabels = EXIT_CODE_LABELS;
    const queueDetail = (position, yielded = false) =>
      (yielded ? "已让出给排队的任务；" : "其他任务运行中；") +
      `排在队列第 ${position || 1} 位，轮到时自动${yielded ? "继续" : "开始"}`;
    const runIds = ref({ auto: null, follow: null });
    // ---- live state of every BOSS task, for the task dashboard and the page curtain ----
    // workerId -> { runRecordId, progress, base (counts from before a restart), log, steps, firstStartedAt }
    const liveTasks = ref({});
    // the task whose dashboard the 任务列表 page shows
    const taskDetailId = ref(null);
    // runs for which the user chose to keep editing under the curtain
    const curtainDismissed = ref({ auto: null, follow: null });
    const COUNTERS = ["viewed", "collected", "sent", "skipped", "marked"];
    const isCountedKind = (kind) => COUNTERS.includes(kind);
    function mergeLive(workerId, runRecordId, progress, steps) {
      if (!(workerId in queuedTaskLabels) || !progress) return;
      const cur = liveTasks.value[workerId];
      const sameRun = cur && String(cur.runRecordId) === String(runRecordId);
      // a task restarted after making way for another run starts its counters again
      const restarted =
        sameRun && cur.progress?.startedAt && cur.progress.startedAt !== progress.startedAt;
      const base = !sameRun
        ? {}
        : restarted
          ? Object.fromEntries(
              COUNTERS.map((k) => [k, (cur.base?.[k] || 0) + (cur.progress?.[k] || 0)]),
            )
          : cur.base || {};
      const log = sameRun ? cur.log.slice() : [];
      const seen = new Set(log.map((e) => e.at + "|" + e.text));
      for (const e of progress.log || []) {
        if (seen.has(e.at + "|" + e.text)) continue;
        const last = log[log.length - 1];
        // a repeated status line moves forward instead of piling up
        if (last && !isCountedKind(e.kind) && last.kind === e.kind && last.text === e.text) {
          last.at = Math.max(last.at, e.at);
          continue;
        }
        log.push({ ...e });
        seen.add(e.at + "|" + e.text);
      }
      log.sort((a, b) => a.at - b.at);
      if (log.length > 1000) log.splice(0, log.length - 1000);
      liveTasks.value = {
        ...liveTasks.value,
        [workerId]: {
          runRecordId,
          progress,
          base,
          log,
          steps: steps || cur?.steps || null,
          firstStartedAt: sameRun ? cur.firstStartedAt : progress.startedAt,
        },
      };
    }
    // A 找岗位 run that stopped without being terminated is paused: it stays in 当前任务 and can be
    // resumed (main/features/task-resume.ts). Only terminated runs go to the task history.
    const autoResume = ref(null);
    async function refreshResume() {
      try {
        autoResume.value = await window.electron.ipcRenderer.invoke("get-auto-chat-resume");
      } catch {
        autoResume.value = null;
      }
      const r = pausedAutoRun();
      // after an app restart the dashboard still shows the paused run's numbers and log
      if (r && String(liveTasks.value[workerIds.auto]?.runRecordId) !== String(r.runRecordId))
        mergeLive(workerIds.auto, r.runRecordId, r.progress);
    }
    R.watch(
      () => [route.value, taskStore.taskHistory.length, running.value.auto, queued.value.auto],
      refreshResume,
      { immediate: true },
    );
    /** the paused 找岗位 run, if any: saved, not running or queued, and the latest one */
    function pausedAutoRun() {
      const r = autoResume.value;
      if (!r || running.value.auto || queued.value.auto) return null;
      const last = taskStore.taskHistory.find((t) => t.workerId === workerIds.auto);
      return !last || String(last.runRecordId) === String(r.runRecordId) ? r : null;
    }
    // why it is paused: the way its last part ended
    function pauseReason(r) {
      const last = taskStore.taskHistory.find(
        (t) => t.workerId === workerIds.auto && String(t.runRecordId) === String(r?.runRecordId),
      );
      if (!last || last.code === 0) return "已手动暂停";
      return exitCodeLabels[last.code] || "运行中断（退出码 " + last.code + "）";
    }
    async function resumeTask() {
      const r = pausedAutoRun();
      if (!r) return;
      if (
        r.runMode !== "collect" &&
        !(await confirmBox(
          "恢复找岗位任务：会向符合条件的招聘者打招呼，已处理过的岗位不会重复处理。",
          "恢复任务",
          "恢复",
        ))
      )
        return;
      await startTask("auto", true);
      await refreshResume();
    }
    // pause keeps the run for 恢复; terminate ends it and moves it to the history
    async function pauseTask() {
      requestedStop.auto = "pause";
      await stop("auto", "pause");
      await refreshResume();
    }
    async function terminateTask(task) {
      if (task !== "auto") return stop(task);
      if (
        !(await confirmBox(
          "终止后这次运行会移到历史记录，不能再恢复；之后可以按当前配置重新开始。",
          "终止找岗位任务",
          "终止",
        ))
      )
        return;
      requestedStop.auto = "terminate";
      stopping.value = true;
      try {
        await window.electron.ipcRenderer.invoke("terminate-auto-chat");
        await taskStore.getRunningTasks();
        await taskStore.getTaskHistory?.();
        running.value.auto = taskStore.runningTasks.some((t) => t.workerId === workerIds.auto);
        queued.value.auto = taskStore.taskQueue.some((t) => t.workerId === workerIds.auto);
        await refreshResume();
        R.message({ type: "success", message: "找岗位任务已终止，已移到历史记录。" });
      } catch (error) {
        R.message({ type: "error", message: "终止失败：" + error.message });
      } finally {
        stopping.value = false;
      }
    }
    // a new run with the current settings, after the usual checks and 开始前确认
    function restartTask(task) {
      navigate(task);
      R.nextTick(() => begin(task));
    }
    /** buttons for a task by its state: running, paused or ended */
    function taskControls(task, { size, running: isRunning, paused } = {}) {
      const small = size ? { size, link: true } : {};
      if (isRunning)
        return task === "auto"
          ? [
              button("暂停", pauseTask, { ...small, type: "warning", plain: !size, loading: stopping.value }),
              button("终止", () => terminateTask(task), { ...small, type: "danger", plain: !size }),
            ]
          : [button("停止", () => stop(task), { ...small, type: "danger", plain: !size, loading: stopping.value })];
      if (paused)
        return [
          button("恢复", resumeTask, {
            ...small,
            type: "primary",
            loading: starting.value,
            title: "从暂停的位置接着运行，计数和日志接着累计",
          }),
          button("终止", () => terminateTask(task), { ...small, type: "danger", plain: !size }),
        ];
      return [
        button("重新启动", () => restartTask(task), {
          ...small,
          type: size ? "primary" : undefined,
          title: "按当前配置开始一次新的运行",
        }),
      ];
    }
    // counts over the whole run, across restarts
    const liveCount = (live, key) => (live?.base?.[key] || 0) + (live?.progress?.[key] || 0);
    // ---- task details drawer: 运行概览 / 本次数据 / 任务配置, over whatever page is open ----
    const selectedTask = ref(null);
    const detailTab = ref("overview");
    /** a running, queued or paused task */
    function openTaskDetail(workerId) {
      const entry = [...taskStore.runningTasks, ...taskStore.taskQueue].find(
        (t) => t.workerId === workerId,
      );
      const args = entry?.args || [];
      const arg = (name) =>
        args.find((a) => String(a).startsWith("--" + name + "="))?.split("=")[1];
      // a paused 找岗位 run has no process: its saved state tells which run it is
      const paused = !entry && workerId === workerIds.auto ? pausedAutoRun() : null;
      selectedTask.value = paused
        ? {
            workerId,
            runRecordId: paused.runRecordId,
            runMode: paused.runMode,
            startedAt: paused.progress?.startedAt,
            endedAt: paused.savedAt,
            current: true,
          }
        : {
            workerId,
            runRecordId: arg("run-record-id"),
            runMode: arg("run-mode"),
            startedAt:
              liveTasks.value[workerId]?.firstStartedAt ||
              entry?.queuedAt ||
              Date.now() - (entry?.uptime || 0),
            current: true,
          };
      taskDetailId.value = workerId;
      detailTab.value = "overview";
    }
    /** a row of the 任务列表 table */
    function openRunDetail(row) {
      if (row.phase === "current") return openTaskDetail(row.workerId);
      selectedTask.value = {
        workerId: row.workerId,
        runRecordId: row.runRecordId,
        runMode: row.runMode,
        startedAt: row.startedMs,
        endedAt: row.endedMs,
        status: row.status,
        note: row.note,
        current: false,
      };
      taskDetailId.value = row.workerId;
      detailTab.value = "overview";
    }
    function closeTaskDetail() {
      taskDetailId.value = null;
      selectedTask.value = null;
    }
    async function begin(task) {
      if (
        preparing.value ||
        starting.value ||
        running.value[task] ||
        queued.value[task]
      )
        return;
      if (
        task === "auto" &&
        pausedAutoRun() &&
        !(await confirmBox(
          "有一个已暂停的找岗位任务。开始新的运行会终止它（移到历史记录，不能再恢复）。如果只是想接着运行，请点“恢复”。",
          "开始新的运行",
          "终止并开始",
        ))
      )
        return;
      validationTask = task;
      const issues = taskErrors(task);
      errors.value = issues;
      if (issues.length) {
        presentErrors(issues, task);
        return;
      }
      preparing.value = true;
      shortResume.value = false;
      try {
        if (!(await ensureBossLogin(task))) return;
        if (task === "auto" && draft.value.useGlobalPace) await loadGlobalPace();
        if (!(await save(false, task))) return;
        if (
          task === "follow" &&
          (follow.value.source === "ai" || follow.value.opening === "ai")
        ) {
          await native.refresh();
          const modelError = validModelList(
            modelPair(native.state().config["llm.json"]),
          );
          if (modelError) {
            presentErrors(
              [
                {
                  text: "请先保存有效的AI模型配置：" + modelError,
                  action: "model",
                  label: "去设置模型",
                },
              ],
              task,
            );
            return;
          }
          if (
            !(await window.electron.ipcRenderer.invoke(
              "check-is-resume-content-valid",
            ))
          ) {
            presentErrors(
              [
                {
                  text: "请先完善并保存简历，至少包含一条有效工作经历和项目经历。",
                  action: "resume",
                  label: "去填写简历",
                },
              ],
              task,
            );
            return;
          }
          for (const type of [
            follow.value.source === "ai" ? "rechat" : null,
            follow.value.opening === "ai" ? "open" : null,
          ].filter(Boolean))
            await window.electron.ipcRenderer.invoke(
              "check-if-auto-remind-prompt-valid",
              { type },
            );
          shortResume.value = !(await window.electron.ipcRenderer.invoke(
            "resume-content-enough-detect",
          ));
        }
        const state = await native.refresh();
        login.value = state.cookie.length > 0;
        browser.value = Boolean(state.browser?.executablePath);
        const cookieValid = Boolean(
          await window.electron.ipcRenderer.invoke(
            "check-boss-zhipin-cookie-file",
          ),
        );
        checks.value = task;
        const fixIn = (tab) => () => {
          modal.value = "";
          navigate("settings");
          settingTab.value = tab;
        };
        runtimeSteps.value = [
          {
            label: !cookieValid
              ? "BOSS直聘尚未登录或登录已失效"
              : bossLogin.value.status === "valid"
                ? "BOSS直聘登录有效"
                : "登录凭证已保存（运行时会再次确认）",
            ok: cookieValid,
            fix: "修复登录",
            onFix: fixIn("account"),
          },
          {
            label: browser.value ? "浏览器已配置" : "尚未配置浏览器",
            ok: browser.value,
            fix: "修复浏览器",
            onFix: fixIn("browser"),
          },
        ];
        modal.value = "check";
      } catch (error) {
        presentErrors([{ text: "开始前检查未通过：" + error.message }], task);
        modal.value = "";
      } finally {
        preparing.value = false;
      }
    }
    async function confirmRun() {
      await startTask(checks.value);
    }
    // resume: go on with the last 找岗位 run (its position, skipped jobs and counters)
    async function startTask(task, resume = false) {
      if (starting.value) return;
      starting.value = true;
      try {
        await taskStore.getRunningTasks();
        const id = workerIds[task];
        if (
          taskStore.runningTasks.some((t) => t.workerId === id) ||
          taskStore.taskQueue.some((t) => t.workerId === id)
        )
          throw Error("该任务已在运行或排队中。");
        const result = await window.electron.ipcRenderer.invoke(
          task === "auto"
            ? "run-geek-auto-start-chat-with-boss"
            : "run-read-no-reply-auto-reminder",
          resume ? { resume: true } : undefined,
        );
        requestedStop[task] = false;
        curtainDismissed.value = { ...curtainDismissed.value, [task]: null };
        taskProgress.value[task] = {
          startedAt: Date.now(),
          viewed: 0,
          sent: 0,
          skipped: 0,
          collected: 0,
          state: result.queued ? "queued" : "running",
          detail: result.queued
            ? queueDetail(result.queuePosition)
            : "准备检查任务",
          runRecordId: result.runRecordId,
        };
        runIds.value[task] = result.runRecordId;
        running.value[task] = !result.queued;
        queued.value[task] = Boolean(result.queued);
        modal.value = "";
        R.message(
          result.queued
            ? {
                type: "info",
                title: "已加入任务列表",
                message: "其他任务正在运行，轮到时会自动开始。",
              }
            : {
                type: "success",
                title: resume ? "任务已继续" : "任务已启动",
                message: resume
                  ? "从上次停下的职位来源和筛选组合继续，已处理过的岗位不会重复处理。"
                  : "运行中修改的条件用于下次开始，不改变本次任务使用的配置。",
              },
        );
        await taskStore.getRunningTasks();
      } catch (error) {
        R.message({
          type: "error",
          title: resume ? "任务未能继续" : "任务未启动",
          message: error.message + "。请修复后重试。",
        });
      } finally {
        starting.value = false;
      }
    }
    async function stop(task, kind = "stop") {
      if (stopping.value) return;
      requestedStop[task] = kind;
      stopping.value = true;
      try {
        const wasQueued = queued.value[task] && !running.value[task];
        await window.electron.ipcRenderer.invoke("stop-task", workerIds[task]);
        await taskStore.getRunningTasks();
        running.value[task] = taskStore.runningTasks.some(
          (t) => t.workerId === workerIds[task],
        );
        queued.value[task] = taskStore.taskQueue.some(
          (t) => t.workerId === workerIds[task],
        );
        if (wasQueued && taskProgress.value[task]) {
          taskProgress.value[task].state = "stopped";
          taskProgress.value[task].stoppedAt = Date.now();
          taskProgress.value[task].detail = "已取消排队，任务还没开始";
        }
        R.message(
          running.value[task]
            ? { type: "info", message: "停止请求已发送，等待任务退出。" }
            : {
                type: "success",
                message: wasQueued
                  ? "已取消排队。"
                  : kind === "pause"
                    ? "任务已暂停，可在任务列表中恢复。"
                    : "任务已停止。",
              },
        );
      } catch (error) {
        R.message({ type: "error", message: "停止失败：" + error.message });
      } finally {
        stopping.value = false;
      }
    }
    function runPanel(task) {
      const p = taskProgress.value[task];
      if (!p) return null;
      const waiting = queued.value[task] && !running.value[task];
      const active = running.value[task],
        elapsed = Math.max(
          0,
          Math.floor(
            ((active
              ? progressClock.value
              : p.stoppedAt || p.updatedAt || progressClock.value) -
              p.startedAt) /
              1000,
          ),
        );
      const titles = {
        running: "正在运行",
        searching: "正在检查下一批岗位",
        blocked: "已停止，请检查条件",
        waiting: "等待新岗位或会话",
        resting: "定时休息中",
        retrying: "正在重新检查",
        stopped: "已停止",
        error: "任务异常结束",
        queued: "排队等待中",
        yielded: "已让出，等待继续",
        paused: "已暂停，等待安全验证",
      };
      return h(
        "section",
        { class: "ux-run-panel", role: "status", "aria-label": "任务运行结果" },
        [
          h("h3", [
            titles[p.state] || "正在检查任务",
            tip("任务会一直找下去，所以没有预计完成时间。“已查看”只算真正看完详情的岗位或会话。", "运行状态"),
          ]),
          h("p", [
            "已查看 ",
            metric(p.viewed),
            ...(task === "auto" && (p.collected || draft.value.runMode === "collect")
              ? ["，已收集 ", metric(p.collected || 0)]
              : []),
            "，已发送 ",
            metric(p.sent),
            "，已跳过 ",
            metric(p.skipped),
            waiting ? "，已等待 " : "，已运行 ",
            metric(elapsed),
            " 秒",
          ]),
          hint(p.detail),
          p.listSummary ? hint(p.listSummary) : null,
          p.lastSkippedDetail
            ? hint("最近一次跳过：" + p.lastSkippedDetail)
            : null,
          waiting
            ? inline([
                button("查看任务列表", () => navigate("tasks")),
                button("取消排队", () => stop(task), {
                  type: "danger",
                  plain: true,
                  loading: stopping.value,
                }),
              ])
            : active
            ? inline([
                button("查看任务", () => openTaskDetail(workerIds[task])),
                button("停止运行", () => stop(task), {
                  type: "danger",
                  plain: true,
                  loading: stopping.value,
                }),
              ])
            : p.state === "blocked"
              ? inline([
                  button("检查求职条件", () =>
                    jumpAutoSection("job-preferences"),
                  ),
                  button("重新开始", () => begin(task), {
                    type: "primary",
                    plain: true,
                  }),
                ])
              : p.state === "error"
                ? button("修复后重新开始", () => begin(task), {
                    type: "primary",
                    plain: true,
                  })
                : null,
        ],
      );
    }
    function jumpAutoSection(id, focusSelector) {
      if (autoSteps().some((s) => s.id === id)) autoStep.value = id;
      activeAutoSection.value = id;
      R.nextTick(() => {
        const section = document.getElementById(id);
        section?.scrollIntoView({ block: "start", behavior: "auto" });
        (focusSelector
          ? section?.querySelector(focusSelector)
          : section
        )?.focus({
          preventScroll: true,
        });
      });
    }
    function updateAutoSection() {
      // steps show one section at a time; the rail follows the step, not the scroll position
    }
    // ---- 找岗位 configuration steps ----
    function autoSteps(d = draft.value) {
      const all = isCollectAll(d);
      return [
        { id: "job-run-mode", label: "运行方式" },
        {
          id: "job-preferences",
          label: "求职条件",
          skipped: all ? "收集全部岗位，无需配置" : "",
        },
        { id: "job-sources", label: "职位来源" },
        {
          id: "job-policy",
          label: "处理方式",
          skipped: all ? "收集全部岗位，无需配置" : "",
        },
        {
          id: "job-pace",
          label: "运行节奏",
          skipped: d.useGlobalPace ? "使用全局运行节奏" : "",
        },
      ];
    }
    // the step a validation field belongs to; null for fields outside the 找岗位 form
    function stepOfField(field) {
      if (!field || field.startsWith("follow-") || field.startsWith("ai-")) return null;
      if (["source", "source-selection"].includes(field)) return "job-sources";
      if (field === "rhythm") return "job-pace";
      if (field === "template-name") return null;
      return "job-preferences";
    }
    // a step that became skipped (e.g. after switching to collect everything) shows the next one
    function currentStepId(steps = autoSteps()) {
      const at = steps.findIndex((s) => s.id === autoStep.value);
      if (at >= 0 && !steps[at].skipped) return steps[at].id;
      return (
        steps.slice(Math.max(0, at)).find((s) => !s.skipped) ||
        [...steps].reverse().find((s) => !s.skipped)
      ).id;
    }
    function goStep(id) {
      autoStep.value = id;
      activeAutoSection.value = id;
      R.nextTick(() => document.querySelector(".ux-main")?.scrollTo(0, 0));
    }
    function moveStep(delta) {
      const steps = autoSteps().filter((s) => !s.skipped);
      const current = currentStepId();
      const at = steps.findIndex((s) => s.id === current);
      if (delta > 0) {
        // the step being left has to be complete before going on
        const issues = validation(effective()).filter(
          (i) => stepOfField(i.field) === current,
        );
        if (issues.length) {
          validationAttempted.value = true;
          validationTask = "auto";
          errors.value = taskErrors("auto");
          R.message({ type: "warning", title: "这一步还没完成", message: issues[0].text });
          focusError(issues[0]);
          return;
        }
      }
      const next = steps[Math.min(steps.length - 1, Math.max(0, at + delta))];
      if (next) goStep(next.id);
    }
    // the 找岗位 steps as an Element Plus step bar; which steps exist, their state and where a
    // click goes stay as they were (autoSteps / autoProgress / goStep)
    function stepBar(steps, current, sections) {
      const states = steps.map((step) => {
        const section = sections.find((x) => x.id === step.id);
        const done = section ? section.checks.every((c) => c.done) : true;
        return step.skipped
          ? "skipped"
          : step.id === current
            ? "current"
            : done
              ? "done"
              : "missing";
      });
      const elStatus = { current: "process", done: "success", missing: "error", skipped: "wait" };
      const text = { current: "正在填", done: "填好了", missing: "还没填完", skipped: "不用填" };
      return E(
        "ElSteps",
        {
          class: "ux-el-steps",
          active: Math.max(0, steps.findIndex((s) => s.id === current)),
          "aria-label": "配置步骤",
        },
        () =>
          steps.map((step, i) => {
            const state = states[i];
            const go = () => !step.skipped && goStep(step.id);
            return E("ElStep", {
              key: step.id,
              class: ["ux-el-step", "is-" + state],
              title: step.label,
              description: text[state],
              status: elStatus[state],
              role: "button",
              tabindex: step.skipped ? -1 : 0,
              "aria-current": step.id === current ? "step" : undefined,
              "aria-disabled": step.skipped ? "true" : undefined,
              onClick: go,
              onKeydown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go();
                }
              },
            }, step.skipped ? { description: () => [text.skipped, tip(step.skipped, step.label)] } : undefined);
          }),
      );
    }
    function paceStep() {
      const d = draft.value;
      const g = globalPace.value;
      return card(
        "运行节奏",
        [
          globalPaceCheck(),
          d.useGlobalPace
            ? h("div", { class: "ux-pace-summary" }, [
                hint(
                  g
                    ? (g.pause
                        ? `每操作 ${g.actions} 次休息 ${g.minutes} 分钟；`
                        : "不定时休息；") +
                        `加载下一批后等待 ${g.jobListLoadWaitSeconds} 秒，查看详情后等待 ${g.jobDetailViewWaitSeconds} 秒。`
                    : "正在读取全局运行节奏…",
                ),
                button(
                  "去设置中修改",
                  () => {
                    settingTab.value = "pace";
                    loadGlobalPace();
                    navigate("settings");
                  },
                  { link: true, type: "primary" },
                ),
              ])
            : h("div", { class: "ux-preference-group" }, rhythmControls()),
        ],
        { id: "job-pace", tabIndex: -1 },
      );
    }
    function globalPaceCheck() {
      return h("div", { class: "ux-run-mode-option" }, [
        withTip(
          check(draft.value, "useGlobalPace", "使用全局运行节奏设置"),
          "勾选后不用再填“运行节奏”这一步，直接按“设置 → 运行节奏”里的设置跑。好几个模板可以共用同一套节奏。",
        ),
      ]);
    }
    function stepContent(id) {
      if (id === "job-run-mode") return runModeCard();
      if (id === "job-preferences")
        return card("我的求职条件", prefs(draft.value), {
          id: "job-preferences",
          tabIndex: -1,
        });
      if (id === "job-sources")
        return card(sourceTitle(), sourceControls(), {
          id: "job-sources",
          tabIndex: -1,
        });
      if (id === "job-policy")
        return card("遇到不符合条件的岗位", policyControls(), {
          id: "job-policy",
          tabIndex: -1,
        });
      return paceStep();
    }
    // 找岗位 page while its run is paused: the settings stay editable, the run waits for 恢复
    function pausedBanner() {
      const r = pausedAutoRun();
      if (!r) return null;
      const p = r.progress || {};
      const collect = r.runMode === "collect";
      return h("section", { class: "ux-paused-banner", role: "status" }, [
        h("div", { class: "ux-paused-banner-head" }, [
          h("span", { class: "ux-live-dot is-waiting", "aria-hidden": "true" }),
          h("strong", "找岗位任务已暂停"),
          h("span", { class: "ux-hint" }, pauseReason(r)),
        ]),
        h("p", [
          `已查看并入库 ${p.viewed || 0}，${collect ? "已收集 " + (p.collected || 0) : "已打招呼 " + (p.sent || 0)}，已跳过 ${p.skipped || 0}`,
          tip("可以先改配置再点“恢复”：会从停下的地方接着找，处理过的岗位不会再处理。"),
        ]),
        inline([
          ...taskControls("auto", { paused: true }),
          button("查看运行进度", () => openTaskDetail(workerIds.auto), { plain: true }),
        ]),
      ]);
    }
    function autoPage() {
      const steps = autoSteps();
      const current = currentStepId(steps);
      const { sections } = autoProgress();
      const curtain = taskCurtain("auto");
      return [
        curtain,
        heading("找岗位"),
        templateBar(),
        problems(errors.value),
        pausedBanner() || runPanel("auto"),
        railCollapsed.value ? null : sectionRail(),
        stepBar(steps, current, sections),
        stepContent(current),
        // under the curtain the page is read-only; the curtain offers the way back in
        curtain ? null : footer("auto"),
      ];
    }
    // ---- page curtain while a task runs: covers this page only, the rest of the app stays usable ----
    const progressTitles = {
      running: "正在运行",
      searching: "正在检查下一批岗位",
      blocked: "已停止，请检查条件",
      waiting: "等待新岗位或会话",
      resting: "定时休息中",
      retrying: "正在重新检查",
      stopped: "已停止",
      error: "任务异常结束",
      queued: "排队等待中",
      yielded: "已让出，等待继续",
      paused: "已暂停，等待安全验证",
    };
    function sinceText(at) {
      if (!at) return "";
      const s = Math.max(0, Math.round((progressClock.value - at) / 1000));
      return s < 60 ? s + " 秒前" : Math.round(s / 60) + " 分钟前";
    }
    const curtainRunId = (task) =>
      runIds.value[task] ?? liveTasks.value[workerIds[task]]?.runRecordId ?? "current";
    function curtainShown(task) {
      return (
        Boolean(running.value[task] || queued.value[task]) &&
        String(curtainDismissed.value[task]) !== String(curtainRunId(task))
      );
    }
    function taskCurtain(task) {
      if (!curtainShown(task)) return null;
      const id = workerIds[task];
      const live = liveTasks.value[id];
      const runId = curtainRunId(task);
      const p = live?.progress || taskProgress.value[task] || {};
      const waiting = queued.value[task] && !running.value[task];
      const paused = !waiting && p.state === "paused";
      const collect = task === "auto" && draft.value.runMode === "collect";
      const name = queuedTaskLabels[id];
      const numbers =
        task === "follow"
          ? [["已检查会话", "viewed"], ["已发送", "sent"], ["已跳过", "skipped"]]
          : collect
            ? [["已查看并入库", "viewed"], ["已收集", "collected"], ["已跳过", "skipped"]]
            : [["已查看并入库", "viewed"], ["已打招呼", "sent"], ["已跳过", "skipped"]];
      return h(
        "div",
        { class: "ux-task-curtain", role: "dialog", "aria-label": name + "任务运行中" },
        [
          h("div", { class: "ux-task-curtain-card" }, [
            h("div", { class: "ux-task-curtain-head" }, [
              h("span", {
                class: ["ux-live-dot", waiting ? "is-waiting" : "", paused ? "is-paused" : ""],
                "aria-hidden": "true",
              }),
              h(
                "h2",
                waiting ? name + "任务排队中" : paused ? name + "任务已暂停" : name + "任务运行中",
              ),
              tip(
                "任务在后台跑，这时可以去资料库、求职记录等页面看数据。“查看运行进度”里有实时数字和执行日志。",
              ),
            ]),
            h(
              "p",
              { class: "ux-task-curtain-detail" },
              waiting
                ? p.detail || "其他任务运行中，轮到时自动开始。"
                : paused
                  ? p.detail
                  : (progressTitles[p.state] || "正在运行") + (p.detail ? "：" + p.detail : ""),
            ),
            waiting
              ? null
              : h(
                  "div",
                  { class: "ux-task-curtain-numbers" },
                  numbers.map(([label, key]) =>
                    h("div", [h("strong", String(liveCount(live, key) || p[key] || 0)), h("span", label)]),
                  ),
                ),
            inline([
              button("查看运行进度", () => openTaskDetail(id), { type: "primary" }),
              ...(waiting
                ? [button("取消排队", () => removeQueued(id), { type: "danger", plain: true })]
                : taskControls(task, { running: true })),
            ]),
            button(
              "返回配置页",
              () => (curtainDismissed.value = { ...curtainDismissed.value, [task]: runId }),
              { plain: true, title: "收起遮罩继续改配置，改动下次开始时生效" },
            ),
          ]),
        ],
      );
    }
    // Checklist behind the section rail. Only required and validated items count towards
    // completion: optional conditions left empty mean 不限, which is a valid choice.
    function autoProgress() {
      const d = effective();
      const issues = validation(d);
      const failing = (fields) => issues.some((i) => fields.includes(i.field));
      const check = (label, fields) => ({ label, fields, done: !failing(fields) });
      const search = d.sourceList?.find((s) => s.type === "search" && s.enabled);
      const legacyLabels = {
        categories: "岗位类别",
        description: "岗位描述",
        excluded: "排除公司",
        companies: "只看公司",
      };
      const collectAll = isCollectAll(d);
      const sections = [
        {
          id: "job-run-mode",
          label: "运行方式",
          checks: [],
          extra:
            d.runMode === "collect"
              ? collectAll
                ? "只收集（全部岗位）"
                : "只收集（符合条件的岗位）"
              : "自动打招呼",
        },
        {
          id: "job-preferences",
          label: "求职条件",
          skipped: collectAll,
          checks: collectAll ? [] : [
            ...(d.regexMode
              ? [check("岗位规则格式", ["regexTitle", "regexType", "regexDesc"])]
              : []),
            ...(d.salary ? [check("期望薪资", ["salary"])] : []),
            ...(needsCompanyList(d) ? [check("公司名单", ["companies"])] : []),
            ...(d.regexMode && d.regexExclude
              ? [check("排除公司规则", ["regexExclude"])]
              : []),
            ...Object.entries(legacyLabels)
              .filter(([key]) =>
                issues.some((i) => i.field === key && key !== "companies"),
              )
              .map(([key, label]) => check("确认原有条件：" + label, [key])),
          ],
          extra: (() => {
            const n = [
              d.cities.length,
              d.salary,
              d.experience.length,
              d.activity !== "不限",
              d.hr,
              d.companies.length,
              d.excluded.length,
              d.categories.length,
              d.description.length,
            ].filter(Boolean).length;
            return collectAll
              ? "收集全部岗位，无需配置"
              : n
                ? `已设置 ${n} 项条件`
                : "其余条件不限";
          })(),
        },
        {
          id: "job-sources",
          label: "职位来源",
          checks: [
            check("职位来源", ["source-selection"]),
            ...(search ? [check("搜索关键词", ["source"])] : []),
          ],
          extra: `已启用 ${(d.sourceList || []).filter((s) => s.enabled).length} 个来源`,
        },
        {
          id: "job-policy",
          label: "处理方式",
          skipped: collectAll,
          checks: collectAll
            ? []
            : [{ label: "默认处理方式", done: Boolean(d.strategy) }],
          extra: (() => {
            const n = Object.values(d.overrides || {}).filter(Boolean).length;
            return collectAll
              ? "收集全部岗位，无需配置"
              : n
                ? `单独处理 ${n} 种情况`
                : "全部按默认方式处理";
          })(),
        },
        {
          id: "job-pace",
          label: "运行节奏",
          checks: d.useGlobalPace || !d.pause ? [] : [check("定时休息", ["rhythm"])],
          extra: d.useGlobalPace
            ? "使用全局运行节奏"
            : d.pause
              ? `每 ${d.actions} 次操作休息 ${d.minutes} 分钟`
              : "不定时休息",
        },
      ];
      const all = sections.flatMap((section) => section.checks);
      const done = all.filter((c) => c.done).length;
      // an issue no checklist item covers still keeps the total below 100%
      const ready = !issues.length;
      const percent = ready
        ? 100
        : Math.min(99, Math.round((done / Math.max(1, all.length)) * 100));
      // count what the rail lists; one item can stand for several validation issues
      const todoCount = all.length - done || issues.length;
      return { sections, issues, ready, percent, todoCount };
    }
    function sectionRail() {
      const { sections, issues, ready, percent, todoCount } = autoProgress();
      return h(
        "aside",
        { class: "ux-section-rail", "aria-label": "配置完成度与分组导航" },
        [
          railLogin(),
          h("div", { class: "ux-rail-summary" }, [
            h("div", { class: "ux-rail-title" }, [
              h("span", "配置完成度"),
              h("strong", percent + "%"),
            ]),
            E("ElProgress", {
              percentage: percent,
              showText: false,
              strokeWidth: 6,
              status: ready ? "success" : undefined,
            }),
            ready
              ? h("p", { class: "ux-rail-state is-ready" }, draft.value.runMode === "collect" ? "已可开始收集" : "已可开始打招呼")
              : button(
                  "还有 " + todoCount + " 项未完成",
                  () => {
                    presentErrors(taskErrors("auto"), "auto");
                    focusError(issues[0]);
                  },
                  { link: true, type: "danger", class: "ux-rail-state" },
                ),
          ]),
          h(
            "nav",
            { class: "ux-section-rail-nav", "aria-label": "配置分组" },
            sections.map((section) => {
              const doneCount = section.checks.filter((c) => c.done).length;
              const complete = doneCount === section.checks.length;
              const todo = section.checks.filter((c) => !c.done);
              return h(
                "a",
                {
                  href: "#" + section.id,
                  class: [
                    "ux-rail-item",
                    complete ? "is-complete" : "is-missing",
                    section.skipped ? "is-skipped" : "",
                  ],
                  "aria-current":
                    activeAutoSection.value === section.id ? "location" : undefined,
                  onClick: (event) => {
                    event.preventDefault();
                    // an unfinished section goes straight to its first missing field
                    const issue = complete
                      ? null
                      : issues.find((i) =>
                          todo.some((c) => c.fields?.includes(i.field)),
                        );
                    if (!issue) {
                      jumpAutoSection(section.id);
                      return;
                    }
                    activeAutoSection.value = section.id;
                    validationAttempted.value = true;
                    validationTask = "auto";
                    errors.value = taskErrors("auto");
                    focusError(issue);
                  },
                },
                [
                  h("span", { class: "ux-rail-item-head" }, [
                    h("span", { class: "ux-rail-dot", "aria-hidden": "true" }),
                    h("span", { class: "ux-rail-label" }, section.label),
                    h(
                      "span",
                      {
                        class: "ux-rail-count",
                        "aria-label": section.checks.length
                          ? `必填 ${doneCount} / ${section.checks.length} 项已完成`
                          : "没有必填项",
                      },
                      section.checks.length
                        ? doneCount + "/" + section.checks.length
                        : "—",
                    ),
                  ]),
                  E("ElProgress", {
                    percentage: section.checks.length
                      ? Math.round((doneCount / section.checks.length) * 100)
                      : 100,
                    showText: false,
                    strokeWidth: 4,
                    status: complete ? "success" : "exception",
                  }),
                  h(
                    "span",
                    { class: "ux-rail-extra" },
                    complete
                      ? section.extra
                      : "待完善：" + todo.map((c) => c.label).join("、"),
                  ),
                ],
              );
            }),
          ),
        ],
      );
    }
    function runModeCard() {
      const d = draft.value;
      const collect = d.runMode === "collect";
      const modeText = !collect
        ? "看完岗位详情后，给符合条件的岗位打招呼；不符合的，按“处理方式”那一步的设置处理。"
        : d.collectOnlyMatchingJobs !== false
          ? "只把符合求职条件的岗位详情存进资料库，不打招呼，也不在BOSS上标记不合适。"
          : "遇到的岗位全部存进资料库，不看求职条件，不打招呼，也不标记；不用填求职条件和处理方式。";
      return card(
        "运行方式",
        [
          withTip(
            E(
              "ElRadioGroup",
              {
                modelValue: collect ? "collect" : "chat",
                "onUpdate:modelValue": (v) => update(d, "runMode", v),
                "aria-label": "运行方式",
              },
              () => [
                E("ElRadioButton", { value: "chat" }, () => "自动打招呼"),
                E("ElRadioButton", { value: "collect" }, () => "只收集岗位数据"),
              ],
            ),
            modeText,
            "运行方式",
          ),
          collect
            ? h("div", { class: "ux-run-mode-option" }, [
                check(
                  d,
                  "collectOnlyMatchingJobs",
                  "只收集符合求职条件的岗位",
                ),
              ])
            : null,

          globalPaceCheck(),
        ],
        { id: "job-run-mode", class: "ux-card ux-run-mode" },
      );
    }
    // pull tab on the right edge that folds the section rail away and back
    function railToggle() {
      const collapsed = railCollapsed.value;
      const { percent, ready } = autoProgress();
      return h(
        "button",
        {
          type: "button",
          class: [
            "ux-rail-toggle",
            collapsed ? "is-collapsed" : "",
            ready ? "is-ready" : "",
          ],
          "aria-label": collapsed
            ? `展开配置完成度（${percent}%）`
            : "收起配置完成度",
          "aria-expanded": String(!collapsed),
          title: collapsed ? "展开配置完成度" : "收起配置完成度",
          onClick: toggleRail,
        },
        [
          E("ElIcon", { class: "ux-rail-toggle-icon", size: 14 }, () =>
            h(collapsed ? DArrowLeft : DArrowRight),
          ),
          collapsed
            ? h("span", { class: "ux-rail-toggle-text" }, [
                h("span", "完成度"),
                h("strong", percent + "%"),
              ])
            : null,
        ],
      );
    }
    const clockTime = (ms) =>
      ms
        ? new Date(ms).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";
    const durationText = (ms) => {
      if (ms < 60 * 1000) return Math.max(0, Math.round(ms / 1000)) + " 秒";
      const minutes = Math.max(0, Math.round(ms / 60000));
      return minutes < 60
        ? minutes + " 分钟"
        : Math.floor(minutes / 60) + " 小时 " + (minutes % 60) + " 分钟";
    };
    async function removeQueued(workerId) {
      try {
        await window.electron.ipcRenderer.invoke("stop-task", workerId);
        await taskStore.getRunningTasks();
        const task = Object.keys(workerIds).find((k) => workerIds[k] === workerId);
        if (task && taskProgress.value[task]) {
          taskProgress.value[task].state = "stopped";
          taskProgress.value[task].stoppedAt = Date.now();
          taskProgress.value[task].detail = "已取消排队，任务还没开始";
        }
        R.message({ type: "success", message: "已取消排队" });
      } catch (error) {
        R.message({ type: "error", message: "取消排队失败：" + error.message });
      }
    }
    // where a finished run's data lives, filtered to the time the run took
    function historyTarget(t) {
      // tasks run one at a time, so a few seconds of slack cannot reach into the next run
      const range = [new Date(t.startedAt), new Date((t.endedAt || Date.now()) + 5 * 1000)];
      if (t.workerId === "geekAutoStartWithBossMain")
        return t.runMode === "collect"
          ? {
              route: "library",
              tab: "jobs",
              dataset: "jobLibrary",
              field: "hireStatusCheckedAt",
              label: "本次运行查看并保存的岗位",
              range,
            }
          : {
              route: "records",
              tab: "chat",
              dataset: "chatStartupLog",
              field: "date",
              label: "本次运行的开聊记录",
              range,
            };
      if (t.workerId === "jobStatusPollMain")
        return {
          route: "library",
          tab: "favorites",
          dataset: "favoriteJobs",
          field: "hireStatusCheckedAt",
          label: "本次检查过的收藏职位",
          range,
        };
      // follow-up messages have no data table
      return null;
    }
    // a table asked to show another table's rows (e.g. 招聘者 → 全部职位): open that tab
    const tabOfDataset = {
      jobLibrary: ["library", "jobs"],
      favoriteJobs: ["library", "favorites"],
      bossLibrary: ["library", "boss"],
      companyLibrary: ["library", "company"],
      chatStartupLog: ["records", "chat"],
      markAsNotSuitLog: ["records", "skip"],
    };
    R.watch(
      () => jumpStore.pending,
      (target) => {
        const place = target && tabOfDataset[target.dataset];
        if (!place) return;
        if (place[0] === "library") libraryTab.value = place[1];
        else recordTab.value = place[1];
        navigate(place[0]);
      },
    );
    // 在资料库查看: the full data page, filtered to the run's time
    function openHistoryData(t) {
      const target = historyTarget(t);
      if (!target) return;
      closeTaskDetail();
      jumpStore.jump({
        dataset: target.dataset,
        rows: [{ field: target.field, op: "between", value: target.range }],
        label: target.label + "（" + clockTime(t.startedAt) + " 起）",
      });
      if (target.route === "library") libraryTab.value = target.tab;
      else recordTab.value = target.tab;
      navigate(target.route);
    }
    // ---- task dashboard (任务列表 → 查看任务) ----
    const logFilter = ref("all");
    const logKinds = {
      viewed: ["入库", "primary"],
      collected: ["收集", "success"],
      sent: ["打招呼", "success"],
      skipped: ["跳过", "info"],
      marked: ["标记", "danger"],
      resting: ["休息", "info"],
      yielded: ["让位", "info"],
      waiting: ["等待", "info"],
      searching: ["翻页", "info"],
      retrying: ["重试", "warning"],
      paused: ["暂停", "warning"],
      blocked: ["停止", "danger"],
      error: ["异常", "danger"],
      stopped: ["停止", "info"],
      running: ["状态", "info"],
    };
    const logFilterOf = (kind) =>
      ["viewed", "collected", "sent", "marked"].includes(kind)
        ? "data"
        : kind === "skipped"
          ? "skipped"
          : "status";
    const clockSeconds = (ms) =>
      new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
    function taskDetailPage(workerId) {
      const name = queuedTaskLabels[workerId] || workerId;
      const runningEntry = taskStore.runningTasks.find((t) => t.workerId === workerId);
      const queueEntry = taskStore.taskQueue.find((t) => t.workerId === workerId);
      const lastRun = taskStore.taskHistory.find((t) => t.workerId === workerId);
      const live = liveTasks.value[workerId];
      const p = live?.progress || {};
      const args = runningEntry?.args || queueEntry?.args || [];
      const runMode =
        args.find((a) => String(a).startsWith("--run-mode="))?.split("=")[1] ||
        (workerId === workerIds.auto ? lastRun?.runMode || draft.value.runMode : null);
      const task = Object.keys(workerIds).find((k) => workerIds[k] === workerId);
      const active = Boolean(runningEntry || queueEntry);
      // a paused 找岗位 run (stopped, not terminated)
      const pausedHere = workerId === workerIds.auto && !runningEntry && !queueEntry ? pausedAutoRun() : null;
      const status = pausedHere
        ? ["已暂停", "warning"]
        : runningEntry
        ? runningEntry.yielding
          ? ["准备让位", "info"]
          : p.state === "paused"
            ? ["已暂停，等待安全验证", "warning"]
            : ["运行中", "primary"]
        : queueEntry
          ? queueEntry.reason === "yielded"
            ? ["稍后继续", "info"]
            : ["排队中", "info"]
          : p.state === "error"
            ? ["异常结束", "danger"]
            : p.state === "blocked"
              ? ["已停止", "warning"]
              : live || lastRun
                ? ["已结束", "info"]
                : ["没有运行记录", "info"];
      const startedAt = live?.firstStartedAt || lastRun?.startedAt;
      const endAt = active ? progressClock.value : p.updatedAt || lastRun?.endedAt;
      const metric = (label, value, note, unit) =>
        h("div", { class: "ux-task-metric" }, [
          h("span", { class: "ux-task-metric-label" }, label),
          h("strong", [value, unit ? h("small", unit) : null]),
          note ? h("span", { class: "ux-hint" }, note) : null,
        ]);
      const count = (key) => String(liveCount(live, key));
      const metrics =
        workerId === workerIds.follow
          ? [["已检查会话", "viewed"], ["已发送跟进", "sent"], ["已跳过", "skipped"]]
          : workerId === "jobStatusPollMain"
            ? [["已检查职位", "viewed"], ["暂时无法确认", "skipped"]]
            : runMode === "collect"
              ? [["已查看并入库", "viewed"], ["已收集", "collected"], ["已跳过", "skipped"], ["已标记不合适", "marked"]]
              : [["已查看并入库", "viewed"], ["已打招呼", "sent"], ["已跳过", "skipped"], ["已标记不合适", "marked"]];
      const minutes = startedAt && endAt ? Math.max(1, (endAt - startedAt) / 60000) : 0;
      const viewed = liveCount(live, "viewed");
      const reasons = Object.entries(p.skippedReasons || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      const maxReason = reasons[0]?.[1] || 1;
      const steps =
        workerId === workerIds.auto && live?.steps
          ? getAutoStartChatSteps().map((step) => ({
              ...step,
              status: live.steps[step.id]?.step?.status || "todo",
            }))
          : null;
      const log = (live?.log || [])
        .filter((e) => logFilter.value === "all" || logFilterOf(e.kind) === logFilter.value)
        .slice(-400)
        .reverse();
      return [
        h("div", { class: "ux-task-detail-head" }, [
          h("div", { class: "ux-page-title" }, [h("h1", name + "任务")]),
          E("ElTag", { type: status[1], disableTransitions: true }, () => status[0]),
          runMode && workerId === workerIds.auto
            ? h("span", { class: "ux-hint" }, runMode === "collect" ? "只收集岗位数据" : "自动打招呼")
            : null,
          live?.runRecordId ? h("span", { class: "ux-hint" }, "运行记录 #" + live.runRecordId) : null,
        ]),
        inline([
          queueEntry && !runningEntry
            ? button("取消排队", () => removeQueued(workerId), { type: "danger", plain: true })
            : runningEntry
              ? task
                ? taskControls(task, { running: true })
                : button("停止任务", () => ipc("stop-task", workerId), { type: "danger", plain: true })
              : task
                ? taskControls(task, { paused: pausedHere })
                : null,
          startedAt && historyTarget({ workerId, runMode })
            ? button("本次数据", () => (detailTab.value = "data"), { plain: true })
            : null,
        ]),
        pausedHere
          ? h("div", { class: "ux-task-paused-note" }, [
              h("strong", "已暂停"),
              h("span", pauseReason(pausedHere)),
              tip(
                "点“恢复”会从停下的地方接着找，处理过的岗位不会再处理，数字和日志接着累计。可以先改配置再恢复。点“终止”就结束这次运行，放进历史记录。",
              ),
            ])
          : null,
        h("div", { class: "ux-task-metrics" }, [
          metric(
            active ? "已运行" : "运行时长",
            startedAt ? durationText((endAt || Date.now()) - startedAt) : "—",
            startedAt ? "开始于 " + clockTime(startedAt) : "",
          ),
          ...metrics.map(([label, key]) => metric(label, count(key))),
          metric(
            "速度",
            minutes && viewed ? (viewed / (minutes / 60)).toFixed(0) : "—",
            "按已查看计算",
            minutes && viewed ? " 个/小时" : "",
          ),
        ]),
        h("div", { class: "ux-task-detail-grid" }, [
          card("当前操作", [
            h(
              "p",
              { class: "ux-task-current" },
              pausedHere
                ? [h("strong", "已暂停"), "：" + pauseReason(pausedHere)]
                : [
                    h("strong", progressTitles[p.state] || (active ? "正在运行" : "未在运行")),
                    p.detail ? "：" + p.detail : "",
                  ],
            ),
            p.listSummary ? hint(p.listSummary) : null,
            p.updatedAt ? hint("更新于 " + sinceText(p.updatedAt)) : null,
            steps
              ? h(
                  "ol",
                  { class: "ux-task-steps" },
                  steps.map((step) =>
                    h("li", { class: "is-" + step.status }, [
                      h(
                        "span",
                        { "aria-hidden": "true" },
                        { fulfilled: "✓", rejected: "×", pending: "…" }[step.status] || "○",
                      ),
                      step.describe,
                    ]),
                  ),
                )
              : null,
          ]),
          card(
            "跳过原因",
            reasons.length
              ? [
                  h(
                    "ul",
                    { class: "ux-task-reasons" },
                    reasons.map(([reason, n]) =>
                      h("li", [
                        h("span", { class: "ux-task-reason-text", title: reason }, reason),
                        h("span", { class: "ux-task-reason-bar" }, [
                          h("i", { style: { width: (n / maxReason) * 100 + "%" } }),
                        ]),
                        h("strong", String(n)),
                      ]),
                    ),
                  ),
                ]
              : [hint("还没有跳过的岗位。")],
          ),
        ]),
        card("执行日志", [
          h("div", { class: "ux-task-log-toolbar" }, [
            E(
              "ElRadioGroup",
              {
                modelValue: logFilter.value,
                size: "small",
                "onUpdate:modelValue": (v) => (logFilter.value = v),
              },
              () => [
                ["all", "全部"],
                ["data", "入库/打招呼"],
                ["skipped", "跳过"],
                ["status", "状态"],
              ].map(([value, label]) => E("ElRadioButton", { value }, () => label)),
            ),
            h("span", { class: "ux-hint" }, `共 ${live?.log?.length || 0} 条，最新的在上面`),
          ]),
          log.length
            ? h(
                "ol",
                { class: "ux-task-log", "aria-live": "polite" },
                log.map((e) => {
                  const [label, type] = logKinds[e.kind] || ["状态", "info"];
                  return h("li", { key: e.at + e.text }, [
                    h("time", clockSeconds(e.at)),
                    E("ElTag", { size: "small", type, disableTransitions: true }, () => label),
                    h("span", e.text),
                  ]);
                }),
              )
            : hint(active ? "任务刚开始，日志会在这里实时出现。" : "这次运行没有可显示的日志。"),
        ]),
      ];
    }
    // ---- 任务列表: the same table as 资料库 (search, filters, statistics, export) ----
    const taskTables = { current: null, history: null };
    // the table rows come from the daemon: reload when a task starts, stops or moves on
    R.watch(
      () =>
        JSON.stringify([
          taskStore.runningTasks.map((t) => [t.workerId, t.yielding]),
          taskStore.taskQueue.map((t) => [t.workerId, t.reason, t.position]),
          taskStore.taskHistory.length,
          autoResume.value?.runRecordId,
          running.value.auto,
          queued.value.auto,
        ]),
      () => {
        taskTables.current?.refresh();
        taskTables.history?.refresh();
      },
    );
    const modeClass = (row) =>
      row.workerId === workerIds.auto
        ? row.runMode === "collect"
          ? "collect"
          : "chat"
        : row.workerId === workerIds.follow
          ? "follow"
          : "poll";
    const modeTag = (row) =>
      h("span", { class: "task-mode task-mode--" + modeClass(row) }, row.mode);
    const statusTypes = {
      运行中: "primary",
      准备让位: "info",
      稍后继续: "info",
      排队中: "info",
      已暂停: "warning",
      "出错，等待重启": "danger",
      已终止: "info",
      已完成: "success",
      已停止: "info",
      出错结束: "danger",
    };
    const statusTag = (row) => {
      const verifying =
        row.status === "运行中" && liveTasks.value[row.workerId]?.progress?.state === "paused";
      return E(
        "ElTag",
        { size: "small", type: verifying ? "warning" : statusTypes[row.status] || "info", disableTransitions: true },
        () => (verifying ? "暂停，等你验证" : row.status),
      );
    };
    // the newest ended run of each task: its row offers 重新启动
    function newestEndedKeys() {
      const open = new Set(
        [
          ...taskStore.runningTasks.map((t) => t.workerId),
          ...taskStore.taskQueue.map((t) => t.workerId),
          pausedAutoRun() ? workerIds.auto : null,
        ].filter(Boolean),
      );
      const keys = {};
      for (const t of taskStore.taskHistory) {
        if (open.has(t.workerId) || keys[t.workerId]) continue;
        keys[t.workerId] =
          Number(t.runRecordId) > 0 ? t.workerId + "#" + Number(t.runRecordId) : t.id;
      }
      return keys;
    }
    function taskTable(phase) {
      const current = phase === "current";
      const columns = current
        ? [
            { key: "mode", width: 100 },
            { key: "status", width: 130 },
            { key: "progress", label: "进度", minWidth: 190 },
            { key: "startedAt", label: "开始 / 加入时间", width: 160 },
            { key: "elapsed", label: "已用时间", width: 110 },
            { key: "note", label: "现在在做", minWidth: 220 },
          ]
        : [
            { key: "mode", width: 100 },
            { key: "status", width: 110 },
            { key: "startedAt", width: 160 },
            { key: "endedAt", width: 160 },
            { key: "durationMinutes", label: "用时", width: 100, formatter: (r) => durationText((r.durationMinutes || 0) * 60000) },
            { key: "note", minWidth: 220 },
          ];
      const newest = current ? {} : newestEndedKeys();
      return h(RunDataTable, {
        key: phase,
        ref: (el) => (taskTables[phase] = el),
        dataset: "taskRuns",
        columns,
        statsPreset: runDataStatsPresets.taskRuns,
        baseFilters: [{ field: "phase", op: "eq", value: phase }],
        memoryKey: "taskRuns:" + phase,
        ignoreJumps: true,
        actionsWidth: current ? 200 : 170,
        class: "ux-native-data",
      }, {
        "cell-mode": ({ row }) => modeTag(row),
        "cell-status": ({ row }) => statusTag(row),
        "cell-progress": ({ row }) => {
          const live = liveTasks.value[row.workerId];
          const auto = row.workerId === workerIds.auto;
          if (!live || (auto && String(live.runRecordId) !== String(row.runRecordId)))
            return h("span", { class: "ux-hint" }, "—");
          return `查看 ${liveCount(live, "viewed")}，${
            row.runMode === "collect" ? "收集 " + liveCount(live, "collected") : "发送 " + liveCount(live, "sent")
          }，跳过 ${liveCount(live, "skipped")}`;
        },
        "cell-elapsed": ({ row }) =>
          row.status === "已暂停"
            ? "停了 " + durationText(progressClock.value - (row.endedMs || progressClock.value))
            : durationText(progressClock.value - (row.startedMs || progressClock.value)),
        "cell-note": ({ row }) =>
          current && row.status === "运行中"
            ? liveTasks.value[row.workerId]?.progress?.detail || "正在准备"
            : row.note || "",
        actions: ({ row }) =>
          h("span", { class: "ux-task-actions" }, [
            button("查看详情", () => openRunDetail(row), { link: true, type: "primary", size: "small" }),
            current
              ? ["排队中", "稍后继续", "出错，等待重启"].includes(row.status)
                ? button("取消排队", () => removeQueued(row.workerId), { link: true, type: "danger", size: "small" })
                : taskOf(row.workerId)
                  ? taskControls(taskOf(row.workerId), {
                      size: "small",
                      running: row.status !== "已暂停",
                      paused: row.status === "已暂停",
                    })
                  : button("停止", () => ipc("stop-task", row.workerId), { link: true, type: "danger", size: "small" })
              : newest[row.workerId] === row.key && taskOf(row.workerId)
                ? taskControls(taskOf(row.workerId), { size: "small" })
                : null,
          ]),
      });
    }
    const taskOf = (workerId) => Object.keys(workerIds).find((k) => workerIds[k] === workerId);
    function tasksPage() {
      const currentCount =
        taskStore.runningTasks.filter((t) => t.workerId in queuedTaskLabels).length +
        taskStore.taskQueue.length +
        (pausedAutoRun() ? 1 : 0);
      const tab = tasksTab.value;
      return [
        h("div", { class: "ux-task-page-head" }, [
          heading("任务列表"),
          tip(
            "找岗位、消息跟进和收藏检查都要用BOSS页面，所以一次只跑一个，其余的排队，轮到了自动开始。跑得久的任务每20分钟会让一下排队的任务，之后自动接着跑。",
          ),
        ]),
        tabBar(
          tab,
          [
            ["current", `当前任务（${currentCount}）`],
            ["history", "历史记录"],
          ],
          (v) => (tasksTab.value = v),
        ),
        h("div", { class: "ux-data-panel", key: tab }, [taskTable(tab)]),
      ];
    }
    // the details drawer, over any page
    const detailColumns = {
      favoriteJobs: [
        { key: "folderName" },
        { key: "companyName" },
        { key: "jobName" },
        { key: "hireStatus" },
        { key: "hireStatusCheckedAt", minWidth: 160 },
      ],
    };
    // 本次数据: the same view as the 资料库 / 求职记录 page (columns, row actions and their detail
    // panels), limited to the run's time
    function runDataView(t, target) {
      const shared = {
        key: target.dataset + (t.runRecordId || t.startedAt),
        baseFilters: [
          {
            field: target.field,
            op: "between",
            value: target.range.map((d) => toDbDate(d)),
          },
        ],
        memoryKey: "taskRun:" + target.dataset,
        ignoreJumps: true,
      };
      if (target.dataset === "jobLibrary")
        return h(JobLibrary, {
          ...shared,
          embedded: true,
          // the time the rows are limited by
          extraColumns: [{ key: "hireStatusCheckedAt", minWidth: 160 }],
        });
      if (target.dataset === "chatStartupLog")
        return h(StartChatRecord, { ...shared, embedded: true });
      // 收藏检查: the favourites page has folders around its table; here only its rows
      return h(
        RunDataTable,
        {
          ...shared,
          dataset: target.dataset,
          columns: detailColumns[target.dataset],
          statsPreset: runDataStatsPresets[target.dataset],
          actionsWidth: 120,
          class: "ux-native-data",
        },
        {
          actions: ({ row }) =>
            button(
              "在BOSS查看",
              () =>
                ipc("open-site-with-boss-cookie", {
                  url: `https://www.zhipin.com/job_detail/${row.encryptJobId}.html`,
                }),
              { link: true, type: "primary", size: "small", disabled: !row.encryptJobId },
            ),
        },
      );
    }
    function taskDrawer() {
      const t = selectedTask.value;
      if (!taskDetailId.value || !t) return null;
      const target = historyTarget(t);
      const runText = t.runRecordId ? "运行编号 #" + t.runRecordId : "";
      const tabs = [
        ["overview", "运行概览"],
        ["data", "本次数据"],
        ["config", "任务配置"],
      ];
      const libraryButton = target
        ? button("在资料库查看", () => openHistoryData(t), { type: "primary", plain: true })
        : null;
      let body;
      if (detailTab.value === "overview")
        body = t.current
          ? taskDetailPage(t.workerId)
          : [
              h("div", { class: "ux-task-detail-head" }, [
                h("div", { class: "ux-page-title" }, [h("h1", (queuedTaskLabels[t.workerId] || "") + "任务")]),
                E("ElTag", { type: statusTypes[t.status] || "info", disableTransitions: true }, () => t.status),
                h("span", { class: "ux-hint" }, runText),
              ]),
              h("div", { class: "ux-task-metrics" }, [
                ["开始", clockTime(t.startedAt)],
                ["结束", clockTime(t.endedAt)],
                ["用时", t.startedAt && t.endedAt ? durationText(t.endedAt - t.startedAt) : "—"],
              ].map(([label, value]) =>
                h("div", { class: "ux-task-metric" }, [
                  h("span", { class: "ux-task-metric-label" }, label),
                  h("strong", value || "—"),
                ]),
              )),
              t.note ? h("p", { class: "ux-task-current" }, t.note) : null,
              inline([
                target ? button("本次数据", () => (detailTab.value = "data"), { plain: true }) : null,
                libraryButton,
              ]),
            ];
      else if (detailTab.value === "data")
        body = target
          ? [
              h("div", { class: "ux-task-data-head" }, [
                h("span", target.label.replace(/^本次/, "这次")),
                tip("按这次运行的开始和结束时间筛出来的数据。之后再查看或更新过的岗位，也可能出现在这里。"),
                libraryButton,
              ]),
              h("div", { class: "ux-data-panel ux-task-data-panel" }, [
                runDataView(t, target),
              ]),
            ]
          : [hint("消息跟进没有单独的数据表，发送的内容在“运行概览”的执行日志里。")]; 
      else
        body = [
          h("div", { class: "ux-task-data-head" }, [
            h("span", "没有保存这次运行时的配置"),
            tip("配置页显示的是现在的设置，不一定是这次运行用的。"),
          ]),
          button(
            "打开配置页",
            () => {
              const route =
                t.workerId === workerIds.follow ? "follow" : t.workerId === workerIds.auto ? "auto" : "library";
              if (route === "library") libraryTab.value = "favorites";
              closeTaskDetail();
              navigate(route);
            },
            { plain: true },
          ),
        ];
      return E(
        "ElDrawer",
        {
          modelValue: true,
          title: "任务详情（" + (t.workerId === workerIds.auto ? (t.runMode === "collect" ? "只收集" : "打招呼") : queuedTaskLabels[t.workerId]) + "）",
          size: "min(1100px, 92vw)",
          class: "ux-task-drawer",
          destroyOnClose: true,
          "onUpdate:modelValue": (v) => {
            if (!v) closeTaskDetail();
          },
        },
        () => [tabBar(detailTab.value, tabs, (v) => (detailTab.value = v)), h("div", { class: "ux-task-drawer-body" }, body)],
      );
    }
    function railLogin() {
      const { status, detail } = bossLogin.value;
      const needsLogin = status === "invalid" || status === "missing";
      return h(
        "div",
        {
          class: ["ux-rail-login", "is-" + status],
          role: "status",
          "aria-label": "BOSS直聘登录状态",
        },
        [
          h("div", { class: "ux-rail-login-head" }, [
            h("span", { class: "ux-rail-dot", "aria-hidden": "true" }),
            h("span", { class: "ux-rail-login-label" }, "BOSS账号"),
            h("strong", loginStatusText[status] || status),
          ]),
          detail && status !== "valid"
            ? h("p", { class: "ux-rail-login-detail" }, detail)
            : null,
          h("div", { class: "ux-rail-login-actions" }, [
            needsLogin
              ? button(status === "missing" ? "去登录" : "重新登录", goToLoginSetup, {
                  link: true,
                  type: "primary",
                  size: "small",
                })
              : null,
            button("重新检测", refreshLoginStatus, {
              link: true,
              size: "small",
              disabled: status === "checking",
            }),
          ]),
        ],
      );
    }
    function heading(title, desc) {
      return h("header", [
        h("div", { class: "ux-page-title" }, [h("h1", title), desc ? tip(desc, title) : null]),
      ]);
    }
    function footer(task) {
      return h("footer", { class: "ux-footer" }, [
        errors.value.length
          ? button(
              "还有 " + errors.value.length + " 项没填完，去填写",
              () => focusError(errors.value[0]),
              {
                class: "ux-validation-link",
                type: "danger",
                link: true,
                "aria-label": "定位到第一个未完成项",
              },
            )
          : h(
              "span",
              {
                class: draftSaveError.value ? "ux-error" : "ux-hint",
                role: "status",
              },
              running.value[task]
                ? "运行中，改动下次生效"
                : queued.value[task]
                  ? "排队中，开始时用当时保存的条件"
                : draftSaveError.value ||
                    (draftSaveState.value.includes("保存中")
                      ? "草稿保存中…"
                      : "修改自动保留"),
            ),
        draftSaveError.value
          ? button("重试保存", () => save(false, task), { plain: true })
          : null,
        ...(task === "auto" ? stepButtons() : []),
        button(
          (task === "follow"
            ? "开始跟进"
            : draft.value.runMode === "collect"
              ? "开始收集"
              : "开始打招呼") + (otherTaskBusy(task) ? "（排队）" : ""),
          () => begin(task),
          {
            type: "primary",
            // before the last step, starting is still possible but not the suggested action
            plain: task === "auto" && !onLastStep(),
            loading: preparing.value || starting.value,
            disabled:
              running.value[task] || queued.value[task] || starting.value,
            title: otherTaskBusy(task)
              ? "其他任务运行中，开始后会加入队列，轮到时自动运行"
              : undefined,
          },
        ),
      ]);
    }
    function onLastStep() {
      const steps = autoSteps().filter((s) => !s.skipped);
      return steps[steps.length - 1]?.id === currentStepId();
    }
    function stepButtons() {
      const steps = autoSteps().filter((s) => !s.skipped);
      const at = steps.findIndex((s) => s.id === currentStepId());
      return [
        at > 0 ? button("上一步", () => moveStep(-1), { plain: true }) : null,
        at < steps.length - 1
          ? button("下一步：" + steps[at + 1].label, () => moveStep(1), {
              type: "primary",
            })
          : null,
      ];
    }
    // another BOSS task holds the queue, so starting this one only queues it
    function otherTaskBusy(task) {
      return (
        taskStore.runningTasks.some(
          (t) => t.workerId in queuedTaskLabels && t.workerId !== workerIds[task],
        ) ||
        taskStore.taskQueue.some((t) => t.workerId !== workerIds[task])
      );
    }
    function emotionBubble(label) {
      return E(
        "ElPopover",
        { trigger: "click", width: 190, placement: "top" },
        {
          reference: () =>
            button("?", () => {}, {
              circle: true,
              size: "small",
              "aria-label": label,
            }),
          default: () => [
            h("p", "BOSS中的“期待回复”表情"),
            h("img", {
              src: "assets/look-forward-reply-emotion-yjNLsJac.gif",
              alt: "期待回复表情示意",
              width: 90,
              height: 90,
            }),
            hint("仅展示表情，不会发送。"),
          ],
        },
      );
    }
    function failureField(f) {
      return field(
        "AI生成失败时",
        inline([
          select(
            f,
            "fallback",
            [
              ["emotion", "改发“期待回复”表情"],
              ["stop", "停止整个跟进任务"],
            ],
            { "aria-label": "AI失败处理" },
          ),
          f.fallback === "emotion"
            ? emotionBubble("查看失败时发送的期待回复表情")
            : null,
        ]),
      );
    }
    function contextField(f) {
      return field(
        "AI参考多少条你发过的消息",
        number(f, "context", {
          min: 8,
          max: 20,
          precision: 0,
          "aria-label": "聊天上下文条数",
        }),
        "可选8—20条。AI会参考你最近发过的这些消息，避免重复发送相似内容。",
        false,
        "follow-context",
      );
    }
    function supplementalControls() {
      const f = follow.value;
      return [
        field(
          "补充消息发送方式",
          select(
            f,
            "opening",
            [
              ["fixed", "发送固定消息"],
              ["ai", "AI生成补充消息"],
            ],
            { "aria-label": "首次补充消息来源" },
          ),
        ),
        f.opening === "fixed"
          ? h("div", { class: "ux-field" }, [
              h("label", { for: "supplemental-text" }, [
                "补充消息内容",
                tip("不填就用软件自带的话术；不会改你BOSS账号里的默认招呼语。", "补充消息内容"),
              ]),
              input(f, "openingText", {
                id: "supplemental-text",
                type: "textarea",
                rows: 3,
                "aria-label": "补充消息内容",
                placeholder:
                  "例如：您好，我对这个岗位很感兴趣，希望进一步沟通。",
              }),
            ])
          : h("div", [
              alert(
                "运行时会将简历发送给你设置的AI服务商，请检查生成内容与隐私政策。",
              ),
              inline([
                button(
                  "设置AI模型",
                  () => {
                    navigate("settings");
                    settingTab.value = "ai";
                  },
                  { type: "primary", plain: true },
                ),
                button("查看 / 编辑简历", () =>
                  openLegacy("简历编辑", "/resumeEditor"),
                ),
                button("编辑补充消息提示词", () => openPrompt("open")),
                tip("按你的简历生成补充消息；生成失败时改发固定消息。", "AI补充消息"),
              ]),
            ]),
      ];
    }
    function followMessageHelp() {
      return E(
        "ElPopover",
        { trigger: "click", width: 340, placement: "top" },
        {
          reference: () =>
            button("?", () => {}, {
              circle: true,
              size: "small",
              "aria-label": "查看两类消息的发送区别",
            }),
          default: () => [
            h(
              "p",
              "软件会先忽略系统提示、自动提问和特定平台消息，再检查你发过的历史消息。",
            ),
            h("p", "没有可用历史消息：使用「首次补充消息」。"),
            h("p", "已有可用历史消息：使用「后续跟进消息」。"),
            h("p", "历史消息不只包含文字，也可能包含表情、图片等。"),
          ],
        },
      );
    }
    function followPage() {
      const f = follow.value,
        d = effective(),
        roleReady = d.categories.length || d.legacyPatterns?.categories;
      return [
        taskCurtain("follow"),
        heading("消息跟进", "只跟进对方已读但没回的会话，不会自动回复对方发来的消息。"),
        problems(errors.value),
        runPanel("follow"),
        card(
          "跟进哪些会话",
          [
            h("div", { class: "ux-form-row" }, [
              field(
                "查看最近几天的会话",
                number(f, "days", {
                  min: 0,
                  precision: 0,
                  "aria-label": "跟进天数",
                }),
                "0表示不限时间，会检查较早的会话，请留意联系范围。",
                false,
                "follow-days",
              ),
              field(
                "同一会话再次联系的最短间隔（分钟）",
                number(f, "interval", {
                  min: 3,
                  step: 0.5,
                  precision: 1,
                  "aria-label": "跟进间隔",
                }),
                "至少3分钟，另加0—4分钟随机等待；不控制不同招聘者之间的发送间隔。",
                false,
                "follow-interval",
              ),
            ]),
            validationArea("follow-categories", [
              check(f, "roleOnly", "只跟进这些职位分类的会话", {
                disabled: !roleReady && !f.roleOnly,
              }),
              requiredBadge("follow-categories"),
              inline([
                d.categories.length
                  ? explain([
                      "已设置 ",
                      metric(d.categories.length),
                      " 项：",
                      d.categories.slice(0, 3).join("、"),
                      d.categories.length > 3 ? " 等" : "",
                    ])
                  : hint(
                      roleReady
                        ? "沿用已保存的职位分类规则。"
                        : "先设置职位分类；关闭此项则不限职位分类。",
                    ),
                button(
                  "设置职位分类",
                  () => openFollowCondition("categories"),
                  {
                    plain: true,
                    size: "small",
                  },
                ),
                tip("只看会话对应岗位的职位分类；分类和找岗位共用，不会再查城市和薪资。"),
              ]),
            ]),
            validationArea("follow-excluded", [
              check(f, "exclude", "排除指定公司的会话"),
              inline([
                companySummary(d, "excluded"),
                button("设置排除公司", () => openCompanies("excluded"), {
                  plain: true,
                  size: "small",
                }),
                tip("和找岗位里“不看这些公司”用的是同一份名单。"),
              ]),
            ]),
          ],
          { id: "follow-conversations" },
        ),
        card(
          h("span", { class: "ux-title-with-help" }, [
            h("span", "消息内容"),
            followMessageHelp(),
          ]),
          [
            h(
              "div",
              { class: "ux-preference-group", id: "follow-supplemental" },
              [
                h("h3", ["首次补充消息", tip("还没有能用来跟进的聊天记录时，先发一段补充消息。", "首次补充消息")]),
                h("div", { class: "ux-message-form" }, supplementalControls()),
              ],
            ),
            h(
              "div",
              { class: "ux-preference-group", id: "follow-subsequent" },
              [
                h("h3", ["后续跟进消息", tip("已经有聊天记录、对方还没回时，再发一条跟进。", "后续跟进消息")]),
                h("div", { class: "ux-message-form" }, [
                  field(
                    "后续消息发送方式",
                    inline([
                      select(
                        f,
                        "source",
                        [
                          ["emotion", "发送“期待回复”表情"],
                          ["ai", "根据聊天内容生成（AI）"],
                        ],
                        { "aria-label": "后续跟进消息来源" },
                      ),
                      f.source === "emotion"
                        ? emotionBubble("查看期待回复表情")
                        : null,
                      f.source === "emotion"
                        ? tip("不用写消息，也不用设置AI。", "期待回复表情")
                        : null,
                    ]),
                  ),
                  f.source === "emotion"
                    ? null
                    : h("div", [
                        alert(
                          "运行时会调用你设置的AI服务，简历和选取的聊天内容将发送给该服务商。请检查生成内容与隐私政策。",
                        ),
                        inline([
                          button(
                            "设置AI模型",
                            () => {
                              navigate("settings");
                              settingTab.value = "ai";
                            },
                            { type: "primary", plain: true },
                          ),
                          button("查看 / 编辑简历", () =>
                            openLegacy("简历编辑", "/resumeEditor"),
                          ),
                          button("编辑后续跟进提示词", () =>
                            openPrompt("rechat"),
                          ),
                          tip("简历里只留必要的内容，不要放密码、联系方式这类敏感信息。"),
                        ]),
                      ]),
                  f.source === "ai"
                    ? h("div", { class: "ux-form-row" }, [
                        failureField(f),
                        contextField(f),
                      ])
                    : null,
                ]),
              ],
            ),
          ],
          { id: "follow-message-content" },
        ),
        curtainShown("follow") ? null : footer("follow"),
      ];
    }
    function openFollowCondition(key) {
      navigate("auto");
      R.nextTick(() => {
        const el = document.querySelector('[data-condition="' + key + '"]');
        el?.scrollIntoView({ block: "center" });
        el?.querySelector("input,textarea")?.focus();
      });
    }
    function tabBar(model, options, onChange) {
      return E(
        "ElTabs",
        { modelValue: model, "onUpdate:modelValue": onChange },
        options.map(([name, label]) => E("ElTabPane", { name, label })),
      );
    }
    function dataPage(library) {
      const tabs = library
        ? [
            ["jobs", "职位"],
            ["favorites", "收藏夹"],
            ["boss", "招聘者"],
            ["company", "公司"],
          ]
        : [
            ["chat", "已开聊"],
            ["skip", "已跳过 / 已标记"],
          ];
      const selected = library ? libraryTab.value : recordTab.value;
      const routes = {
        jobs: "JobLibrary",
        boss: "BossLibrary",
        company: "CompanyLibrary",
        favorites: "FavoriteJobs",
        chat: "StartChatRecord",
        skip: "MarkAsNotSuitRecord",
      };
      return [
        heading(
          library ? "资料库" : "求职记录",
          (library
            ? "各类数据分开保存，在这里切换查看。"
            : "这里是已开聊和已跳过的岗位，不含消息跟进的记录。") +
            (selected === "skip"
              ? "本地跳过不代表已经在BOSS上标记。"
              : selected === "favorites"
                ? "收藏夹里的职位会定时检查是否已关闭；在职位或记录列表里选中职位，点“收藏到…”就能收藏。"
                : "这些是本机保存的数据；岗位详情是保存时的内容，想看最新的请点“在BOSS查看”。"),
        ),
        tabBar(selected, tabs, (v) => {
          if (library) libraryTab.value = v;
          else recordTab.value = v;
        }),
        h("div", { class: "ux-data-panel", key: selected }, [
          legacyFrame("/main-layout/" + routes[selected], routes[selected]),
        ]),
      ];
    }
    async function openPrompt(kind) {
      promptKind.value = kind;
      promptText.value = await native.readPrompt(kind);
      modal.value = "prompt";
    }
    async function savePrompt() {
      if (!promptText.value.trim()) {
        R.message({ type: "error", message: "提示词不能为空" });
        return;
      }
      if (
        promptKind.value === "rechat" &&
        !promptText.value.includes("__REPLACE_REAL_RESUME_HERE__")
      ) {
        R.message({
          type: "error",
          message: "请保留简历占位符 __REPLACE_REAL_RESUME_HERE__",
        });
        return;
      }
      await native.savePrompt(promptKind.value, promptText.value);
      modal.value = "";
      R.message({ type: "success", message: "提示词已保存" });
    }
    function settingsPage() {
      const tab = settingTab.value;
      return [
        heading(
          "设置",
          "只有需要时再调整账号、浏览器和AI；普通开聊无需先配置AI。",
        ),
        tabBar(
          tab,
          [
            ["account", "账号与登录"],
            ["browser", "浏览器"],
            ["ai", "AI模型配置"],
            ["notify", "钉钉通知"],
            ["templates", "配置模板"],
            ["pace", "运行节奏"],
            ["data", "数据、备份与日志"],
          ],
          (v) => {
            settingTab.value = v;
            if (v === "data") loadDataSettings();
            if (v === "pace") loadGlobalPace();
          },
        ),
        tab === "account"
          ? card("BOSS账号与登录", [
              alert(
                "BOSS直聘：" +
                  (loginStatusText[bossLogin.value.status] || "") +
                  (bossLogin.value.detail && bossLogin.value.status !== "valid"
                    ? "（" + bossLogin.value.detail + "）"
                    : ""),
                { valid: "success", unknown: "warning", checking: "info" }[
                  bossLogin.value.status
                ] || "error",
              ),
              h("div", { class: "ux-inline ux-account-actions" }, [
                button(
                  "编辑登录凭证",
                  () => openLegacy("编辑登录凭证", "/cookieAssistant"),
                  {
                    type: "primary",
                  },
                ),
                button(
                  "打开BOSS网站",
                  () =>
                    window.electron.ipcRenderer.invoke(
                      "open-site-with-boss-cookie",
                      {
                        url: "https://www.zhipin.com/web/geek/job",
                      },
                    ),
                  { plain: true, disabled: !browser.value },
                ),
                button("重新检测", checkLoginNow, {
                  plain: true,
                  loading: dataBusy.value === "login",
                }),
                tip("登录凭证很敏感，别把截图或日志发给别人。检测时会用它向BOSS直聘问一次账号信息，不会打开浏览器；打开软件和开始任务前也会自动检测。"),
              ]),
              !browser.value ? hint("打开BOSS网站前，请先配置浏览器。") : null,
            ])
          : null,
        tab === "browser"
          ? card("浏览器", [
              alert(
                browser.value ? "浏览器已配置" : "浏览器未配置",
                browser.value ? "success" : "warning",
              ),
              field(
                "浏览器可执行文件路径",
                input(browserForm.value, "path", {
                  "aria-label": "浏览器可执行文件路径",
                  placeholder: "选择或输入浏览器 .exe 路径",
                  onBlur: () => validateBrowserPath(),
                }),
              ),
              browserError.value
                ? h(
                    "p",
                    { class: "ux-error", role: "alert" },
                    browserError.value,
                  )
                : null,
              inline([
                button(
                  "自动检测",
                  async () => {
                    browserBusy.value = true;
                    try {
                      const found =
                        await window.electron.ipcRenderer.invoke(
                          "ux-find-browser",
                        );
                      if (found) {
                        browserForm.value.path = found.executablePath;
                        browserError.value = "";
                        R.message({
                          type: "success",
                          message: "路径已填入，请保存配置",
                        });
                      } else
                        browserError.value =
                          "未检测到可用浏览器，请手动选择或下载。";
                    } catch (error) {
                      browserError.value = "自动检测失败：" + error.message;
                    } finally {
                      browserBusy.value = false;
                    }
                  },
                  { loading: browserBusy.value },
                ),
                button("手动选择", async () => {
                  const r = await window.electron.ipcRenderer.invoke(
                    "choose-file",
                    {
                      fileChooserConfig: { properties: ["openFile"] },
                    },
                  );
                  if (!r.canceled && r.filePaths?.length) {
                    browserForm.value.path = r.filePaths[0];
                    browserError.value = "";
                  }
                }),
                button(
                  "下载浏览器",
                  async () => {
                    browserBusy.value = true;
                    try {
                      browserForm.value.path =
                        await window.electron.ipcRenderer.invoke(
                          "ux-download-browser",
                        );
                      browserError.value = "";
                      R.message({
                        type: "success",
                        message: "下载完成，请保存配置",
                      });
                    } catch (error) {
                      if (!/CANCEL/i.test(error.message))
                        browserError.value = "下载失败，请重试或手动选择。";
                    } finally {
                      browserBusy.value = false;
                    }
                  },
                  { loading: browserBusy.value },
                ),
                button("保存浏览器配置", saveBrowser, {
                  type: "primary",
                  disabled: browserBusy.value,
                }),
                tip("找到浏览器文件不代表版本一定能用，开始任务时还会再检查。下载窗口里可以看进度、取消或失败重试。"),
              ]),
            ])
          : null,
        tab === "ai" ? aiSettings() : null,
        tab === "ai" ? aiFooter() : null,
        ...(tab === "data" ? dataSettings() : []),
        ...(tab === "templates" ? templateSettings() : []),
        tab === "pace"
          ? card(
              [
                "全局运行节奏",
                tip(
                  "在“找岗位 → 运行节奏”里勾了“使用全局运行节奏设置”的配置，都按这里的节奏跑。改完从下次开始任务起生效。",
                  "全局运行节奏",
                ),
              ],
              [
                ...(paceForm.value
                  ? rhythmControls(paceForm.value, "global-rhythm")
                  : [hint("正在读取…")]),
                inline([
                  button("保存全局运行节奏", saveGlobalPace, {
                    type: "primary",
                    loading: paceSaving.value,
                    disabled: !paceForm.value,
                  }),
                ]),
              ],
              { class: "ux-card ux-data-card" },
            )
          : null,
        tab === "notify"
          ? card("钉钉通知", [
              alert(
                dingtalkConfigured() ? "钉钉通知已开启" : "钉钉通知未开启",
                dingtalkConfigured() ? "success" : "info",
              ),
              field(
                "群机器人 AccessToken",
                input(dingtalkForm.value, "token", {
                  type: "password",
                  showPassword: true,
                  autocomplete: "off",
                  "aria-label": "钉钉群机器人 AccessToken",
                  placeholder: dingtalkConfigured()
                    ? "已保存（不显示），输入新的令牌可替换"
                    : "机器人 Webhook 地址，或其中 access_token= 后面的部分",
                }),
                "自动打招呼运行时，开聊记录和运行错误会每 2 分钟合并发送到该群。请勿使用公司内部群。令牌只保存在本机，界面不会读取。",
              ),
              inline([
                button("保存钉钉配置", () => saveDingtalk(false), {
                  type: "primary",
                  loading: dingtalkBusy.value,
                  disabled: !dingtalkForm.value.token.trim(),
                }),
                dingtalkConfigured()
                  ? button("关闭通知", () => saveDingtalk(true), {
                      plain: true,
                      disabled: dingtalkBusy.value,
                    })
                  : null,
                tip("改完从下次开始任务起生效。"),
              ]),
            ])
          : null,
      ];
    }
    // ---- data folder & database backups ----
    const dataInfo = ref(null),
      backupInfo = ref(null),
      logInfo = ref(null),
      dataBusy = ref(""),
      dataTarget = ref(""),
      dataMode = ref("copy");
    const ipc = (channel, payload) =>
      window.electron.ipcRenderer.invoke(channel, payload).catch((error) => {
        throw new Error(
          String(error?.message ?? error).replace(
            /^Error invoking remote method '[^']*': (Error: )?/,
            "",
          ),
        );
      });
    let restoreNoticeShown = false;
    async function loadDataSettings() {
      const [location, backup, logs] = await Promise.all([
        ipc("data-location-info"),
        ipc("db-backup-info"),
        ipc("log-settings-info"),
      ]);
      dataInfo.value = location;
      backupInfo.value = backup;
      logInfo.value = logs;
      showRestoreNotice(backup.restoreResult);
    }
    // a restore is applied while the app restarts; say how it went once it is back
    function showRestoreNotice(restored) {
      if (restored && !restoreNoticeShown) {
        restoreNoticeShown = true;
        R.message({
          type: restored.ok ? "success" : "error",
          message: restored.ok
            ? "已从备份恢复数据库：" + restored.file.split(/[\\/]/).pop()
            : "恢复备份失败：" + (restored.error || "未知错误") + "，仍在使用原数据库",
          duration: 6000,
        });
      }
    }
    async function withDataBusy(key, fn) {
      if (dataBusy.value) return;
      dataBusy.value = key;
      try {
        return await fn();
      } catch (error) {
        R.message({ type: "error", message: error.message });
      } finally {
        dataBusy.value = "";
      }
    }
    const confirmBox = (text, title, confirmButtonText) =>
      ElMessageBox.confirm(text, title, {
        type: "warning",
        confirmButtonText,
        cancelButtonText: "取消",
      }).then(
        () => true,
        () => false,
      );
    // ---- BOSS login state: shown in the section rail, checked before a task starts ----
    const bossLogin = ref({ status: "checking", detail: "", checkedAt: 0 });
    const loginStatusText = {
      checking: "正在检测…",
      valid: "登录正常",
      invalid: "登录已失效",
      missing: "未登录",
      unknown: "暂时无法确认",
    };
    async function refreshLoginStatus() {
      bossLogin.value = { ...bossLogin.value, status: "checking" };
      try {
        const result = await ipc("boss-login-status");
        bossLogin.value = { ...result, checkedAt: Date.now() };
      } catch (error) {
        bossLogin.value = {
          status: "unknown",
          detail: error.message,
          checkedAt: Date.now(),
        };
      }
      login.value = bossLogin.value.status !== "missing";
      return bossLogin.value;
    }
    // opens the BOSS login assistant; true once a login was saved and works
    async function loginWithAssistant() {
      try {
        await ipc("login-with-cookie-assistant");
      } catch {
        // closed without saving
        await refreshLoginStatus();
        return false;
      }
      try {
        await native.refresh();
      } catch {
        // the login check below reads the saved file itself
      }
      return (await refreshLoginStatus()).status === "valid";
    }
    async function goToLoginSetup() {
      settingTab.value = "account";
      await navigate("settings");
      return loginWithAssistant();
    }
    /**
     * Before a task starts: a missing or expired login takes the user to the login setup;
     * once it works again they come back here and the start continues.
     */
    async function ensureBossLogin(task) {
      const result = await refreshLoginStatus();
      if (result.status === "valid") return true;
      if (result.status === "unknown") {
        R.message({
          type: "warning",
          message: "暂时无法确认登录状态（" + result.detail + "），任务运行时会再次确认。",
          duration: 5000,
        });
        return true;
      }
      R.message({
        type: "error",
        message:
          result.status === "missing"
            ? "还没有登录BOSS直聘，请先完成登录。"
            : "BOSS直聘登录已失效（" + result.detail + "），请重新登录。",
        duration: 5000,
      });
      const back = route.value;
      const ok = await goToLoginSetup();
      await navigate(task === "follow" ? "follow" : back === "settings" ? "auto" : back);
      if (ok) R.message({ type: "success", message: "登录成功，继续开始任务。" });
      return ok;
    }
    let browsing = false;
    async function browseBossSelf() {
      if (browsing) return;
      browsing = true;
      try {
        const ok = await ElMessageBox.confirm(
          "会打开一个已登录的BOSS直聘窗口，由你自己看岗位、聊天。你看过的岗位、发起的聊天和标记的不合适，都会记到资料库里。",
          "打开BOSS直聘自己逛？",
          { type: "info", confirmButtonText: "打开", cancelButtonText: "取消" },
        ).then(
          () => true,
          () => false,
        );
        if (!ok) return;
        const result = await refreshLoginStatus();
        if (result.status === "invalid" || result.status === "missing") {
          R.message({
            type: "error",
            message:
              result.status === "missing"
                ? "还没有登录BOSS直聘，请先完成登录。"
                : "BOSS直聘登录已失效，请重新登录。",
          });
          if (!(await goToLoginSetup())) return;
        }
        await ipc("open-site-with-boss-cookie", { url: "https://www.zhipin.com/" });
        R.message({
          type: "success",
          title: "已打开BOSS直聘",
          message: "你浏览过的职位、发起的开聊和标记的不合适都会记录到资料库。",
        });
      } catch (error) {
        R.message({ type: "error", message: "打开BOSS直聘失败：" + error.message });
      } finally {
        browsing = false;
      }
    }
    // ---- configuration template management (settings → 配置模板) ----
    const templateView = ref(null),
      templateImporting = ref(false);
    function templateFacts(sn = {}) {
      const list = (v) => (Array.isArray(v) && v.length ? v.join("、") : "");
      const collect = sn.runMode === "collect";
      const sources = (sn.sourceList || [])
        .filter((x) => x.enabled)
        .map((x) => {
          const label = sourceInfo[x.type]?.[0] || x.type;
          const words = (x.children || [])
            .filter((c) => c.enabled && c.keyword)
            .map((c) => c.keyword);
          return words.length ? `${label}（${words.join("、")}）` : label;
        });
      return [
        [
          "运行方式",
          collect
            ? sn.collectOnlyMatchingJobs === false
              ? "只收集（全部岗位）"
              : "只收集（符合条件的岗位）"
            : "自动打招呼",
        ],
        [
          "目标岗位",
          sn.regexMode
            ? "高级规则：" + (sn.regexTitle || "—")
            : list(sn.titles) || (sn.legacyPatterns?.titles ? "沿用原有条件" : "不限"),
        ],
        ["职位分类", list(sn.categories) || "不限"],
        ["岗位描述包含", list(sn.description) || "不限"],
        ["工作城市", list(sn.cities) || "不限"],
        [
          "期望薪资",
          sn.salary
            ? ((unit) =>
                sn.low != null && sn.high != null
                  ? `${sn.low} – ${sn.high} ${unit}`
                  : sn.low != null
                    ? `${sn.low} ${unit}以上`
                    : `${sn.high} ${unit}以下`)(sn.unit === "year" ? "元/年" : "元/月")
            : "不限",
        ],
        ["工作经验", list(sn.experience) || "不限"],
        ["只看公司", list(sn.companies) || "不限"],
        ["排除公司", list(sn.excluded) || (sn.legacyPatterns?.excluded ? "沿用原有规则" : "无")],
        ["招聘者活跃", sn.activity || "不限"],
        ["职位来源", sources.join("；") || "未选择"],
        ["默认处理方式", strategyLabel(sn.strategy)],
        [
          "运行节奏",
          sn.useGlobalPace
            ? "使用全局运行节奏"
            : sn.pause
              ? `每 ${sn.actions} 次操作休息 ${sn.minutes} 分钟`
              : "不定时休息",
        ],
      ];
    }
    const fileDate = () => new Date().toISOString().slice(0, 10);
    async function exportTemplatesToFile(items, fileName) {
      if (!items.length) return;
      const result = await ipc("save-file-with-dialog", {
        defaultPath: fileName,
        filters: [{ name: "配置模板", extensions: ["json"] }],
        content: exportTemplates(items),
      });
      if (result?.canceled) return;
      R.message({
        type: "success",
        title: "已导出 " + items.length + " 个模板",
        message: result.filePath,
      });
      ipc("show-item-in-folder", result.filePath).catch(() => void 0);
    }
    function pickTextFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
      });
    }
    async function importTemplatesFromFile() {
      if (templateImporting.value) return;
      const file = await pickTextFile(".json,application/json");
      if (!file) return;
      templateImporting.value = true;
      try {
        const { templates: incoming, skipped } = parseTemplateFile(await file.text());
        if (!(await flushDraft())) throw new Error("当前草稿保存失败，请重试。");
        const items = clone(templates.value);
        const renamed = [];
        for (const t of incoming) {
          const name = uniqueName(
            t.name,
            items.map((x) => x.name),
          );
          if (name !== t.name) renamed.push(name);
          // fields a template from another version lacks take the current values
          const snapshot = keywordDraft({ ...templateSnapshot(), ...clone(t.snapshot) });
          snapshot.inherit = false;
          snapshot.inheritedFields = [];
          items.push({
            id:
              globalThis.crypto?.randomUUID?.() ||
              "template-" + Date.now() + "-" + Math.random().toString(36).slice(2),
            name,
            snapshot,
          });
        }
        if (!(await writeTemplateState(items, activeTemplate.value, templateBaseline.value)))
          return;
        templates.value = items;
        R.message({
          type: "success",
          title: "已导入 " + incoming.length + " 个模板",
          message:
            [
              renamed.length ? "重名的已改名为：" + renamed.join("、") : "",
              skipped ? skipped + " 个缺少名称或内容的模板未导入" : "",
            ]
              .filter(Boolean)
              .join("；") || "可在找岗位页的“配置模板”中选用。",
        });
      } catch (error) {
        R.message({ type: "error", title: "导入失败", message: error.message });
      } finally {
        templateImporting.value = false;
      }
    }
    async function deleteTemplateById(t) {
      if (running.value.auto) {
        R.message({ type: "warning", message: "找岗位任务运行中，停止后才能删除模板。" });
        return;
      }
      if (
        !(await confirmBox(
          `删除模板“${t.name}”？删除后可在提示中撤销。`,
          "删除配置模板",
          "删除",
        ))
      )
        return;
      await commitTemplate("delete", "", t.id);
    }
    function useTemplate(t) {
      if (running.value.auto) {
        R.message({ type: "warning", message: "找岗位任务运行中，停止后才能切换模板。" });
        return;
      }
      templateView.value = null;
      selectTemplate(t.id);
      navigate("auto");
    }
    // rows of the 配置模板 table; 状态 says which one is in use and which have unsaved edits
    function templateRows(items) {
      const modified = templateModified();
      return items.map((t, index) => {
        const facts = templateFacts(t.snapshot);
        const active = t.id === activeTemplate.value;
        const unsaved = Boolean(templateDrafts.value[t.id]) || (active && modified);
        return {
          id: t.id,
          order: index + 1,
          name: t.name,
          status: [active ? "使用中" : unsaved ? "" : "未使用", unsaved ? "有改动没保存" : ""]
            .filter(Boolean)
            .join("，"),
          runMode: facts[0][1],
          titles: facts[1][1],
          sources: facts[10][1],
        };
      });
    }
    function templateSettings() {
      const items = templates.value;
      const view = templateView.value;
      return [
        card(
          [
            "配置模板",
            tip(
              "模板存的是一整套找岗位配置：运行方式、求职条件、职位来源、处理方式和运行节奏。这里可以查看、删除，也可以导出成文件备份，或者在另一台电脑上导入。",
              "配置模板",
            ),
          ],
          [
            inline([
              button("导入模板…", importTemplatesFromFile, {
                type: "primary",
                plain: true,
                loading: templateImporting.value,
              }),
              button(
                "导出全部",
                () => exportTemplatesToFile(items, `牛人快跑配置模板-${fileDate()}.json`),
                { plain: true, disabled: !items.length },
              ),
              tip("导出的文件只有配置条件，不含登录凭证、API密钥这些敏感信息。", "导出模板"),
            ]),
            // the same table as 资料库; the page sends the rows (templates live in its state)
            h("div", { class: "ux-data-panel ux-template-panel" }, [
              h(RunDataTable, {
                dataset: "configTemplates",
                columns: [
                  { key: "name", minWidth: 160 },
                  { key: "status", width: 190 },
                  { key: "runMode", width: 170 },
                  { key: "titles", minWidth: 160 },
                  { key: "sources", minWidth: 180 },
                ],
                statsPreset: runDataStatsPresets.configTemplates,
                context: { rows: templateRows(items) },
                ignoreJumps: true,
                actionsWidth: 220,
                class: "ux-native-data",
              }, {
                "cell-name": ({ row }) => h("strong", row.name),
                "cell-status": ({ row }) =>
                  h(
                    "span",
                    { class: "ux-template-status" },
                    row.status.split("，").map((part) =>
                      E(
                        "ElTag",
                        {
                          size: "small",
                          disableTransitions: true,
                          type: part === "使用中" ? "success" : part === "未使用" ? "info" : "warning",
                        },
                        () => part,
                      ),
                    ),
                  ),
                actions: ({ row }) => {
                  const t = items.find((it) => it.id === row.id);
                  if (!t) return null;
                  return h("span", { class: "ux-task-actions" }, [
                    button("查看", () => (templateView.value = t), {
                      link: true,
                      type: "primary",
                      size: "small",
                    }),
                    button("使用", () => useTemplate(t), {
                      link: true,
                      type: "primary",
                      size: "small",
                      disabled: t.id === activeTemplate.value,
                    }),
                    button(
                      "导出",
                      () => exportTemplatesToFile([t], `牛人快跑配置模板-${t.name}.json`),
                      { link: true, type: "primary", size: "small" },
                    ),
                    button("删除", () => deleteTemplateById(t), {
                      link: true,
                      type: "danger",
                      size: "small",
                    }),
                  ]);
                },
              }),
            ]),
          ],
          { class: "ux-card ux-data-card" },
        ),
        E(
          "ElDialog",
          {
            modelValue: Boolean(view),
            title: view ? "模板：" + view.name : "",
            width: "min(640px, calc(100vw - 48px))",
            appendToBody: true,
            "onUpdate:modelValue": (v) => {
              if (!v) templateView.value = null;
            },
          },
          {
            default: () =>
              view
                ? h(
                    "dl",
                    { class: "ux-template-facts" },
                    templateFacts(view.snapshot).flatMap(([label, value]) => [
                      h("dt", label),
                      h("dd", value),
                    ]),
                  )
                : null,
            footer: () =>
              view
                ? inline([
                    button("导出", () =>
                      exportTemplatesToFile([view], `牛人快跑配置模板-${view.name}.json`),
                    ),
                    button("使用这个模板", () => useTemplate(view), {
                      type: "primary",
                      disabled: view.id === activeTemplate.value,
                    }),
                  ])
                : null,
          },
        ),
      ];
    }
    // ---- release notes of the running version (click the version in the navigation) ----
    const releaseNotes = ref(null);
    function openReleaseNotes() {
      const version = buildInfo.version;
      const entry = releaseNotesByVersion[version];
      releaseNotes.value = {
        version,
        found: Boolean(entry),
        draft: Boolean(entry?.draft),
        publishedAt: entry?.date,
        blocks: parseMarkdown(entry?.notes || ""),
        htmlUrl: entry ? `${RELEASES_URL}/tag/${releaseTag(version)}` : RELEASES_URL,
      };
    }
    const openLink = (href) =>
      window.electron.ipcRenderer.send("open-external-link", href);
    function markdownInline(tokens) {
      return tokens.map((t) =>
        t.type === "strong"
          ? h("strong", t.text)
          : t.type === "code"
            ? h("code", t.text)
            : t.type === "link"
              ? h(
                  "a",
                  {
                    href: t.href,
                    onClick: (e) => {
                      e.preventDefault();
                      openLink(t.href);
                    },
                  },
                  t.text,
                )
              : t.text,
      );
    }
    function markdownBlocks(blocks) {
      return blocks.map((b) =>
        b.type === "h"
          ? h("h" + Math.min(6, b.level + 1), markdownInline(b.inline))
          : b.type === "ul"
            ? h(
                "ul",
                b.items.map((item) => h("li", markdownInline(item))),
              )
            : b.type === "hr"
              ? h("hr")
              : h("p", markdownInline(b.inline)),
      );
    }
    function releaseNotesDialog() {
      const notes = releaseNotes.value;
      return E(
        "ElDialog",
        {
          modelValue: Boolean(notes),
          title: notes ? `版本 ${notes.version} 更新内容` : "",
          width: "min(720px, calc(100vw - 48px))",
          appendToBody: true,
          class: "ux-release-dialog",
          "onUpdate:modelValue": (v) => {
            if (!v) releaseNotes.value = null;
          },
        },
        {
          default: () =>
            !notes
              ? null
              : !notes.found
                ? alert(
                    "这个版本没有内置的更新说明，可能是开发版或尚未发布的版本。",
                    "info",
                  )
                : h("div", { class: "ux-release-notes" }, [
                        notes.draft
                          ? alert("这份更新说明是自动整理的草稿，内容可能不完整。", "warning")
                          : null,
                        notes.publishedAt
                          ? hint(
                              "发布于 " +
                                new Date(notes.publishedAt).toLocaleString("zh-CN"),
                            )
                          : null,
                        ...markdownBlocks(notes.blocks),
                      ]),
          footer: () =>
            notes
              ? inline([
                  button("在 GitHub 查看", () => openLink(notes.htmlUrl), { plain: true }),
                  button("关闭", () => (releaseNotes.value = null), { type: "primary" }),
                ])
              : null,
        },
      );
    }
    async function loadGlobalPace() {
      try {
        const pace = await ipc("run-pace-info");
        globalPace.value = pace;
        // an open settings form keeps its unsaved edits
        if (!paceForm.value || route.value !== "settings" || settingTab.value !== "pace")
          paceForm.value = clone(pace);
      } catch (error) {
        R.message({ type: "error", message: "读取全局运行节奏失败：" + error.message });
      }
    }
    async function saveGlobalPace() {
      const p = paceForm.value;
      if (
        p.pause &&
        (!Number.isInteger(p.actions) || p.actions < 1 || !Number.isFinite(p.minutes) || p.minutes < 0)
      ) {
        R.message({
          type: "error",
          message: "休息前操作次数须为正整数，休息时长不能留空或小于0。",
        });
        return;
      }
      paceSaving.value = true;
      try {
        globalPace.value = await ipc("run-pace-save", clone(p));
        paceForm.value = clone(globalPace.value);
        R.message({ type: "success", message: "全局运行节奏已保存，下次开始任务时生效。" });
      } catch (error) {
        R.message({ type: "error", message: "保存失败：" + error.message });
      } finally {
        paceSaving.value = false;
      }
    }
    async function checkLoginNow() {
      await withDataBusy("login", async () => {
        const result = await refreshLoginStatus();
        R.message({
          type:
            result.status === "valid"
              ? "success"
              : result.status === "unknown"
                ? "warning"
                : "error",
          message:
            result.status === "valid"
              ? "BOSS直聘登录状态正常"
              : result.status === "missing"
                ? "本机没有保存登录凭证"
                : result.status === "invalid"
                  ? "登录凭证已失效：" + result.detail + "，请重新登录"
                  : "暂时无法确认：" + result.detail,
          duration: 5000,
        });
      });
    }
    async function chooseDataTarget() {
      const dir = await ipc("choose-directory", {
        title: "选择新的数据目录",
        defaultPath: dataInfo.value?.current,
      });
      if (dir) dataTarget.value = dir;
    }
    async function applyDataLocation() {
      const target = dataTarget.value;
      if (!target) return;
      const copy = dataMode.value === "copy";
      if (
        !(await confirmBox(
          (copy
            ? `将把当前数据复制到“${target}”，`
            : `将直接使用“${target}”中已有的数据，`) +
            "完成后软件会自动重启。原目录中的文件会保留，确认新目录无误后可自行删除。",
          "更换数据目录",
          "更换并重启",
        ))
      )
        return;
      await withDataBusy("location", async () => {
        await ipc("data-location-change", { targetDir: target, mode: dataMode.value });
        R.message({ type: "success", message: "数据目录已更换，正在重启…" });
        await flushDraft();
        await ipc("app-relaunch");
      });
    }
    async function saveBackupSettings(patch) {
      await withDataBusy("settings", async () => {
        const settings = await ipc("db-backup-save-settings", {
          ...backupInfo.value.settings,
          ...patch,
        });
        backupInfo.value = { ...backupInfo.value, settings };
        backupInfo.value = await ipc("db-backup-info");
      });
    }
    async function saveLogSettings(patch) {
      await withDataBusy("log", async () => {
        const settings = await ipc("log-settings-save", {
          ...logInfo.value.settings,
          ...patch,
        });
        logInfo.value = { ...logInfo.value, settings };
      });
    }
    function logCard() {
      const info = logInfo.value;
      if (!info) return null;
      const st = info.settings;
      return card(
        "运行日志",
        [
          h("div", { class: "ux-inline ux-backup-switch" }, [
            E("ElSwitch", {
              modelValue: st.enabled,
              loading: dataBusy.value === "log",
              "aria-label": "保存运行日志",
              "onUpdate:modelValue": (v) => saveLogSettings({ enabled: Boolean(v) }),
            }),
            h("span", st.enabled ? "正在保存运行日志" : "不保存运行日志"),
          ]),
          field(
            "记录级别",
            E(
              "ElSelect",
              {
                modelValue: st.level,
                disabled: !st.enabled,
                "aria-label": "日志记录级别",
                "onUpdate:modelValue": (v) => saveLogSettings({ level: v }),
              },
              () =>
                info.levels.map((l) => E("ElOption", { value: l.value, label: l.label })),
            ),
            "只保存所选级别及更严重的记录：跟踪 < 调试 < 信息 < 警告 < 错误。排查问题时可临时调到“调试”，日志会明显变多。",
          ),
          field(
            "保存时长",
            h("div", { class: "ux-inline" }, [
              E("ElInputNumber", {
                modelValue: st.retentionDays,
                min: info.retentionRange[0],
                max: info.retentionRange[1],
                step: 1,
                stepStrictly: true,
                disabled: !st.enabled,
                controlsPosition: "right",
                "aria-label": "日志保存天数",
                "onUpdate:modelValue": (v) =>
                  v && v !== st.retentionDays && saveLogSettings({ retentionDays: v }),
              }),
              h("span", { class: "ux-hint" }, "天"),
            ]),
            "超过时长的日志文件会自动删除，默认保存一周。",
          ),
          field(
            "日志目录",
            pathInput(info.dir, {
              ariaLabel: "日志目录",
              buttons: [button("打开", () => ipc("open-folder", info.dir))],
            }),
            "每天一个文件。修改后几秒内对所有正在运行的任务生效。日志可能包含职位、公司和聊天内容，分享前请检查。",
            true,
          ),
        ],
        { class: "ux-card ux-data-card" },
      );
    }
    async function chooseBackupDir() {
      const dir = await ipc("choose-directory", {
        title: "选择备份目录",
        defaultPath: backupInfo.value?.dir,
      });
      if (dir) await saveBackupSettings({ dir });
    }
    async function runBackupNow() {
      await withDataBusy("backup", async () => {
        const result = await ipc("db-backup-run");
        R.message({
          type: result.ok ? "success" : "error",
          message: result.ok
            ? "备份完成：" + result.name
            : "备份失败：" + result.error,
        });
        backupInfo.value = await ipc("db-backup-info");
      });
    }
    async function restoreBackup(item) {
      if (
        !(await confirmBox(
          `将用备份“${item.name}”（${clockTime(item.modifiedAt)}）替换当前数据库，软件会自动重启。` +
            "当前数据库会先另存为 public-before-restore-*.db 放在备份目录中。",
          "从备份恢复",
          "恢复并重启",
        ))
      )
        return;
      await withDataBusy("restore", async () => {
        await flushDraft();
        await ipc("db-backup-restore", { name: item.name });
        R.message({ type: "success", message: "正在重启并恢复备份…" });
      });
    }
    const fileSize = (n) =>
      n >= 1024 * 1024
        ? (n / 1024 / 1024).toFixed(1) + " MB"
        : Math.max(1, Math.round(n / 1024)) + " KB";
    const intervalLabel = (hours) =>
      ({ 24: "每天", 72: "每 3 天", 168: "每周" })[hours] || `每 ${hours} 小时`;
    // a directory as a read-only input group: the path (cut off with … when long, full path on
    // hover), an optional label in front and the buttons that act on it at the end
    const pathInput = (value, { label, placeholder = "尚未选择", buttons = [], ariaLabel } = {}) =>
      E(
        "ElInput",
        {
          modelValue: value || "",
          readonly: true,
          placeholder,
          title: value || "",
          class: "ux-path-input",
          "aria-label": ariaLabel,
        },
        {
          ...(label ? { prepend: () => label } : {}),
          ...(buttons.length ? { append: () => buttons } : {}),
        },
      );
    function dataSettings() {
      const loc = dataInfo.value,
        backup = backupInfo.value;
      if (!loc || !backup) return [card("数据与备份", [hint("正在读取…")])];
      const st = backup.settings;
      const busy = (key) => dataBusy.value === key;
      const last = backup.lastRun;
      return [
        card("数据保存位置", [
          loc.fallbackFrom
            ? alert(
                `设置的数据目录“${loc.fallbackFrom}”当前不可用（可能是移动硬盘未连接），本次临时使用默认目录。连接后重启即可恢复。`,
                "warning",
              )
            : null,
          field(
            "当前数据目录",
            pathInput(loc.current, {
              label: loc.isDefault ? "默认" : "自定义",
              ariaLabel: "当前数据目录",
              buttons: [button("打开", () => ipc("open-folder", loc.current))],
            }),
            "保存数据库（职位、开聊记录、收藏等）、BOSS登录凭证和运行缓存。配置文件不在此目录中。",
            true,
          ),
          field(
            "更换到",
            h("div", { class: "ux-data-target" }, [
              h("div", { class: "ux-path-row" }, [
                pathInput(dataTarget.value, {
                  ariaLabel: "新的数据目录",
                  placeholder: "点右边“选择文件夹”",
                  buttons: [button("选择文件夹…", chooseDataTarget)],
                }),
                !loc.isDefault || loc.fallbackFrom
                  ? button(
                      "使用默认目录",
                      () => (dataTarget.value = loc.defaultPath),
                      { link: true, type: "primary", size: "small" },
                    )
                  : null,
              ]),
              E(
                "ElRadioGroup",
                {
                  modelValue: dataMode.value,
                  "onUpdate:modelValue": (v) => (dataMode.value = v),
                  "aria-label": "更换方式",
                },
                () => [
                  E("ElRadio", { value: "copy" }, () => "复制当前数据到新目录"),
                  E("ElRadio", { value: "use-existing" }, () => "使用新目录中已有的数据"),
                ],
              ),
              inline([
                button("更换并重启", applyDataLocation, {
                  type: "primary",
                  disabled: !dataTarget.value,
                  loading: busy("location"),
                }),
              ]),
            ]),
            "默认目录：" +
              loc.defaultPath +
              "。更换前请先停止正在运行或排队的任务；原目录中的文件会保留。",
            true,
          ),
        ], { class: "ux-card ux-data-card" }),
        card("数据库备份", [
          h("div", { class: "ux-inline ux-backup-switch" }, [
            E("ElSwitch", {
              modelValue: st.enabled,
              loading: busy("settings"),
              "aria-label": "定期备份数据库",
              "onUpdate:modelValue": (v) => saveBackupSettings({ enabled: Boolean(v) }),
            }),
            h("span", st.enabled ? "已开启定期备份" : "未开启定期备份"),
          ]),
          h("div", { class: "ux-form-row" }, [
            field(
              "备份周期",
              E(
                "ElSelect",
                {
                  modelValue: st.intervalHours,
                  disabled: !st.enabled,
                  "aria-label": "备份周期",
                  "onUpdate:modelValue": (v) => saveBackupSettings({ intervalHours: v }),
                },
                () =>
                  backup.intervalOptions.map((hours) =>
                    E("ElOption", { value: hours, label: intervalLabel(hours) }),
                  ),
              ),
              "软件运行期间按周期备份；关闭期间到期的备份会在下次启动约 2 分钟后补做。",
            ),
            field(
              "备份方式",
              h("div", [
                E(
                  "ElRadioGroup",
                  {
                    modelValue: st.mode,
                    "aria-label": "备份方式",
                    "onUpdate:modelValue": (v) => saveBackupSettings({ mode: v }),
                  },
                  () => [
                    E("ElRadio", { value: "rotate" }, () => "保留多份"),
                    E("ElRadio", { value: "overwrite" }, () => "只保留最新一份"),
                  ],
                ),
                st.mode === "rotate"
                  ? h("div", { class: "ux-inline" }, [
                      h("span", { class: "ux-hint" }, "最多保留"),
                      E("ElInputNumber", {
                        modelValue: st.keep,
                        min: backup.keepRange[0],
                        max: backup.keepRange[1],
                        size: "small",
                        controlsPosition: "right",
                        "aria-label": "最多保留份数",
                        "onUpdate:modelValue": (v) =>
                          v && v !== st.keep && saveBackupSettings({ keep: v }),
                      }),
                      h("span", { class: "ux-hint" }, "份，更早的自动删除"),
                    ])
                  : null,
              ]),
              st.mode === "rotate"
                ? "每次备份生成一个带时间的新文件。"
                : "每次备份覆盖上一次的 public-latest.db，占用空间最少。",
            ),
          ]),
          field(
            "备份目录",
            h("div", { class: "ux-path-row" }, [
              pathInput(backup.dir, {
                label: st.dir ? "自定义" : "默认",
                ariaLabel: "备份目录",
                buttons: [
                  button("更改…", chooseBackupDir),
                  button("打开", () => ipc("open-folder", backup.dir)),
                ],
              }),
              st.dir
                ? button("使用默认目录", () => saveBackupSettings({ dir: "" }), {
                    link: true,
                    type: "primary",
                    size: "small",
                  })
                : null,
            ]),
            "默认在数据目录下的 backups 文件夹；建议放到另一块硬盘或同步盘中。",
            true,
          ),
          inline([
            button("立即备份", runBackupNow, {
              type: "primary",
              plain: true,
              loading: busy("backup"),
            }),
            hint(
              last
                ? (last.ok
                    ? `上次备份：${clockTime(last.at)}，${last.name}（${fileSize(last.size)}）`
                    : `上次备份失败（${clockTime(last.at)}）：${last.error}`) +
                    (last.trigger === "schedule" ? "，定期备份" : "")
                : "还没有备份过。",
            ),
          ]),
          backup.backups.length
            ? h(
                "ul",
                { class: "ux-task-list ux-backup-list" },
                backup.backups.slice(0, 10).map((item) =>
                  h("li", { class: "ux-task-row" }, [
                    h("strong", item.name),
                    h(
                      "span",
                      { class: "ux-hint" },
                      clockTime(item.modifiedAt) + "，" + fileSize(item.size),
                    ),
                    h("span", { class: "ux-task-actions" }, [
                      button("恢复", () => restoreBackup(item), {
                        link: true,
                        type: "danger",
                        disabled: Boolean(dataBusy.value),
                      }),
                    ]),
                  ]),
                ),
              )
            : null,
          backup.backups.length > 10
            ? hint(`另有 ${backup.backups.length - 10} 个更早的备份，可在备份目录中查看。`)
            : null,
        ], { class: "ux-card ux-data-card" }),
        logCard(),
      ];
    }
    function dingtalkConfigured() {
      return Boolean(
        native.state().config["dingtalk.json"]?.hasGroupRobotAccessToken,
      );
    }
    async function saveDingtalk(clear) {
      let token = clear ? "" : dingtalkForm.value.token.trim();
      // accept a pasted webhook URL as well as the bare token
      const fromUrl = /access_token=([^&\s]+)/.exec(token);
      if (fromUrl) token = fromUrl[1];
      dingtalkBusy.value = true;
      try {
        await native.saveDingtalk({ token, clear });
        // the token leaves the page once saved
        dingtalkForm.value.token = "";
        R.message({
          type: "success",
          message: clear ? "钉钉通知已关闭" : "钉钉通知已保存",
        });
      } catch (error) {
        R.message({ type: "error", message: "保存失败：" + error.message });
      } finally {
        dingtalkBusy.value = false;
      }
    }
    async function validateBrowserPath() {
      const path = browserForm.value.path.trim();
      browserError.value = !path
        ? "请选择或填写浏览器路径。"
        : (
            await window.electron.ipcRenderer.invoke(
              "check-executable-file",
              path,
            )
          )?.message || "";
      return !browserError.value;
    }
    async function saveBrowser() {
      if (!(await validateBrowserPath())) return;
      await window.electron.ipcRenderer.invoke("ux-save-browser", {
        executablePath: browserForm.value.path.trim(),
        browser: "chrome",
      });
      browser.value = true;
      R.message({ type: "success", message: "浏览器配置已保存" });
    }
    // request settings are edited once (on the primary) and apply to both models
    function syncRequestSettings() {
      const [primary, backup] = modelForm.value;
      for (const key of Object.keys(AI_REQUEST_DEFAULTS)) backup[key] = primary[key];
    }
    async function saveModels() {
      syncRequestSettings();
      const err = validModelList(modelForm.value);
      if (err) {
        R.message({ type: "error", message: err });
        return false;
      }
      if (modelBusy.value) return false;
      modelBusy.value = true;
      try {
        const result = await native.saveModels(modelForm.value);
        // typed keys leave the page once saved; only "has a key" comes back
        modelForm.value = formModels(result.models);
        modelDirty.value = false;
        R.message({
          type: "success",
          message: result?.legacyBackedUp
            ? "已保存，旧配置已安全备份"
            : "模型配置已保存",
        });
        return true;
      } catch (error) {
        R.message({ type: "error", message: "AI配置未保存：" + error.message });
        return false;
      } finally {
        modelBusy.value = false;
      }
    }

    let aiFooterObserver;
    function attachAiFooter(el) {
      aiFooterObserver?.disconnect();
      if (!el) return;
      const resize = () =>
        el
          .closest(".ux-shell")
          ?.style.setProperty(
            "--ux-ai-footer-height",
            Math.ceil(el.getBoundingClientRect().height) + "px",
          );
      aiFooterObserver = new ResizeObserver(resize);
      aiFooterObserver.observe(el);
      resize();
    }
    async function loadModelList(m, role, force = false) {
      const url = String(m.providerCompleteApiUrl || "").trim();
      // a typed key and the saved key may list different models
      const source = url + "|" + (m.providerApiSecret ? "typed" : "saved");
      if (!url || modelListLoading.value[role]) return;
      if (!force && modelLists.value[role]?.source === source) return;
      modelListLoading.value = { ...modelListLoading.value, [role]: true };
      modelListError.value = { ...modelListError.value, [role]: "" };
      try {
        const ids = await native.listModels(clone(m));
        modelLists.value = { ...modelLists.value, [role]: { source, ids } };
      } catch (error) {
        modelListError.value = {
          ...modelListError.value,
          [role]: String(error.message || error).replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            "",
          ),
        };
      } finally {
        modelListLoading.value = { ...modelListLoading.value, [role]: false };
      }
    }
    async function testModels() {
      syncRequestSettings();
      const error = validModelList(modelForm.value);
      if (error) {
        R.message({ type: "error", message: error });
        return;
      }
      if (modelTesting.value || modelBusy.value) return;
      modelTesting.value = true;
      modelResults.value = [];
      try {
        modelResults.value = await native.testModels(clone(modelForm.value));
      } catch (error) {
        R.message({ type: "error", message: "测试未完成：" + error.message });
      } finally {
        modelTesting.value = false;
      }
    }
    function aiFooter() {
      return h(
        "footer",
        { class: "ux-footer ux-footer--ai", ref: attachAiFooter },
        [
          h("div", { class: "ux-footer-actions" }, [
            h(
              "span",
              { class: "ux-hint", role: "status" },
              modelTesting.value
                ? "测试中…"
                : modelDirty.value
                  ? "未保存"
                  : "已保存",
            ),
            button(
              "清空配置",
              () => {
                modelForm.value = formModels([]);
                modelDirty.value = true;
                modelResults.value = [];
              },
              { plain: true, disabled: modelBusy.value || modelTesting.value },
            ),
            button("测试连接", testModels, {
              plain: true,
              loading: modelTesting.value,
              disabled: modelBusy.value,
            }),
            button("保存配置", saveModels, {
              type: "primary",
              loading: modelBusy.value,
              disabled: modelTesting.value,
            }),
          ]),
        ],
      );
    }
    function aiSettings() {
      const locked = modelBusy.value || modelTesting.value;
      const modelEditor = (m, index) => {
        const role = index === 0 ? "primary" : "backup";
        const id = (key) => "ai-" + role + "-" + key;
        return h(
          "section",
          { class: "ux-ai-model", key: role, "data-model-role": role },
          [
            h("h3", index === 0 ? "首选模型" : "备用模型"),
            field(
              "服务商预设",
              E(
                "ElSelect",
                {
                  id: id("preset"),
                  modelValue: m.preset || "custom",
                  disabled: locked,
                  "aria-label": "厂商配置模板 " + index,
                  "onUpdate:modelValue": (value) => {
                    m.preset = value;
                    const samples = {
                      deepseek: [
                        "deepseek-v4-pro",
                        "https://api.deepseek.com/v1",
                      ],
                      volcano: [
                        "deepseek-v3-250324",
                        "https://ark.cn-beijing.volces.com/api/v3",
                      ],
                      aliyun: [
                        "deepseek-v3",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1",
                      ],
                      local: ["qwen2.5:7b", "http://127.0.0.1:11434/v1"],
                    };
                    if (samples[value])
                      [m.model, m.providerCompleteApiUrl] = samples[value];
                    changed();
                  },
                },
                [
                  ["custom", "自定义"],
                  ["deepseek", "DeepSeek"],
                  ["volcano", "火山引擎"],
                  ["aliyun", "阿里云百炼"],
                  ["local", "本地 Ollama"],
                ].map(([value, label]) => E("ElOption", { value, label })),
              ),
              "",
              false,
              id("preset"),
            ),
            field(
              "模型名称",
              inline([
                E(
                  "ElSelect",
                  {
                    id: id("model"),
                    modelValue: m.model,
                    filterable: true,
                    allowCreate: true,
                    defaultFirstOption: true,
                    placeholder: "选择或输入模型名称",
                    loading: Boolean(modelListLoading.value[role]),
                    disabled: locked,
                    "aria-label": "模型名称 " + index,
                    "onUpdate:modelValue": (value) => update(m, "model", value),
                    onVisibleChange: (open) => open && loadModelList(m, role),
                  },
                  [
                    ...new Set([
                      ...(m.model ? [m.model] : []),
                      ...(modelLists.value[role]?.ids || []),
                    ]),
                  ].map((value) => E("ElOption", { value, label: value })),
                ),
                button("获取列表", () => loadModelList(m, role, true), {
                  plain: true,
                  size: "small",
                  loading: Boolean(modelListLoading.value[role]),
                  disabled: locked,
                  "aria-label": "获取模型列表 " + index,
                }),
              ]),
              modelListError.value[role]
                ? "获取模型列表失败：" +
                    modelListError.value[role] +
                    "。可以直接输入模型名称。"
                : "展开时自动从接口获取可用模型，也可以直接输入。",
              false,
              id("model"),
            ),
            field(
              "接口地址",
              input(m, "providerCompleteApiUrl", {
                id: id("url"),
                "aria-label": "接口地址 " + index,
                placeholder: "https://…/v1",
                disabled: locked,
              }),
              "兼容 OpenAI 接口。",
              false,
              id("url"),
            ),
            field(
              "API密钥",
              input(m, "providerApiSecret", {
                id: id("key"),
                type: "password",
                showPassword: true,
                autocomplete: "off",
                "aria-label": "API密钥 " + index,
                placeholder: m.hasProviderApiSecret
                  ? "已保存（不显示），留空则保持不变"
                  : "",
                disabled: locked,
              }),
              m.hasProviderApiSecret
                ? "密钥只保存在本机，界面不会读取；更换接口地址后需重新填写。"
                : "密钥保存在本机。",
              false,
              id("key"),
            ),
          ],
        );
      };
      return card(
        [
          "AI模型配置",
          tip("只有选了AI生成消息才会用到。测试时只发一条简单请求，不带简历。", "AI模型配置"),
        ],
        [
          initial.config["llm.json"].length > 2 && modelDirty.value
            ? hint("旧配置超过2个，保存时将安全备份。")
            : null,
          initial.draftSecretOmitted
            ? hint("上次未保存的密钥需重新填写。")
            : null,
          modelEditor(modelForm.value[0], 0),
          h("div", { class: "ux-ai-backup" }, [
            withTip(
              check(modelForm.value[1], "enabled", "启用备用模型", {
                disabled: locked,
              }),
              "首选模型出错时，改用备用模型。",
            ),
            modelForm.value[1].enabled
              ? modelEditor(modelForm.value[1], 1)
              : null,
          ]),
          h("section", { class: "ux-ai-model", "data-model-role": "request" }, [
            h("h3", ["请求设置", tip("对首选和备用模型都生效。", "请求设置")]),
            h("div", { class: "ux-rhythm-line" }, [
              h("span", "请求超时"),
              number(modelForm.value[0], "requestTimeoutSeconds", {
                min: AI_TIMEOUT_SECONDS_RANGE[0],
                max: AI_TIMEOUT_SECONDS_RANGE[1],
                step: 10,
                disabled: locked,
                "aria-label": "AI请求超时秒数",
              }),
              h("span", "秒"),
            ]),
            h("div", { class: "ux-rhythm-line" }, [
              h("span", "失败后重试"),
              number(modelForm.value[0], "maxRetries", {
                min: AI_MAX_RETRIES_RANGE[0],
                max: AI_MAX_RETRIES_RANGE[1],
                disabled: locked,
                "aria-label": "AI请求失败重试次数",
              }),
              h("span", "次"),
              tip(
                `默认超时 ${AI_REQUEST_DEFAULTS.requestTimeoutSeconds} 秒、重试 ${AI_REQUEST_DEFAULTS.maxRetries} 次；超时、限流和服务端错误会自动重试，“测试连接”不重试。`,
              ),
            ]),
            withTip(
              check(modelForm.value[0], "thinkingEnabled", "开启思考模式", {
                disabled: locked,
              }),
              "DeepSeek、火山引擎按此开关切换；阿里云百炼的接口只支持关闭；其他服务商使用模型自身的默认设置。开启后回复更慢，建议超时不低于 60 秒。",
            ),
          ]),
          modelResults.value.length
            ? h(
                "div",
                { class: "ux-ai-results", role: "status" },
                modelResults.value.map((result) =>
                  h(
                    "p",
                    { class: result.ok ? "ux-ai-ok" : "ux-error" },
                    (result.role === "primary" ? "首选" : "备用") +
                      "：" +
                      (result.ok ? "连接成功" : result.error),
                  ),
                ),
              )
            : null,
        ],
        { id: "ai-model-settings" },
      );
    }

    async function navigate(next) {
      if (next === route.value) return;
      // Preserve unsaved in-memory changes; navigation does not discard drafts.
      route.value = next;
      errors.value = [];
      validationAttempted.value = false;
      location.hash = "/ux/" + next;
      R.nextTick(() => document.querySelector(".ux-main")?.scrollTo(0, 0));
    }
    function closeModal(done) {
      modal.value = "";
      if (done) done();
    }
    function dialogs() {
      const kind = modal.value;
      let title = "",
        content = [],
        footerNodes = [];
      if (kind === "template") {
        title = "新建模板";
        content = [
          field(
            "模板名称",
            E("ElInput", {
              modelValue: templateName.value,
              "onUpdate:modelValue": (v) => {
                templateName.value = v;
                templateError.value = "";
              },
              "aria-label": "模板名称",
              maxlength: 40,
              placeholder: "例如：上海产品岗位",
              onKeyup: (e) => {
                if (e.key === "Enter") commitTemplate();
              },
            }),
            "",
            false,
            "template-name",
            "创建时就保存当前条件。后续修改后，再点击“保存模板”。",
          ),
        ];
        if (templateError.value)
          content.push(
            h("p", { class: "ux-error", role: "alert" }, templateError.value),
          );
        footerNodes = [
          button("取消", () => (modal.value = "")),
          button("创建模板", () => commitTemplate(), { type: "primary" }),
        ];
      }
      if (!kind) return null;
      if (kind === "companies") {
        const obj = companyEditor.value,
          key = companyKey.value,
          label = key === "companies" ? "只看这些公司" : "不看这些公司";
        title = "设置公司偏好";
        content = [
          tabBar(
            key,
            [
              ["companies", "只看这些公司"],
              ["excluded", "不看这些公司"],
            ],
            (next) => (companyKey.value = next),
          ),
          field(
            h("span", { class: "ux-filter-heading" }, [
              h("span", label),
              fieldLocation(key, label),
            ]),
            tags(obj, key, ["腾讯", "字节跳动", "阿里巴巴", "美团", "网易"], {
              "aria-label": label,
              placeholder: "输入公司关键词，按回车添加",
              disabled: companyBusy.value,
            }),
          ),
          inline([
            explain([
              "当前名单：",
              metric(obj[key].length),
              " 个关键词",
              tip(
                (key === "companies"
                  ? "公司名里包含任一关键词就算；名单为空就是不限公司。"
                  : "公司名里包含任一关键词就排除；“不看”比“只看”优先。") +
                  "应用后，找岗位和消息跟进都会用这份名单。",
                "名单规则",
              ),
            ]),
            button("清空当前名单", () => clearCompanyList(obj, key), {
              size: "small",
              plain: true,
              disabled:
                companyBusy.value ||
                !(
                  obj[key]?.length ||
                  obj.legacyPatterns?.[key] ||
                  obj.legacyNeedsReview?.includes(key)
                ),
              "aria-label": "清空当前公司名单",
            }),
          ]),
          obj.legacyNeedsReview?.includes(key)
            ? h("div", { class: "ux-migration-note" }, [
                h(
                  "p",
                  "旧规则不能直接转换为关键词。可以保留原规则，或填写关键词替换。",
                ),
                button(
                  "保留原有规则",
                  () => {
                    obj.legacyPatterns ??= {};
                    obj.legacyPatterns.excluded =
                      obj.legacyRulesBackup.regexExclude;
                    obj.legacyNeedsReview = obj.legacyNeedsReview.filter(
                      (item) => item !== key,
                    );
                  },
                  { link: true, type: "primary" },
                ),
                button(
                  "取消此项限制",
                  () => {
                    obj.legacyNeedsReview = obj.legacyNeedsReview.filter(
                      (item) => item !== key,
                    );
                    update(obj, key, []);
                  },
                  { link: true, type: "primary" },
                ),
              ])
            : obj.legacyPatterns?.[key]
              ? hint("保留原有规则；添加关键词或清空名单将替换此项。")
              : null,
          h("div", { class: "ux-company-examples" }, [
            h("h3", [
              "示例公司组",
              tip("点一下就加到当前名单里，不会覆盖已有的。示例只是参考，按需要删改。", "示例公司组"),
            ]),
            inline(
              companyExamples.map((sample) =>
                button(
                  sample.label,
                  () => addExampleWords(obj, key, sample.keywords),
                  {
                    size: "small",
                    plain: true,
                    disabled: companyBusy.value,
                    "aria-label": "添加公司示例组：" + sample.label,
                  },
                ),
              ),
            ),
          ]),
          companyError.value
            ? h("p", { class: "ux-error", role: "alert" }, companyError.value)
            : null,
        ];
        footerNodes = [
          button("取消", () => (modal.value = ""), {
            disabled: companyBusy.value,
          }),
          button("应用名单", applyCompanies, {
            type: "primary",
            loading: companyBusy.value,
          }),
        ];
      }
      if (kind === "preferences") {
        title = "就地编辑共用求职偏好";
        content = [
          alert("保存后会更新所有沿用的字段；本次覆盖保持不变。"),
          ...prefs(shared.value, true),
        ];
        footerNodes = [
          button("保留草稿并返回", () => (modal.value = "")),
          button(
            "保存并返回",
            async () => {
              await save();
              modal.value = "";
            },
            { type: "primary" },
          ),
        ];
      }
      if (kind === "leave") {
        title = "偏好还未保存";
        content = [
          hint(
            "可以保留当前草稿返回，或保存偏好后返回。不会清空你的本次目标。",
          ),
        ];
        footerNodes = [
          button("继续编辑", () => (modal.value = "preferences")),
          button("保留草稿返回", () => (modal.value = "")),
          button(
            "保存并返回",
            async () => {
              await save();
              modal.value = "";
            },
            { type: "primary" },
          ),
        ];
      }
      if (kind === "prompt") {
        title =
          promptKind.value === "open"
            ? "首次补充消息提示词"
            : "后续跟进消息提示词";
        content = [
          hint(
            promptKind.value === "rechat"
              ? "用于后续跟进消息；保留简历占位符，不包含敏感信息。"
              : "用于首次补充消息；默认提示词无需简历占位符。",
          ),
          E("ElInput", {
            modelValue: promptText.value,
            "onUpdate:modelValue": (v) => (promptText.value = v),
            type: "textarea",
            rows: 12,
            "aria-label": "提示词内容",
          }),
        ];
        footerNodes = [
          button(
            "恢复并保存默认模板",
            async () => {
              await window.electron.ipcRenderer.invoke(
                "overwrite-auto-remind-prompt-with-default",
                { type: promptKind.value },
              );
              promptText.value = await native.readPrompt(promptKind.value);
              R.message({ type: "success", message: "已恢复默认模板并保存" });
            },
            { plain: true },
          ),
          button("取消", () => (modal.value = "")),
          button("保存提示词", savePrompt, { type: "primary" }),
        ];
      }
      if (kind === "help") {
        title = "使用说明";
        content = [
          h("ol", { class: "ux-summary" }, [
            h("li", "按需填写目标岗位、城市与薪资；不填的条件即不限。"),
            h("li", "预览已采集职位，检查具体匹配原因。"),
            h("li", "检查账号和浏览器，再确认开始；运行中可以停止。"),
          ]),
          alert(
            "自动打招呼不等于自动投递简历，需遵守平台规则；休息不保证避免限制。",
          ),
        ];
        footerNodes = [
          button("知道了", () => (modal.value = ""), { type: "primary" }),
        ];
      }
      if (kind === "check") {
        title = "开始前确认";
        const failed = runtimeSteps.value.filter((s) => !s.ok);
        content = [
          alert(...checkLead()),
          preparing.value
            ? hint("正在检查…")
            : failed.length
              ? h("div", { class: "ux-check-failed" }, [
                  ...failed.map((s) =>
                    h("div", { class: "ux-check" }, [
                      h("span", s.label),
                      button(s.fix, s.onFix, { type: "primary", plain: true, size: "small" }),
                    ]),
                  ),
                ])
              : h(
                  "p",
                  { class: "ux-check-passed" },
                  runtimeSteps.value.map((s) => h("span", "✓ " + s.label)),
                ),
          shortResume.value
            ? alert(
                "简历内容不足800字，AI生成质量可能较差。可返回补充，或确认继续。",
                "warning",
              )
            : null,
          checkFacts(),
        ];
        footerNodes = [
          button("返回修改", () => (modal.value = "")),
          button("确认开始", confirmRun, {
            type: "primary",
            loading: starting.value,
            disabled: preparing.value || runtimeSteps.value.some((s) => !s.ok),
          }),
        ];
      }
      return E(
        "ElDialog",
        {
          modelValue: true,
          title,
          width:
            kind === "template"
              ? "min(480px, calc(100vw - 48px))"
              : "min(720px, calc(100vw - 48px))",
          class: "ux-dialog",
          closeOnClickModal: false,
          destroyOnClose: true,
          beforeClose: closeModal,
          "onUpdate:modelValue": (v) => {
            if (!v) modal.value = "";
          },
        },
        { default: () => content, footer: () => inline(footerNodes) },
      );
    }
    // macOS liquid-glass nav (see glass.js): a wallpaper behind the panel is blurred, refracted at
    // the rim and colour-mixed by an SVG backdrop filter; the pointer adds a moving reflection and a
    // slight parallax on the wallpaper so the material reacts as things move behind it
    const vibrant = !!window.api?.nativeGlass;
    const GLASS_INSET = 8;
    let glassNav, glassObserver, glassFrame, glassSize = "";
    function attachGlass(el) {
      if (!vibrant || el === glassNav) return;
      glassObserver?.disconnect();
      cancelAnimationFrame(glassFrame);
      glassNav = el;
      glassSize = "";
      if (!el) return;
      glassObserver = new ResizeObserver(() => {
        cancelAnimationFrame(glassFrame);
        glassFrame = requestAnimationFrame(updateGlassFilter);
      });
      glassObserver.observe(el);
      updateGlassFilter();
    }
    function updateGlassFilter() {
      const el = glassNav;
      if (!el) return;
      const w = Math.round(el.clientWidth - GLASS_INSET * 2),
        h = Math.round(el.clientHeight - GLASS_INSET * 2);
      if (w <= 0 || h <= 0 || w + "x" + h === glassSize) return;
      glassSize = w + "x" + h;
      const map = refractionMap(w, h, { radius: 22, bezel: 18, maxShift: 14 });
      el.querySelector("#ux-glass-filter")?.setAttribute("width", w);
      el.querySelector("#ux-glass-filter")?.setAttribute("height", h);
      const image = el.querySelector("#ux-glass-filter feImage");
      image?.setAttribute("width", w);
      image?.setAttribute("height", h);
      image?.setAttribute("href", map.url);
      el.querySelector("#ux-glass-filter feDisplacementMap")?.setAttribute("scale", map.scale);
    }
    function moveGlassHighlight(e) {
      const el = e.currentTarget,
        r = el.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      el.style.setProperty("--glass-x", x + "px");
      el.style.setProperty("--glass-y", y + "px");
      el.style.setProperty("--glass-dx", (x / r.width - 0.5) * 2);
      el.style.setProperty("--glass-dy", (y / r.height - 0.5) * 2);
      el.style.setProperty("--glass-glow", "1");
    }
    function hideGlassHighlight(e) {
      const el = e.currentTarget;
      el.style.setProperty("--glass-glow", "0");
      el.style.setProperty("--glass-dx", "0");
      el.style.setProperty("--glass-dy", "0");
    }
    function glassLayers() {
      if (!vibrant) return [];
      return [
        h("div", { class: "ux-glass-backdrop", "aria-hidden": "true" }, [
          h("div", { class: "ux-glass-wallpaper" }),
        ]),
        h("svg", { class: "ux-glass-defs", "aria-hidden": "true", focusable: "false" }, [
          h(
            "filter",
            {
              id: "ux-glass-filter",
              x: 0,
              y: 0,
              filterUnits: "userSpaceOnUse",
              primitiveUnits: "userSpaceOnUse",
              "color-interpolation-filters": "sRGB",
            },
            [
              // 1 frost the backdrop
              h("feGaussianBlur", {
                in: "SourceGraphic",
                stdDeviation: 6,
                edgeMode: "duplicate",
                result: "blur",
              }),
              // 2 refract it through the rounded bezel
              h("feImage", { x: 0, y: 0, preserveAspectRatio: "none", result: "map" }),
              h("feDisplacementMap", {
                in: "blur",
                in2: "map",
                xChannelSelector: "R",
                yChannelSelector: "G",
                result: "refracted",
              }),
              // 3 colour mixing: glass concentrates and slightly lifts what it transmits
              h("feColorMatrix", { in: "refracted", type: "saturate", values: 1.8, result: "mixed" }),
              h("feComponentTransfer", { in: "mixed" }, [
                h("feFuncR", { type: "linear", slope: 1.02, intercept: 0.05 }),
                h("feFuncG", { type: "linear", slope: 1.02, intercept: 0.05 }),
                h("feFuncB", { type: "linear", slope: 1.02, intercept: 0.05 }),
              ]),
            ],
          ),
        ]),
      ];
    }
    const Root = {
      render() {
        // running, queued and paused tasks: everything in 当前任务
        const taskCount =
          taskStore.runningTasks.filter((t) => t.workerId in queuedTaskLabels)
            .length +
          taskStore.taskQueue.length +
          (pausedAutoRun() ? 1 : 0);
        return h(
          "div",
          {
            class: [
              "ux-shell",
              navCollapsed.value ? "is-nav-collapsed" : "",
              vibrant ? "is-vibrant" : "",
            ],
          },
          [
          h(
            "aside",
            {
              class: "aside-nav ux-nav",
              "data-v-cccda18a": "",
              ref: attachGlass,
              onPointermove: moveGlassHighlight,
              onPointerleave: hideGlassHighlight,
            },
            [
            ...glassLayers(),
            h("div", { class: "ux-nav-head" }, [
              h("div", { class: "ux-nav-brand" }, [
                h("p", { class: "ux-brand" }, "牛人快跑"),
                hint("GeekGeekRun"),
              ]),
              h(
                "button",
                {
                  type: "button",
                  class: "ux-nav-toggle",
                  "aria-label": navCollapsed.value ? "展开导航栏" : "收起导航栏",
                  "aria-expanded": String(!navCollapsed.value),
                  title: navCollapsed.value ? "展开导航栏" : "收起导航栏",
                  onClick: toggleNav,
                },
                [
                  E("ElIcon", { size: 18 }, () =>
                    h(navCollapsed.value ? Expand : Fold),
                  ),
                ],
              ),
            ]),
            h(
              "nav",
              { class: "ux-nav-groups", "aria-label": "主导航" },
              navGroups.map(([title, items]) =>
                h(
                  "div",
                  {
                    class: "group-item",
                    "data-v-e836690d": "",
                    role: "group",
                    "aria-label": title,
                  },
                  [
                    h(
                      "div",
                      { class: "group-title", "data-v-e836690d": "" },
                      title,
                    ),
                    h(
                      "div",
                      { class: "link-list", "data-v-e836690d": "" },
                      items.map((key) =>
                        key === "browse" ? browseLink() : navLink(key, taskCount),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            h("div", { class: "ux-nav-bottom" }, [
              updateStore.availableNewRelease
                ? button(
                    "发现新版本",
                    () =>
                      window.electron.ipcRenderer.send(
                        "open-external-link",
                        updateStore.availableNewRelease.releasePageUrl,
                      ),
                    { link: true, type: "primary" },
                  )
                : null,
              button("版本：" + buildInfo.version, openReleaseNotes, {
                link: true,
                class: "ux-version-link",
                title: "查看这个版本的更新内容",
              }),
              h("div", { class: "ux-project-links" }, [
                button(
                  "项目首页",
                  () =>
                    window.electron.ipcRenderer.send(
                      "open-external-link",
                      REPOSITORY_URL,
                    ),
                  { link: true, type: "primary" },
                ),
                button(
                  "反馈问题",
                  () =>
                    window.electron.ipcRenderer.send(
                      "send-feed-back-to-github-issue",
                    ),
                  { link: true, type: "primary" },
                ),
              ]),
            ]),
          ]),
          h(
            "main",
            {
              class: "ux-main",
              id: "main-content",
              onScroll: updateAutoSection,
            },
            [
              h(
                "div",
                {
                  class: [
                    "ux-inner",
                    route.value === "settings" && settingTab.value === "ai"
                      ? "ux-inner--ai"
                      : "",
                    ["auto", "follow"].includes(route.value) ||
                    (route.value === "settings" && settingTab.value === "ai")
                      ? "ux-inner--config"
                      : "",
                    route.value === "auto" && !railCollapsed.value
                      ? "ux-inner--with-rail"
                      : "",
                    route.value === "auto" && railCollapsed.value
                      ? "ux-inner--rail-collapsed"
                      : "",
                    ["library", "records", "tasks"].includes(route.value)
                      ? "ux-inner--data"
                      : "",
                  ],
                },
                [
                  ...(route.value === "auto"
                    ? autoPage()
                    : route.value === "follow"
                      ? followPage()
                      : route.value === "records"
                        ? dataPage(false)
                        : route.value === "library"
                          ? dataPage(true)
                          : route.value === "tasks"
                            ? tasksPage()
                            : settingsPage()),
                ],
              ),
            ],
          ),
          dialogs(),
          taskDrawer(),
          releaseNotesDialog(),
          imagePreview.value
            ? h(ElImageViewer, {
                urlList: [imagePreview.value.src],
                initialIndex: 0,
                infinite: false,
                teleported: true,
                zIndex: 4000,
                hideOnClickModal: false,
                "aria-label": imagePreview.value.title,
                onClose: closeImagePreview,
              })
            : null,
          route.value === "auto" ? railToggle() : null,
          ],
        );
      },
    };
    function fromHash() {
      const key = location.hash.split("/ux/")[1];
      if (nav.some((n) => n[0] === key)) {
        route.value = key;
        document.title =
          nav.find((n) => n[0] === key)[1] + " - GeekGeekRun 牛人快跑";
      }
    }
    const pointerHandler = (e) => {
      if (
        templatePickerOpen.value &&
        !e.target.closest?.(".ux-template-picker, .ux-template-trigger")
      ) {
        templatePickerOpen.value = false;
        clearTemplateActions();
      }
    };
    const keyHandler = (e) => {
      if (e.key === "Escape" && templatePickerOpen.value) {
        e.preventDefault();
        templatePickerOpen.value = false;
        clearTemplateActions();
        R.nextTick(() =>
          document.querySelector(".ux-template-select")?.focus(),
        );
      }
    };
    function flushDraft() {
      clearTimeout(draftSaveTimer);
      if (dirty.value) return persist();
      return Promise.resolve(true);
    }
    const unloadHandler = (e) => {
      if (!e.isTrusted) return;
      clearTimeout(draftSaveTimer);
      try {
        const result = window.electron.ipcRenderer.sendSync(
          "ux-store-close-draft",
          clone({
            state:
              dirty.value || templateSaving
                ? {
                    draft: draft.value,
                    shared: shared.value,
                    follow: follow.value,
                    savedAt: savedAt.value,
                    templates: templates.value,
                    activeTemplate: activeTemplate.value,
                    templateBaseline: templateBaseline.value,
                    templateDrafts: templateDrafts.value,
                  }
                : null,
            models: modelDirty.value ? modelForm.value : null,
            autoDirty,
            followDirty,
          }),
        );
        if (!result?.ok)
          console.warn("退出草稿未保存：", result?.error || "未知错误");
      } catch (error) {
        console.warn("退出草稿未保存：", error.message);
      }
    };
    fromHash();
    // the rail shows whether the saved login still works
    refreshLoginStatus();
    loadGlobalPace();
    ipc("db-backup-info")
      .then((info) => showRestoreNotice(info.restoreResult))
      .catch(() => void 0);
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("pointerdown", pointerHandler);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("beforeunload", unloadHandler);
    window.addEventListener("blur", flushDraft);
    const unwatch = R.watch(
      () => [taskStore.runningTasks, taskStore.taskQueue],
      ([tasks, queue]) => {
        // the daemon keeps each task's last progress: the dashboard works for a run started
        // before this window opened
        for (const t of tasks) {
          const stored = t.runtimeStorage?.taskProgress;
          if (stored?.progress)
            mergeLive(
              t.workerId,
              stored.runRecordId,
              stored.progress,
              t.runtimeStorage?.stepStatusMapByStepId,
            );
        }
        for (const [task, id] of Object.entries(workerIds)) {
          const worker = tasks.find((t) => t.workerId === id);
          const waiting = queue.find((t) => t.workerId === id);
          running.value[task] = Boolean(worker);
          queued.value[task] = Boolean(waiting) && !worker;
          if (waiting && !worker) {
            const yielded = waiting.reason === "yielded";
            taskProgress.value[task] = {
              viewed: 0,
              sent: 0,
              skipped: 0,
              ...taskProgress.value[task],
              startedAt:
                taskProgress.value[task]?.startedAt || waiting.queuedAt || Date.now(),
              state: yielded ? "yielded" : "queued",
              detail: queueDetail(waiting.position, yielded),
            };
            continue;
          }
          if (worker?.runtimeStorage?.taskProgress)
            taskProgress.value[task] = {
              ...worker.runtimeStorage.taskProgress.progress,
              runRecordId: worker.runtimeStorage.taskProgress.runRecordId,
            };
          if (worker?.runtimeStorage?.stepStatusMapByStepId)
            runIds.value[task] =
              Object.values(worker.runtimeStorage.stepStatusMapByStepId)[0]
                ?.runRecordId || runIds.value[task];
        }
      },
      { immediate: true, deep: true },
    );
    const unlistenProgress = window.electron.ipcRenderer.on(
      "worker-to-gui-message",
      (_, message) => {
        if (message.data?.type !== "task-progress") return;
        mergeLive(message.workerId, message.data.runRecordId, message.data.progress);
        const task = Object.keys(workerIds).find(
          (k) => workerIds[k] === message.workerId,
        );
        if (!task) return;
        if (
          runIds.value[task] &&
          Number(runIds.value[task]) !== Number(message.data.runRecordId)
        )
          return;
        taskProgress.value[task] = {
          ...message.data.progress,
          runRecordId: message.data.runRecordId,
        };
      },
    );
    const unlisten = window.electron.ipcRenderer.on(
      "worker-exited",
      (_, message) => {
        const task = Object.keys(workerIds).find(
          (k) => workerIds[k] === message.workerId,
        );
        if (!task) return;
        running.value[task] = Boolean(message.restarting);
        if (taskProgress.value[task]) {
          taskProgress.value[task].state = message.restarting
            ? "retrying"
            : [88, 89, 91].includes(message.code)
              ? "blocked"
              : requestedStop[task] || message.code === 0
                ? "stopped"
                : "error";
          taskProgress.value[task].stoppedAt = Date.now();
          taskProgress.value[task].detail = message.restarting
            ? "重新检查后开始，不保证原位置续跑"
            : requestedStop[task] || message.code === 0
              ? "任务已停止，实际累计统计保留"
              : [88, 89, 91].includes(message.code)
                ? taskProgress.value[task].detail
                : "请修复问题后重新开始；不会从原位置续跑";
        }
        const labels = exitCodeLabels;
        const name = task === "follow" ? "消息跟进" : "找岗位";
        // a stop the user asked for was already confirmed by stop()
        if (message.restarting)
          R.message({
            type: "warning",
            title: name + "遇到异常",
            message: "正在自动重新开始，不保证从原位置续跑。",
          });
        else if (message.code === 0) {
          if (!requestedStop[task])
            R.message({ type: "success", title: name + "已结束", message: "任务已正常结束。" });
        } else
          R.message({
            type: [88, 89, 91].includes(message.code) ? "warning" : "error",
            title:
              task === "auto"
                ? name + "已暂停"
                : name + ([88, 89, 91].includes(message.code) ? "已停止" : "异常结束"),
            message:
              (labels[message.code] || "退出码 " + message.code) +
              (task === "auto"
                ? "。处理后可在任务列表中恢复。"
                : "。请修复后重新开始。"),
            action:
              task === "auto"
                ? { label: "查看任务", onClick: () => openTaskDetail(workerIds.auto) }
                : undefined,
          });
      },
    );
    R.onUnmounted(() => {
      aiFooterObserver?.disconnect();
      glassObserver?.disconnect();
      cancelAnimationFrame(glassFrame);
      clearTimeout(draftSaveTimer);
      clearInterval(progressTimer);
      clearSpotlight();
      unlistenProgress();
      unwatch();
      unlisten();
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("pointerdown", pointerHandler);
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("beforeunload", unloadHandler);
      window.removeEventListener("blur", flushDraft);
    });
    return () => Root.render();
  },
});
