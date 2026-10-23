<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { createWorkspace } from "./services/workspace.ts";
import { record, text } from "./services/models.ts";
import type { JobCard } from "./services/models.ts";
const ws = createWorkspace(),
  s = ws.state;
const input = ref(""),
  chatInput = ref(""),
  phone = ref(""),
  code = ref(""),
  origin = ref(s.origin),
  verificationUrl = ref(s.verificationUrl),
  settingsOpen = ref(false),
  tasksOpen = ref(false),
  selected = ref<JobCard | null>(null),
  confirmOpen = ref(false),
  feed = ref<HTMLElement>();
const titles: Record<string, string> = {
  assistant: "求职助手",
  jobs: "为你发现",
  messages: "沟通",
  account: "我的空间",
};
const tabs = [
  { id: "assistant", name: "对话", icon: "spark" },
  { id: "jobs", name: "岗位", icon: "briefcase" },
  { id: "messages", name: "消息", icon: "chat" },
  { id: "account", name: "我的", icon: "user" },
];
const suggestions = [
  "帮我找上海的前端岗位",
  "我想转型 AI 应用开发",
  "一起梳理我的求职方向",
];
const subtitle = computed(() =>
  s.demo
    ? "先体验，再开始你的下一站"
    : s.loggedIn
      ? "让每一次选择，都更接近理想工作"
      : "连接服务，开始你的求职之旅",
);
async function send(value = input.value) {
  if (!value.trim() || s.busy) return;
  input.value = "";
  await ws.sendAI(value);
}
async function sendChat() {
  if (!chatInput.value.trim() || s.busy) return;
  const value = chatInput.value;
  chatInput.value = "";
  await ws.sendBoss(value);
}
async function confirm() {
  if (!selected.value) return;
  await ws.confirmJob(selected.value);
  confirmOpen.value = false;
  if (!s.error) selected.value = null;
}
function configure() {
  if (ws.connect(origin.value, verificationUrl.value)) {
    settingsOpen.value = false;
    s.tab = "account";
  }
}
watch(
  () => [s.ai.length, s.chat.length, s.busy],
  async () => {
    await nextTick();
    feed.value?.scrollTo({ top: feed.value.scrollHeight, behavior: "smooth" });
  },
);
function dateTime(value: number) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未登录";
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button
        v-if="s.currentContact"
        class="icon-button"
        aria-label="返回会话列表"
        @click="ws.closeContact"
      >
        <Icon name="back" />
      </button>
      <div v-else class="brandmark" aria-hidden="true"><span>↗</span></div>
      <div class="header-copy">
        <span class="eyebrow">GEEK GEEK RUN</span
        ><strong>{{
          s.currentContact ? s.currentContact.name : titles[s.tab]
        }}</strong>
      </div>
      <button
        v-if="s.tab === 'assistant' && !s.currentContact"
        class="icon-button"
        aria-label="开始新对话"
        :disabled="!!s.busy"
        @click="ws.newConversation"
      >
        <Icon name="plus" />
      </button>
      <button class="mode-badge" @click="settingsOpen = true">
        <i :class="{ live: !s.demo }" />{{
          s.demo ? "体验模式" : s.loggedIn ? "已登录" : "待登录"
        }}
      </button>
    </header>
    <main
      ref="feed"
      class="main"
      :class="{ 'conversation-main': s.currentContact }"
    >
      <div v-if="s.error" class="banner error" role="alert">
        <span>{{ s.error }}</span
        ><button aria-label="关闭错误提示" @click="s.error = ''">×</button>
      </div>
      <div v-if="s.notice" class="banner notice" role="status">
        <span>{{ s.notice }}</span
        ><button aria-label="关闭提示" @click="s.notice = ''">×</button>
      </div>
      <template v-if="s.currentContact">
        <div class="contact-context">
          <div class="avatar">{{ s.currentContact.name.slice(0, 1) }}</div>
          <div>
            <strong>{{ s.currentContact.title }}</strong
            ><small>{{ s.currentContact.brand }}</small>
          </div>
          <span class="connection"><i />{{ s.connection }}</span>
        </div>
        <button
          v-if="!s.demo && s.connection === '连接已断开'"
          class="text-button center"
          :disabled="!!s.busy"
          @click="ws.openContact(s.currentContact)"
        >
          重新连接
        </button>
        <p class="conversation-date">
          {{
            s.demo
              ? "示例会话 · 不会发送真实消息"
              : "仅当前设备连接期间接收实时消息"
          }}
        </p>
        <div
          v-for="line in s.chat"
          :key="line.id"
          class="chat-line"
          :class="line.role"
        >
          <div class="bubble">{{ line.text }}</div>
          <small v-if="line.status">{{ line.status }}</small>
        </div>
        <div v-if="!s.chat.length" class="empty compact">
          <Icon name="chat" />
          <p>开始一段真诚的沟通</p>
        </div>
      </template>
      <template v-else-if="s.tab === 'assistant'">
        <section class="hero">
          <div class="hero-top">
            <span class="tiny-pill"><i />你的求职同行者</span
            ><span class="hero-step">01 / EXPLORE</span>
          </div>
          <h1>下一站，<br />更合适的你<span>。</span></h1>
          <p>{{ subtitle }}</p>
          <div class="hero-art" aria-hidden="true">
            <div class="orbit orbit-a" />
            <div class="orbit orbit-b" />
            <span>↗</span><i class="art-dot" />
          </div>
          <div class="hero-footer">
            <span><Icon name="shield" />认真了解，再决定</span
            ><span>一起向前 <Icon name="arrow" /></span>
          </div>
        </section>
        <div class="section-label">
          <span>从一个想法开始</span><span class="muted">LET'S TALK</span>
        </div>
        <div class="suggestions">
          <button
            v-for="(prompt, index) in suggestions"
            :key="prompt"
            :disabled="!!s.busy"
            @click="send(prompt)"
          >
            <span class="suggestion-number">0{{ index + 1 }}</span
            ><span>{{ prompt }}</span
            ><Icon name="arrow" />
          </button>
        </div>
        <div class="section-label conversation-heading">
          <span><i class="green-dot" />当前对话</span
          ><button
            class="text-button"
            @click="
              tasksOpen = true;
              ws.refreshTasks();
            "
          >
            <Icon name="clock" />任务进度
          </button>
        </div>
        <div class="ai-feed">
          <div
            v-for="line in s.ai"
            :key="line.id"
            class="chat-line"
            :class="line.role"
          >
            <span v-if="line.role === 'assistant'" class="assistant-mark"
              ><Icon name="spark"
            /></span>
            <div class="bubble">{{ line.text }}</div>
          </div>
          <div v-if="s.busy === 'ai'" class="typing">
            <i /><i /><i /><span>正在整理思路</span>
          </div>
        </div>
        <div v-if="s.workModeSignal" class="inline-note">
          助手建议更新工作状态。请在服务方设置页核对，本应用不会自动开启代理或投递。
        </div>
        <button
          v-if="!s.demo && s.ai.length"
          class="text-button history-button"
          :disabled="!!s.busy"
          @click="ws.refreshAI"
        >
          <Icon name="refresh" />刷新本轮对话
        </button>
        <div class="bottom-spacer" />
      </template>
      <template v-else-if="s.tab === 'jobs'">
        <section class="page-intro">
          <span class="eyebrow">FIND YOUR NEXT</span>
          <h1>值得认真考虑<br />的下一份工作。</h1>
          <p>在这里，确认你感兴趣的岗位。</p>
        </section>
        <div class="section-label">
          <span
            >待确认岗位
            <b>{{ s.jobs.length.toString().padStart(2, "0") }}</b></span
          ><button
            class="text-button"
            :disabled="!!s.busy"
            @click="ws.refreshJobs"
          >
            <Icon name="refresh" />刷新
          </button>
        </div>
        <div class="job-list">
          <button
            v-for="(job, index) in s.jobs"
            :key="job.id"
            class="job-card"
            @click="selected = job"
          >
            <div class="job-card-top">
              <span class="job-monogram" :class="'tone-' + (index % 3)">{{
                job.brand.slice(0, 1)
              }}</span>
              <div>
                <span class="job-company">{{ job.brand }}</span>
                <h2>{{ job.title }}</h2>
              </div>
              <Icon name="arrow" />
            </div>
            <div class="job-salary">
              {{ job.salary
              }}<small><Icon name="pin" />{{ job.city || "城市待补充" }}</small>
            </div>
            <div class="job-tags">
              <span
                v-for="tag in [
                  job.experience,
                  job.degree,
                  ...job.skills.slice(0, 2),
                ].filter(Boolean)"
                :key="tag"
                >{{ tag }}</span
              >
            </div>
            <div class="job-card-footer">
              <span><i class="green-dot" />待你确认</span
              ><span>查看岗位详情</span>
            </div>
          </button>
        </div>
        <div v-if="!s.jobs.length" class="empty">
          <Icon name="briefcase" />
          <h2>好机会，值得耐心等一等</h2>
          <p>对话任务完成后，刷新查看待确认岗位。</p>
          <button
            class="secondary"
            :disabled="!!s.busy"
            @click="ws.refreshJobs"
          >
            刷新岗位
          </button>
        </div>
        <p class="footnote">
          {{
            s.demo
              ? "当前为虚构岗位，仅供体验。"
              : "岗位来自服务端待确认列表，任务完成后可能需要稍后刷新。"
          }}
        </p>
      </template>
      <template v-else-if="s.tab === 'messages'">
        <section class="page-intro">
          <span class="eyebrow">MAKE A CONNECTION</span>
          <h1>好的机会，<br />从一次沟通开始。</h1>
          <p>从投递记录中选择招聘方，继续交流。</p>
        </section>
        <div class="section-label">
          <span
            >投递会话
            <b>{{ s.contacts.length.toString().padStart(2, "0") }}</b></span
          ><button
            class="text-button"
            :disabled="!!s.busy"
            @click="ws.refreshContacts"
          >
            <Icon name="refresh" />刷新记录
          </button>
        </div>
        <button
          v-for="contact in s.contacts"
          :key="contact.id"
          class="contact-card"
          :disabled="!!s.busy"
          @click="ws.openContact(contact)"
        >
          <div class="avatar">{{ contact.name.slice(0, 1) }}</div>
          <div class="contact-copy">
            <strong
              >{{ contact.name }}<span>{{ contact.brand }}</span></strong
            >
            <p>{{ contact.title }}</p>
            <small>点击进入沟通</small>
          </div>
          <Icon name="arrow" />
        </button>
        <div v-if="!s.contacts.length" class="empty">
          <Icon name="chat" />
          <h2>每一段沟通，都从这里开始</h2>
          <p>确认投递后，刷新投递记录查看可联系的招聘方。</p>
        </div>
        <div class="soft-card">
          <Icon name="shield" />
          <div>
            <strong>让沟通保持真实</strong>
            <p>
              仅在你点击发送后提交消息。连接中断后，请核对记录再决定是否重发。
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <section class="profile">
          <div class="profile-avatar"><Icon name="user" /></div>
          <div>
            <span class="eyebrow">YOUR SPACE</span>
            <h1>{{ s.loggedIn ? s.userName : "每一步，为自己。" }}</h1>
            <p>
              {{
                s.demo
                  ? "正在体验牛人快跑"
                  : s.loggedIn
                    ? "欢迎回来，继续向前"
                    : "登录后连接真实求职服务"
              }}
            </p>
          </div>
        </section>
        <div class="account-status">
          <div>
            <span>当前环境</span
            ><strong>{{ s.demo ? "体验空间" : "个人服务" }}</strong>
          </div>
          <div>
            <span>会话有效期</span
            ><strong>{{
              s.demo ? "仅本次体验" : dateTime(s.expiresAt)
            }}</strong>
          </div>
        </div>
        <section v-if="!s.demo && !s.loggedIn" class="form-card">
          <h2>验证码登录</h2>
          <p>通过服务方提供的验证页面获取短信验证码。</p>
          <label
            >手机号<input
              v-model="phone"
              inputmode="tel"
              autocomplete="tel"
              placeholder="请输入手机号"
              maxlength="11" /></label
          ><label
            >验证码
            <div class="code-field">
              <input
                v-model="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="短信验证码"
                maxlength="8"
              /><button
                :disabled="!!s.busy"
                @click="ws.openVerification(phone)"
              >
                获取验证码
              </button>
            </div></label
          ><button
            class="primary full"
            :disabled="!!s.busy || !phone || !code"
            @click="ws.login(phone, code)"
          >
            {{ s.busy === "login" ? "正在登录…" : "登录并继续"
            }}<Icon name="arrow" /></button
          ><small>登录凭证保存在本机安全存储。验证码不会持久保存。</small>
        </section>
        <div class="settings-list">
          <button @click="settingsOpen = true">
            <Icon name="settings" /><span
              >服务连接<span>{{
                s.demo ? "配置你有权使用的服务" : s.origin
              }}</span></span
            ><Icon name="arrow" /></button
          ><button
            v-if="s.loggedIn"
            :disabled="!!s.busy"
            @click="s.privacy = true"
          >
            <Icon name="shield" /><span
              >BOSS 数据授权<span>了解并确认授权内容</span></span
            ><Icon name="arrow" /></button
          ><button @click="s.privacy = true">
            <Icon name="shield" /><span
              >隐私与数据<span>本机凭证、服务数据与账号控制</span></span
            ><Icon name="arrow" />
          </button>
        </div>
        <button
          v-if="s.loggedIn"
          class="secondary full"
          :disabled="!!s.busy"
          @click="ws.logout"
        >
          退出登录
        </button>
        <button
          v-if="!s.demo"
          class="text-button center"
          :disabled="!!s.busy"
          @click="ws.experience"
        >
          返回体验空间
        </button>
        <div class="app-signature">
          <span class="brandmark"><span>↗</span></span
          ><strong>牛人快跑</strong><small>GEEK GEEK RUN · 0.1.0</small>
          <p>让求职更从容，让选择更清晰。</p>
        </div>
      </template>
    </main>
    <div v-if="s.currentContact" class="composer chat-composer">
      <input
        v-model="chatInput"
        aria-label="给招聘方的消息"
        placeholder="聊聊你的想法…"
        :disabled="!!s.busy"
        @keydown.enter.prevent="sendChat"
      /><button
        class="send-button"
        aria-label="发送聊天消息"
        :disabled="
          !!s.busy ||
          !chatInput.trim() ||
          (!s.demo && s.connection !== '已连接')
        "
        @click="sendChat"
      >
        <Icon name="send" />
      </button>
    </div>
    <div v-else-if="s.tab === 'assistant'" class="composer-wrap">
      <div class="composer">
        <Icon name="spark" /><input
          v-model="input"
          aria-label="求职问题"
          placeholder="说说你期待的工作…"
          :disabled="!!s.busy"
          @keydown.enter.prevent="send()"
        /><button
          v-if="s.busy === 'ai'"
          class="stop-button"
          aria-label="停止接收回复"
          @click="ws.stopAI"
        >
          ■</button
        ><button
          v-else
          class="send-button"
          aria-label="发送问题"
          :disabled="!!s.busy || !input.trim()"
          @click="send()"
        >
          <Icon name="arrow" />
        </button>
      </div>
      <p>
        {{
          s.demo
            ? "体验模式 · 使用虚构数据，不会真实投递"
            : "AI 建议仅供参考；本应用投递前需确认"
        }}
      </p>
    </div>
    <nav v-if="!s.currentContact" class="bottom-nav" aria-label="主导航">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="{ active: s.tab === tab.id }"
        :aria-current="s.tab === tab.id ? 'page' : undefined"
        @click="s.tab = tab.id"
      >
        <Icon :name="tab.icon" /><span>{{ tab.name }}</span
        ><i v-if="tab.id === 'jobs' && s.jobs.length" class="nav-dot" />
      </button>
    </nav>
    <div
      v-if="s.busy && !['ai', 'send'].includes(s.busy)"
      class="loading-pill"
      role="status"
    >
      <i class="spinner" />正在处理…
    </div>
    <div
      v-if="settingsOpen"
      class="modal-backdrop"
      @click.self="settingsOpen = false"
    >
      <section
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div class="sheet-handle" />
        <button
          class="icon-button sheet-close"
          aria-label="关闭连接设置"
          @click="settingsOpen = false"
        >
          <Icon name="close" /></button
        ><span class="eyebrow">CONNECT YOUR SERVICE</span>
        <h2 id="settings-title">连接你的求职空间</h2>
        <p class="sheet-lead">
          填写你有权使用的服务地址。连接后可登录并查询真实数据。
        </p>
        <label
          >服务地址<input
            v-model="origin"
            type="url"
            autocapitalize="off"
            placeholder="https://api.example.com" /></label
        ><label
          >验证码验证页<input
            v-model="verificationUrl"
            type="url"
            autocapitalize="off"
            placeholder="服务方提供的 HTTPS 验证页面"
        /></label>
        <p class="inline-note">
          验证页需支持返回本应用；未配置时，可输入从服务方已获取的验证码。
        </p>
        <button
          class="primary full"
          :disabled="!!s.busy || !origin"
          @click="configure"
        >
          连接服务<Icon name="arrow" /></button
        ><button
          class="secondary full"
          :disabled="!!s.busy"
          @click="
            ws.experience();
            settingsOpen = false;
          "
        >
          使用体验空间
        </button>
      </section>
    </div>
    <div
      v-if="selected"
      class="modal-backdrop"
      @click.self="
        selected = null;
        confirmOpen = false;
      "
    >
      <section
        class="sheet job-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-title"
      >
        <div class="sheet-handle" />
        <button
          class="icon-button sheet-close"
          aria-label="关闭岗位详情"
          @click="
            selected = null;
            confirmOpen = false;
          "
        >
          <Icon name="close" /></button
        ><span class="eyebrow">YOUR NEXT OPPORTUNITY</span>
        <h2 id="job-title">{{ selected.title }}</h2>
        <div class="detail-salary">{{ selected.salary }}</div>
        <p>{{ selected.brand }}</p>
        <div class="job-tags">
          <span
            v-for="tag in [
              selected.city,
              selected.experience,
              selected.degree,
            ].filter(Boolean)"
            :key="tag"
            >{{ tag }}</span
          >
        </div>
        <h3>岗位介绍</h3>
        <p class="description">
          {{
            selected.description || "岗位详情暂未提供，请在联系前向招聘方核实。"
          }}
        </p>
        <div v-if="confirmOpen" class="confirm-panel">
          <strong>确认联系这家招聘方？</strong>
          <p>
            {{
              s.demo
                ? "本次为体验操作，不会真实投递。"
                : "将向服务提交本岗位的确认投递请求。请确认岗位与公司符合你的意愿。"
            }}
          </p>
          <button class="primary full" :disabled="!!s.busy" @click="confirm">
            {{ s.busy === "delivery" ? "正在提交…" : "确认投递" }}</button
          ><button
            class="text-button center"
            :disabled="!!s.busy"
            @click="confirmOpen = false"
          >
            再考虑一下
          </button>
        </div>
        <button
          v-else
          class="primary full"
          :disabled="!!s.busy"
          @click="confirmOpen = true"
        >
          我感兴趣，确认投递<Icon name="arrow" />
        </button>
      </section>
    </div>
    <div
      v-if="tasksOpen"
      class="modal-backdrop"
      @click.self="tasksOpen = false"
    >
      <section
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-title"
      >
        <div class="sheet-handle" />
        <button
          class="icon-button sheet-close"
          aria-label="关闭任务进度"
          @click="tasksOpen = false"
        >
          <Icon name="close" /></button
        ><span class="eyebrow">WORK IN PROGRESS</span>
        <h2 id="tasks-title">正在为你寻找</h2>
        <p class="sheet-lead">
          对话结束后，岗位任务可能仍在运行。完成后可刷新待确认岗位。
        </p>
        <button
          v-for="(task, index) in s.tasks"
          :key="text(task.id)"
          class="task-row"
          :disabled="!!s.busy"
          @click="ws.taskResults(task)"
        >
          <Icon name="briefcase" /><span
            >岗位任务 {{ index + 1
            }}<small>{{ text(task.status, "等待服务更新") }}</small></span
          ><Icon name="arrow" />
        </button>
        <div v-if="!s.tasks.length" class="empty compact">
          <Icon name="clock" />
          <p>暂未查询到当前对话的任务</p>
        </div>
        <div
          v-for="(result, index) in s.results"
          :key="text(result.id)"
          class="result-row"
        >
          <strong>任务结果 {{ index + 1 }}</strong>
          <p>
            {{
              text(record(result.content).summary) ||
              text(result.status, "结果已返回，可刷新待确认岗位")
            }}
          </p>
        </div>
        <button
          class="secondary full"
          :disabled="!!s.busy"
          @click="ws.refreshTasks"
        >
          刷新任务</button
        ><button
          class="primary full"
          @click="
            tasksOpen = false;
            s.tab = 'jobs';
            ws.refreshJobs();
          "
        >
          查看待确认岗位<Icon name="arrow" />
        </button>
      </section>
    </div>
    <div
      v-if="s.privacy"
      class="modal-backdrop"
      @click.self="s.privacy = false"
    >
      <section
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
      >
        <div class="sheet-handle" />
        <button
          class="icon-button sheet-close"
          aria-label="关闭隐私说明"
          @click="s.privacy = false"
        >
          <Icon name="close" /></button
        ><span class="eyebrow">YOUR DATA, YOUR CHOICE</span>
        <h2 id="privacy-title">隐私与数据</h2>
        <div class="privacy-copy">
          <h3>本机保存什么</h3>
          <p>
            原生应用将登录凭证存入系统安全存储；浏览器预览只在内存中保存。服务地址保存在本机。对话、岗位与聊天内容仅保留在运行内存中，退出登录时清空。
          </p>
          <h3>哪些数据会发送</h3>
          <p>
            真实模式下，手机号、验证码、对话与投递操作会发送至你配置的服务。招聘消息会发送至
            BOSS 聊天服务。具体保留、删除及账号注销方式由服务运营方提供。
          </p>
          <h3>BOSS 数据授权</h3>
          <p>
            点击下方授权按钮，将提交授权协议同意、同步简历并更新求职身份。请先了解服务运营方的协议与数据处理规则。
          </p>
          <p>
            本应用是独立项目，不代表 BOSS
            直聘或相关服务方。体验模式不会向这些服务发送数据。
          </p>
        </div>
        <button
          v-if="s.loggedIn"
          class="primary full"
          :disabled="!!s.busy"
          @click="
            s.privacy = false;
            ws.authorize();
          "
        >
          我已了解，同意授权 BOSS 数据</button
        ><button class="secondary full" @click="s.privacy = false">关闭</button>
      </section>
    </div>
  </div>
</template>
