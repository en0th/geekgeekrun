/* Task-oriented UI migrated from the accepted prototype. All execution uses native IPC. */
import * as Vue from "vue";
import {
  modelPair,
  AI_REQUEST_DEFAULTS,
  AI_TIMEOUT_SECONDS_RANGE,
  AI_MAX_RETRIES_RANGE,
} from "../../../../common/model-config.mjs";
import { followIssues } from "../../../../common/ux-validation.mjs";
import { ElMessage, ElImageViewer } from "element-plus";
import JobLibrary from "../MainLayout/JobLibrary.vue";
import BossLibrary from "../MainLayout/BossLibrary.vue";
import CompanyLibrary from "../MainLayout/CompanyLibrary.vue";
import StartChatRecord from "../MainLayout/StartChatRecord.vue";
import MarkAsNotSuitRecord from "../MainLayout/MarkAsNotSuitRecord.vue";
import RunningOverlay from "../../features/RunningOverlay/index.vue";
import { useTaskManagerStore, useUpdateStore } from "../../store";
import buildInfo from "../../../../common/build-info.json";
import "./filter-data.js";
import "./keyword-examples.js";
import "./ux.css";
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
    const R = { ...Vue, message: ElMessage },
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
    const recordTab = ref("chat"),
      libraryTab = ref("jobs"),
      settingTab = ref("account");
    const platformOpen = ref(false),
      searchRotationOpen = ref(false),
      platformFiltersOpen = ref(false),
      policyExceptionsOpen = ref(false),
      activeAutoSection = ref("job-preferences");
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
    const modelForm = ref(
      modelPair(initial.modelDraft || initial.config["llm.json"]),
    );
    const otherModelsOpen = ref(false),
      browserForm = ref({ path: initial.browser?.executablePath || "" }),
      browserBusy = ref(false),
      dingtalkForm = ref({
        token: initial.config["dingtalk.json"]?.groupRobotAccessToken || "",
      }),
      dingtalkBusy = ref(false),
      browserError = ref("");
    const promptKind = ref("rechat"),
      promptText = ref(""),
      notice = ref("");
    const nav = [
      ["auto", "自动打招呼"],
      ["follow", "消息跟进"],
      ["records", "求职记录"],
      ["library", "资料库"],
      ["settings", "设置"],
    ];
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
            : !Array.isArray(children) &&
                typeof children === "object" &&
                typeof children.default === "function"
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
    const metric = (value) =>
      h("strong", { class: "ux-metric" }, String(value));
    const alert = (text, type = "info") =>
      E("ElAlert", { title: text, type, closable: false, showIcon: true });
    const card = (title, children, props = {}) =>
      h("section", { class: "ux-card", ...props }, [
        h("h2", title),
        ...children,
      ]);
    function disclosure(title, state, id, children) {
      return h(
        "section",
        { class: ["ux-disclosure", state.value ? "is-open" : ""] },
        [
          h(
            "button",
            {
              type: "button",
              id: id + "-toggle",
              class: "ux-disclosure-toggle",
              "aria-expanded": state.value,
              "aria-controls": id,
              onClick: () => (state.value = !state.value),
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
              h(
                "span",
                { class: "ux-disclosure-state" },
                state.value ? "已展开，收起" : "已收起，展开",
              ),
            ],
          ),
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
              imageButton(
                "assets/intro-of-job-source-B4GbQdJp.png",
                "职位来源位置示意图",
              ),
              hint("点击图片放大查看，可用滚轮或底部按钮缩放。"),
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
      if (obj === browserForm.value || obj === dingtalkForm.value) return;
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
      if (key === "titles")
        return effective().regexMode ? "岗位规则至少一项" : "必填";
      if (key === "source-selection") return "必选 · 至少一项";
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
          h("label", { for: id || undefined }, [label, requiredBadge(id)]),
          control,
          inlineErrors(id),
          help ? hint(help) : null,
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
          offset: 70,
          duration: 8000,
          showClose: true,
          customClass: "ux-template-undo",
          message: inline([
            h("span", "已删除模板“" + deleted.item.name + "”"),
            button(
              "撤销",
              async () => {
                if (await restoreTemplate(deleted)) undoToast?.close();
              },
              {
                link: true,
                type: "primary",
                "aria-label": "撤销删除模板" + deleted.item.name,
              },
            ),
          ]),
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
        "···",
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
          h("p", { class: "ux-template-picker-title" }, "选择要使用的模板"),
          templates.value.length
            ? h(
                "div",
                { class: "ux-template-list", role: "list" },
                templates.value.map(templateItem),
              )
            : hint("还没有模板。先新建并命名，再修改下面的条件。"),
          hint("选中后直接修改页面条件；“···”可重命名或删除。"),
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
    function basicToConfig(d) {
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
        isSageTimeEnabled: d.pause,
        ...(d.pause ? { sageTimeOpTimes: d.actions, sageTimePauseMinute: d.minutes } : {}),
        skipUnparseableSalaryJob: d.skipUnparseableSalaryJob !== false,
        jobListLoadWaitSeconds: waitSeconds(
          d.jobListLoadWaitSeconds,
          DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
        ),
        jobDetailViewWaitSeconds: waitSeconds(
          d.jobDetailViewWaitSeconds,
          DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS,
        ),
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
    function validation(d) {
      const a = [];
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
        if (!d.regexTitle && !d.regexType && !d.regexDesc)
          a.push({
            field: "titles",
            text: "请填写目标岗位，或在高级模式设置至少一条岗位规则。",
          });
      } else if (!d.titles.length && !d.legacyPatterns?.titles)
        a.push({
          field: "titles",
          text: "请添加目标岗位关键词，输入后按回车确认。",
        });
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
      if (
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
      return a;
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
        const control = target?.querySelector(
          e.field?.startsWith("follow-") &&
            ["follow-categories", "follow-excluded"].includes(e.field)
            ? "button:not(:disabled)"
            : 'input:not(:disabled):not([type="checkbox"]),textarea:not(:disabled),button:not(:disabled),input:not(:disabled)',
        );
        (control || target)?.focus({ preventScroll: true });
      });
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
                  e.label ? e.text + " · " + e.label : e.text,
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
            modelForm.value = modelPair(s.config["llm.json"]);
        } catch {
          notice.value = "无法重新读取设置，请重试。";
        }
      }
    }
    const dataComponents = {
      JobLibrary,
      BossLibrary,
      CompanyLibrary,
      StartChatRecord,
      MarkAsNotSuitRecord,
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
            imageButton(src, label + "位置示意图"),
            hint("点击图片放大查看，可用滚轮或底部按钮缩放。"),
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
            "包含任一关键词即可，如“工程师”可匹配不同工程师岗位。",
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
              check(
                draft.value,
                "skipUnparseableSalaryJob",
                "跳过兼职、日结、实习等无法识别薪资的岗位",
              ),
              hint(
                "取消勾选后会向这类岗位打招呼；填写了期望薪资时，这类岗位因无法比较薪资仍会跳过。",
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
              check(obj, key, "只看人事发布的岗位", {
                disabled: useField(key),
              }),
              hint("可能排除业务负责人发布的岗位。"),
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
            ["companies", "excluded", "categories", "description"].includes(key)
              ? fieldLocation(key, label)
              : null,
            override(key),
          ]),
          ctl,
          help ? hint(help) : null,
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
          h("h3", title),
          note ? hint(note) : null,
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
    function summary(d) {
      const words = d.independentWords ? d.sourceWords : d.titles;
      return h("ul", { class: "ux-summary" }, [
        h(
          "li",
          "岗位：" +
            (d.regexMode
              ? "高级规则（保留原有且 / 或逻辑）"
              : d.titles.join("、") || "尚未填写"),
        ),
        h(
          "li",
          "城市：" +
            (d.cities.join("、") || "不限") +
            "；薪资：" +
            (d.salary
              ? (d.low ?? "不限") +
                " — " +
                (d.high ?? "不限") +
                (d.unit === "month" ? " 元 / 月" : " 万元 / 年")
              : "不限"),
        ),
        h(
          "li",
          "查找来源：" +
            (d.sourceList
              ? d.sourceList
                  .filter((s) => s.enabled)
                  .map((s) => sourceInfo[s.type]?.[0] || s.type)
                  .join(" → ")
              : d.source),
        ),
        h(
          "li",
          "不匹配：默认" +
            strategyLabel(d.strategy) +
            "；" +
            Object.keys(d.overrides).filter((k) => d.overrides[k]).length +
            "项按原因覆盖。平台标记可能改变推荐，实际以原因设置为准。",
        ),
        h(
          "li",
          "条件来源：" +
            (d.inherit ? "已保存偏好 + 本次覆盖" : "本次独立设置") +
            "；" +
            (d.pause
              ? "每 " + d.actions + " 次浏览器操作休息 " + d.minutes + " 分钟"
              : "未启用定时休息") +
            "（默认节奏不是安全保证）。",
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
                check(s, "enabled", sourceInfo[s.type]?.[0] || s.type),
                hint(sourceInfo[s.type]?.[1] || "保留已有来源。"),
              ]),
            ),
          ),
          "",
          false,
          "source-selection",
        ),
        search.enabled
          ? field(
              "BOSS搜索内容",
              h("div", [
                searchRow(search.children[0], 0),
                explain("搜索内容会填入BOSS搜索框，再按你的求职条件筛选。"),
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
          "BOSS页面筛选 · 已设置 " +
            (d.platformMode === 2
              ? d.platformCombos.length + " 个组合"
              : Object.values(d.platformFilters).filter(
                  (values) => Array.isArray(values) && values.length,
                ).length + " 项"),
          platformFiltersOpen,
          "platform-filters",
          platformControls(),
        ),
        search.enabled
          ? disclosure("自动轮换搜索", searchRotationOpen, "search-rotation", [
              check(d, "searchRotation", "启用自动轮换搜索", {
                modelValue: rotate,
              }),
              explain("查完当前搜索的筛选列表，没有可聊岗位后换下一条。"),
              !rotate
                ? explain("关闭时只用第一个搜索内容，其余内容保留。")
                : null,
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
              explain("先查上面的来源，查完再换下一个；不是岗位优先级。"),
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
            ])
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
        explain("只改变BOSS展示的列表，不会替代你的求职条件。"),
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
        d.platformMode === 1 && combinationStats.hasConditions
          ? explain("想固定筛选范围？改选“逐条设置固定组合”。")
          : null,
        d.platformMode === 2
          ? explain("按组合顺序查找，全部查完再换来源。")
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
          "单独处理某种情况 · 已设置 " + exceptionCount + " 项",
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
            explain("“只标记指定公司”使用求职条件中的“只看这些公司”名单。"),
          ],
        ),
      ];
    }
    function rhythmControls() {
      const d = draft.value;
      return [
        validationArea("rhythm", [
          inline([check(d, "pause", "定时休息"), requiredBadge("rhythm")]),
          d.pause
            ? h("div", { class: "ux-rhythm-line" }, [
                h("span", "每操作"),
                number(d, "actions", { "aria-label": "休息前操作次数" }),
                h("span", "次，休息"),
                number(d, "minutes", { min: 0, "aria-label": "休息分钟数" }),
                h("span", "分钟"),
              ])
            : null,
          hint(
            "操作包括加载列表、查看详情和打招呼，不是成功打招呼次数。休息不保证避免平台限制。",
          ),
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
          ]),
          hint(
            `默认分别为 ${DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS} 秒和 ${DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS} 秒。调短会更快，但更容易被平台限制；留空使用默认值。`,
          ),
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
    const runIds = ref({ auto: null, follow: null }),
      overlays = { auto: null, follow: null };
    function showRuntime(task) {
      overlays[task]?.show();
    }
    async function begin(task) {
      if (
        preparing.value ||
        starting.value ||
        running.value.auto ||
        running.value.follow
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
        runtimeSteps.value = [
          {
            label: "登录凭证格式有效（登录是否有效由运行时确认）",
            ok: cookieValid,
          },
          { label: "浏览器已配置", ok: browser.value },
          { label: "当前条件已保存", ok: true },
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
      if (starting.value) return;
      starting.value = true;
      const task = checks.value;
      try {
        await taskStore.getRunningTasks();
        if (
          taskStore.runningTasks.some((t) =>
            Object.values(workerIds).includes(t.workerId),
          )
        )
          throw Error("已有任务运行中，请先停止当前任务。");
        const result = await window.electron.ipcRenderer.invoke(
          task === "auto"
            ? "run-geek-auto-start-chat-with-boss"
            : "run-read-no-reply-auto-reminder",
        );
        requestedStop[task] = false;
        taskProgress.value[task] = {
          startedAt: Date.now(),
          viewed: 0,
          sent: 0,
          skipped: 0,
          state: "running",
          detail: "准备检查任务",
          runRecordId: result.runRecordId,
        };
        runIds.value[task] = result.runRecordId;
        running.value[task] = true;
        modal.value = "";
        notice.value =
          "任务已启动。运行中修改的条件用于下次开始，不改变本次任务使用的配置。";
        R.nextTick(() => showRuntime(task));
      } catch (error) {
        R.message({ type: "error", message: "任务启动失败：" + error.message });
        notice.value = "任务未启动，请修复错误后重试。";
      } finally {
        starting.value = false;
      }
    }
    async function stop(task) {
      if (stopping.value) return;
      requestedStop[task] = true;
      stopping.value = true;
      try {
        await window.electron.ipcRenderer.invoke("stop-task", workerIds[task]);
        await taskStore.getRunningTasks();
        running.value[task] = taskStore.runningTasks.some(
          (t) => t.workerId === workerIds[task],
        );
        notice.value = running.value[task]
          ? "停止请求已发送，等待任务退出。"
          : "任务已停止。";
      } catch (error) {
        R.message({ type: "error", message: "停止失败：" + error.message });
      } finally {
        stopping.value = false;
      }
    }
    function runPanel(task) {
      const p = taskProgress.value[task];
      if (!p) return null;
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
      };
      return h(
        "section",
        { class: "ux-run-panel", role: "status", "aria-label": "任务运行结果" },
        [
          h("h3", titles[p.state] || "正在检查任务"),
          h("p", [
            "已查看 ",
            metric(p.viewed),
            " · 已发送 ",
            metric(p.sent),
            " · 已跳过 ",
            metric(p.skipped),
            " · 已运行 ",
            metric(elapsed),
            " 秒",
          ]),
          hint(p.detail),
          p.listSummary ? hint(p.listSummary) : null,
          p.lastSkippedDetail
            ? hint("最近一次跳过：" + p.lastSkippedDetail)
            : null,
          hint(
            "持续查找，不显示预计完成时间。已查看仅统计完成详情检查的岗位或会话。",
          ),
          active
            ? inline([
                button("查看运行状态", () => showRuntime(task)),
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
    function runtimeOverlay(task) {
      return h(
        RunningOverlay,
        {
          ref: (v) => (overlays[task] = v),
          workerId: workerIds[task],
          runRecordId: runIds.value[task],
        },
        {
          "op-buttons": () =>
            inline([
              button("返回页面", () => overlays[task]?.hide(), {
                size: "small",
              }),
              running.value[task]
                ? button("停止任务", () => stop(task), {
                    type: "danger",
                    size: "small",
                    loading: stopping.value,
                  })
                : null,
            ]),
        },
      );
    }
    function jumpAutoSection(id, focusSelector) {
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
      if (route.value !== "auto") return;
      const scroller = document.querySelector(".ux-main");
      if (
        scroller &&
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      ) {
        activeAutoSection.value = "job-policy";
        return;
      }
      const top =
        document.querySelector(".ux-section-nav")?.getBoundingClientRect()
          .bottom || 64;
      const ids = ["job-preferences", "job-sources", "job-policy"];
      activeAutoSection.value =
        ids
          .filter(
            (id) =>
              (document.getElementById(id)?.getBoundingClientRect().top ??
                Infinity) <=
              top + 24,
          )
          .pop() || ids[0];
    }
    function autoPage() {
      return [
        heading("自动打招呼"),
        templateBar(),
        problems(errors.value),
        runPanel("auto"),
        h("nav", { class: "ux-section-nav", "aria-label": "配置分组" }, [
          ...[
            ["job-preferences", "求职条件"],
            ["job-sources", "职位来源"],
            ["job-policy", "处理方式"],
          ].map(([id, label]) =>
            h(
              "a",
              {
                href: "#" + id,
                "aria-current":
                  activeAutoSection.value === id ? "location" : undefined,
                onClick: (event) => {
                  event.preventDefault();
                  jumpAutoSection(id);
                },
              },
              label,
            ),
          ),
        ]),
        card("我的求职条件", prefs(draft.value), {
          id: "job-preferences",
          tabIndex: -1,
        }),
        card(sourceTitle(), sourceControls(), {
          id: "job-sources",
          tabIndex: -1,
        }),
        card(
          "遇到不符合条件的岗位",
          [
            ...policyControls(),
            h("div", { class: "ux-preference-group" }, [
              h("h3", "运行节奏"),
              ...rhythmControls(),
            ]),
          ],
          { id: "job-policy", tabIndex: -1 },
        ),
        footer("auto"),
      ];
    }
    function heading(title, desc) {
      return h("header", [
        h("div", { class: "ux-page-title" }, [h("h1", title)]),
      ]);
    }
    function footer(task) {
      return h("footer", { class: "ux-footer" }, [
        errors.value.length
          ? button(
              "还有 " + errors.value.length + " 项未完成 · 去填写",
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
                ? "运行中 · 修改用于下次"
                : draftSaveError.value ||
                    (draftSaveState.value.includes("保存中")
                      ? "草稿保存中…"
                      : "修改自动保留"),
            ),
        draftSaveError.value
          ? button("重试保存", () => save(false, task), { plain: true })
          : null,
        button(
          task === "follow" ? "开始跟进" : "开始打招呼",
          () => begin(task),
          {
            type: "primary",
            loading: preparing.value || starting.value,
            disabled:
              running.value.auto || running.value.follow || starting.value,
          },
        ),
      ]);
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
              h("label", { for: "supplemental-text" }, "补充消息内容"),
              hint("留空使用软件默认话术，不会修改BOSS账号的默认招呼。"),
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
              hint("根据简历生成补充消息；生成失败时改发固定消息。"),
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
        heading("消息跟进"),
        hint("仅跟进已读未回的会话，不自动回复来信。"),
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
              ]),
              hint(
                "只检查关联岗位的职位分类；与自动打招呼共用分类，不重新检查城市或薪资。",
              ),
            ]),
            validationArea("follow-excluded", [
              check(f, "exclude", "排除指定公司的会话"),
              inline([
                companySummary(d, "excluded"),
                button("设置排除公司", () => openCompanies("excluded"), {
                  plain: true,
                  size: "small",
                }),
              ]),
              hint("与自动打招呼的“不看这些公司”共用名单。"),
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
                h("h3", "首次补充消息"),
                h(
                  "p",
                  { class: "ux-follow-description" },
                  "还没有可用于跟进的历史消息时，先发送一段补充消息。",
                ),
                h("div", { class: "ux-message-form" }, supplementalControls()),
              ],
            ),
            h(
              "div",
              { class: "ux-preference-group", id: "follow-subsequent" },
              [
                h("h3", "后续跟进消息"),
                h(
                  "p",
                  { class: "ux-follow-description" },
                  "已经有可用于跟进的历史消息，BOSS仍未回复时，继续跟进。",
                ),
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
                    ]),
                  ),
                  f.source === "emotion"
                    ? hint("无需填写消息，也不需要配置AI。")
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
                        ]),
                        hint(
                          "简历中应只保留必要信息，不包含密码、联系方式等无关敏感信息。",
                        ),
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
        footer("follow"),
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
        chat: "StartChatRecord",
        skip: "MarkAsNotSuitRecord",
      };
      return [
        heading(
          library ? "资料库" : "求职记录",
          library
            ? "保留原有独立数据集；在这里切换查看，无需记住多个菜单。"
            : "展示已开聊和已跳过的岗位记录，不包含消息跟进记录。",
        ),
        tabBar(selected, tabs, (v) => {
          if (library) libraryTab.value = v;
          else recordTab.value = v;
        }),
        hint(
          selected === "skip"
            ? "本地跳过不等于已在BOSS标记。"
            : "这里读取本机真实数据。岗位详情是已保存内容，在BOSS查看当前岗位。",
        ),
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
          ],
          (v) => (settingTab.value = v),
        ),
        tab === "account"
          ? card("BOSS账号与登录", [
              alert(
                login.value ? "已保存登录凭证" : "未保存登录凭证",
                login.value ? "success" : "warning",
              ),
              inline([
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
              ]),
              hint(
                "登录凭证是敏感信息，不要分享截图或日志。这里只检测本地凭证是否存在，未验证真实BOSS登录。",
              ),
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
              ]),
              hint(
                "文件存在不代表浏览器版本兼容；开始任务时仍会做运行检查。下载窗口保留进度、取消和失败重试。",
              ),
            ])
          : null,
        tab === "ai" ? aiSettings() : null,
        tab === "ai" ? aiFooter() : null,
        tab === "notify"
          ? card("钉钉通知", [
              alert(
                native.state().config["dingtalk.json"]?.groupRobotAccessToken
                  ? "钉钉通知已开启"
                  : "钉钉通知未开启",
                native.state().config["dingtalk.json"]?.groupRobotAccessToken
                  ? "success"
                  : "info",
              ),
              field(
                "群机器人 AccessToken",
                input(dingtalkForm.value, "token", {
                  type: "password",
                  showPassword: true,
                  autocomplete: "off",
                  "aria-label": "钉钉群机器人 AccessToken",
                  placeholder: "机器人 Webhook 地址中 access_token= 后面的部分",
                }),
                "自动打招呼运行时，开聊记录和运行错误会每 2 分钟合并发送到该群。请勿使用公司内部群。留空并保存即关闭通知。",
              ),
              inline([
                button("保存钉钉配置", saveDingtalk, {
                  type: "primary",
                  loading: dingtalkBusy.value,
                }),
              ]),
              hint("修改后从下次开始任务起生效。"),
            ])
          : null,
      ];
    }
    async function saveDingtalk() {
      let token = dingtalkForm.value.token.trim();
      // accept a pasted webhook URL as well as the bare token
      const fromUrl = /access_token=([^&\s]+)/.exec(token);
      if (fromUrl) token = fromUrl[1];
      dingtalkBusy.value = true;
      try {
        await native.saveDingtalk(token);
        dingtalkForm.value.token = token;
        R.message({
          type: "success",
          message: token ? "钉钉通知已保存" : "钉钉通知已关闭",
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
                modelForm.value = modelPair([]);
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
              input(m, "model", {
                id: id("model"),
                "aria-label": "模型名称 " + index,
                placeholder: "填写服务商提供的模型标识",
                disabled: locked,
              }),
              "",
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
                disabled: locked,
              }),
              "密钥保存在本机。",
              false,
              id("key"),
            ),
          ],
        );
      };
      return card(
        "AI模型配置",
        [
          hint("仅在选择 AI 消息时使用。测试会发送一条简单请求，不包含简历。"),
          initial.config["llm.json"].length > 2 && modelDirty.value
            ? hint("旧配置超过2个，保存时将安全备份。")
            : null,
          initial.draftSecretOmitted
            ? hint("上次未保存的密钥需重新填写。")
            : null,
          modelEditor(modelForm.value[0], 0),
          h("div", { class: "ux-ai-backup" }, [
            check(modelForm.value[1], "enabled", "启用备用模型", {
              disabled: locked,
            }),
            hint("首选失败时使用备用。"),
            modelForm.value[1].enabled
              ? modelEditor(modelForm.value[1], 1)
              : null,
          ]),
          h("section", { class: "ux-ai-model", "data-model-role": "request" }, [
            h("h3", "请求设置"),
            hint("对首选和备用模型同时生效。"),
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
            ]),
            hint(
              `默认超时 ${AI_REQUEST_DEFAULTS.requestTimeoutSeconds} 秒、重试 ${AI_REQUEST_DEFAULTS.maxRetries} 次；超时、限流和服务端错误会自动重试，“测试连接”不重试。`,
            ),
            check(modelForm.value[0], "thinkingEnabled", "开启思考模式", {
              disabled: locked,
            }),
            hint(
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
            explain(["当前名单：", metric(obj[key].length), " 个关键词"]),
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
            h("h3", "示例公司组"),
            hint(
              "点击追加到当前名单，不覆盖已有内容。示例仅供参考，请按需要删改。",
            ),
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
          hint(
            key === "companies"
              ? "公司名包含任一关键词即可；名单为空时不限公司。"
              : "公司名包含任一关键词就排除；“不看”优先于“只看”。",
          ),
          hint("应用后会同步用于自动打招呼和消息跟进的公司条件。"),
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
            h("li", "填写目标岗位、城市与可选薪资；需要时再添加其它条件。"),
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
        content = [
          alert(
            "确认开始后将执行真实任务，可能向招聘者发送消息或在BOSS标记不合适。请确认联系范围。",
            "warning",
          ),
          ...runtimeSteps.value.map((s) =>
            h("div", { class: "ux-check" }, [
              h("span", s.label),
              E(
                "ElTag",
                { type: s.ok ? "success" : "danger" },
                s.ok ? "已通过" : "需要修复",
              ),
            ]),
          ),
          preparing.value ? hint("正在检查…") : null,
          shortResume.value
            ? alert(
                "简历内容不足800字，AI生成质量可能较差。可返回补充，或确认继续。",
                "warning",
              )
            : null,
          checks.value === "auto"
            ? summary(effective())
            : hint(
                (follow.value.days === 0
                  ? "不限时间的"
                  : "最近" + follow.value.days + "天的") +
                  "已读未回复会话；消息来源：" +
                  (follow.value.source === "emotion"
                    ? "期待回复表情"
                    : "AI生成") +
                  "；每次间隔" +
                  follow.value.interval +
                  "分钟。",
              ),
          !login.value
            ? button(
                "修复登录",
                () => {
                  modal.value = "";
                  navigate("settings");
                  settingTab.value = "account";
                },
                { type: "primary", plain: true },
              )
            : null,
          !browser.value
            ? button(
                "修复浏览器",
                () => {
                  modal.value = "";
                  navigate("settings");
                  settingTab.value = "browser";
                },
                { type: "primary", plain: true },
              )
            : null,
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
    const Root = {
      render() {
        return h("div", { class: "ux-shell" }, [
          h("aside", { class: "aside-nav ux-nav", "data-v-cccda18a": "" }, [
            h("p", { class: "ux-brand" }, "牛人快跑"),
            hint("GeekGeekRun"),
            h(
              "nav",
              {
                class: "group-item",
                "data-v-e836690d": "",
                "aria-label": "主导航",
              },
              [
                h(
                  "div",
                  { class: "group-title", "data-v-e836690d": "" },
                  "逛BOSS",
                ),
                h(
                  "div",
                  { class: "link-list", "data-v-e836690d": "" },
                  nav.map(([key, label]) =>
                    h(
                      "a",
                      {
                        href: "#/ux/" + key,
                        "data-v-e836690d": "",
                        class: route.value === key ? "router-link-active" : "",
                        "aria-current":
                          route.value === key ? "page" : undefined,
                        onClick: (e) => {
                          e.preventDefault();
                          navigate(key);
                        },
                      },
                      label,
                    ),
                  ),
                ),
              ],
            ),
            h("div", { class: "ux-nav-bottom" }, [
              running.value.auto
                ? inline([
                    E("ElTag", { size: "small" }, "打招呼中"),
                    button("停止开聊", () => stop("auto"), {
                      link: true,
                      loading: stopping.value,
                    }),
                  ])
                : null,
              running.value.follow
                ? inline([
                    E("ElTag", { size: "small" }, "跟进中"),
                    button("停止跟进", () => stop("follow"), {
                      link: true,
                      loading: stopping.value,
                    }),
                  ])
                : null,
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
              hint("版本：" + buildInfo.version),
              h("div", { class: "ux-project-links" }, [
                button(
                  "项目首页",
                  () =>
                    window.electron.ipcRenderer.send(
                      "open-external-link",
                      "https://github.com/geekgeekrun/geekgeekrun",
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
                    ["library", "records"].includes(route.value)
                      ? "ux-inner--data"
                      : "",
                  ],
                },
                [
                  notice.value
                    ? h("div", { role: "status" }, hint(notice.value))
                    : null,
                  ...(route.value === "auto"
                    ? autoPage()
                    : route.value === "follow"
                      ? followPage()
                      : route.value === "records"
                        ? dataPage(false)
                        : route.value === "library"
                          ? dataPage(true)
                          : settingsPage()),
                ],
              ),
            ],
          ),
          dialogs(),
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
          runtimeOverlay("auto"),
          runtimeOverlay("follow"),
        ]);
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
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("pointerdown", pointerHandler);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("beforeunload", unloadHandler);
    window.addEventListener("blur", flushDraft);
    const unwatch = R.watch(
      () => taskStore.runningTasks,
      (tasks) => {
        for (const [task, id] of Object.entries(workerIds)) {
          const worker = tasks.find((t) => t.workerId === id);
          running.value[task] = Boolean(worker);
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
            : [88, 89].includes(message.code)
              ? "blocked"
              : requestedStop[task] || message.code === 0
                ? "stopped"
                : "error";
          taskProgress.value[task].stoppedAt = Date.now();
          taskProgress.value[task].detail = message.restarting
            ? "重新检查后开始，不保证原位置续跑"
            : requestedStop[task] || message.code === 0
              ? "任务已停止，实际累计统计保留"
              : [88, 89].includes(message.code)
                ? taskProgress.value[task].detail
                : "请修复问题后重新开始；不会从原位置续跑";
        }
        const labels = {
          81: "登录凭证已失效",
          82: "登录状态已失效",
          83: "网络已断开",
          84: "平台拒绝访问或需要人工验证",
          85: "浏览器不可执行",
          86: "AI服务不可用",
          87: "发送结果未确认，请先在BOSS中核对，避免重复发送",
          88: "连续检查5批岗位没有可沟通岗位；请检查公司名单、分类和经验条件",
          89: "岗位列表或详情未能确认，已停止，未继续发送；请检查BOSS页面",
        };
        notice.value =
          message.code === 0
            ? "任务已结束。"
            : ([88, 89].includes(message.code)
                ? "任务已停止："
                : "任务异常结束：") +
              (labels[message.code] || "退出码 " + message.code) +
              "。请修复后重新开始。";
      },
    );
    R.onUnmounted(() => {
      aiFooterObserver?.disconnect();
      clearTimeout(draftSaveTimer);
      clearInterval(progressTimer);
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
