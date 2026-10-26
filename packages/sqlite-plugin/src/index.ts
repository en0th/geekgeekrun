import { restoreLocalCooldowns } from './local-cooldown'
import { createDetailWriter } from './detail-writer'
import { observeJob } from './job-discovery'
import { bindJobRunScope } from './job-run-comparison'
export { ensureJobDiscovery } from './job-discovery'
export { getJobRunComparison } from './job-run-comparison'
import "reflect-metadata";
import { type DataSource } from "typeorm";

import { BossInfo } from "./entity/BossInfo";
import { BossInfoChangeLog } from "./entity/BossInfoChangeLog";
import { ChatStartupFrom, ChatStartupLog } from './entity/ChatStartupLog';
import { CompanyInfoChangeLog } from "./entity/CompanyInfoChangeLog";
import { CompanyInfo } from "./entity/CompanyInfo";
import { JobInfo } from "./entity/JobInfo";
import { JobInfoChangeLog } from "./entity/JobInfoChangeLog";
import { BossActiveStatusRecord } from "./entity/BossActiveStatusRecord";
import { UserInfo } from "./entity/UserInfo";
import { AutoStartChatRunRecord } from './entity/AutoStartChatRunRecord';
import { MarkAsNotSuitLog } from "./entity/MarkAsNotSuitLog"
import { VChatStartupLog } from "./entity/VChatStartupLog";
import { VBossLibrary } from "./entity/VBossLibrary";
import { VJobLibrary } from "./entity/VJobLibrary";
import { VCompanyLibrary } from "./entity/VCompanyLibrary"
import { VMarkAsNotSuitLog } from "./entity/VMarkAsNotSuitLog"
import { ChatMessageRecord } from './entity/ChatMessageRecord'
import { LlmModelUsageRecord } from './entity/LlmModelUsageRecord'
import { JobHireStatusRecord } from './entity/JobHireStatusRecord'

import {
  saveChatStartupRecord,
  saveJobInfoFromRecommendPage,
  saveMarkAsNotSuitRecord,
  getNotSuitMarkRecordsInLastSomeDays,
  getChatStartupRecordsInLastSomeDays,
  getBossIdsByJobIds,
  saveJobHireStatusRecord
} from "./handlers";
import { UpdateChatStartupLogTable1729182577167 } from "./migrations/1729182577167-UpdateChatStartupLogTable";
import minimist from 'minimist'
import { UpdateBossInfoTable1732032381304 } from "./migrations/1732032381304-UpdateBossInfoTable";
import { JobHireStatus, MarkAsNotSuitOp, MarkAsNotSuitReason } from "./enums";
import { AddColumnForMarkAsNotSuitLog1746092370665 } from "./migrations/1746092370665-AddColumnForMarkAsNotSuitLog";
import { Init1000000000000 } from "./migrations/1000000000000-Init";
import { AddJobSourceColumnForChatStartupLogAndMarkAsNotSuitLog1752380078526 } from "./migrations/1752380078526-AddJobSourceColumnForChatStartupLogAndMarkAsNotSuitLog";
import { AddJobHireStatusTable1766466476822 } from "./migrations/1766466476822-AddJobHireStatusTable";
import { AddFavoriteAndJobHireStatusLog1791100000000 } from "./migrations/1791100000000-AddFavoriteAndJobHireStatusLog";
import { AddConfigSnapshotForRunRecord1791440000000 } from "./migrations/1791440000000-AddConfigSnapshotForRunRecord";
import { AddJobCompanyBrandName1791740000000 } from "./migrations/1791740000000-AddJobCompanyBrandName";
import { AddSalaryUnits1792454400000 } from './migrations/1792454400000-AddSalaryUnits'
import { AddJobDiscovery1792454500000 } from './migrations/1792454500000-AddJobDiscovery'
import { BackfillJobNatures1792454600000 } from './migrations/1792454600000-BackfillJobNatures'
import { IndexAccountHistory1792454700000 } from './migrations/1792454700000-IndexAccountHistory'
import { AddJobRunScope1792630000000 } from './migrations/1792630000000-AddJobRunScope'
import { AddJobImportRecord1792630100000 } from './migrations/1792630100000-AddJobImportRecord'
import { FavoriteFolder } from "./entity/FavoriteFolder";
import { FavoriteJob } from "./entity/FavoriteJob";
import { JobHireStatusLog } from "./entity/JobHireStatusLog";
import chunk from 'lodash/chunk'
import * as typeorm from 'typeorm'

export function initDb(dbFilePath) {
  const { DataSource } = typeorm
  const appDataSource = new DataSource({
    type: "better-sqlite3",
    synchronize: false,
    logging: true,
    logger: "simple-console",
    database: dbFilePath,
    entities: [
      ChatStartupLog,
      BossInfo,
      BossInfoChangeLog,
      CompanyInfo,
      CompanyInfoChangeLog,
      JobInfo,
      JobInfoChangeLog,
      BossActiveStatusRecord,
      UserInfo,
      AutoStartChatRunRecord,
      VChatStartupLog,
      VBossLibrary,
      VJobLibrary,
      VCompanyLibrary,
      MarkAsNotSuitLog,
      VMarkAsNotSuitLog,
      ChatMessageRecord,
      LlmModelUsageRecord,
      JobHireStatusRecord,
      FavoriteFolder,
      FavoriteJob,
      JobHireStatusLog,
    ],
    migrations: [
      Init1000000000000,
      UpdateChatStartupLogTable1729182577167,
      UpdateBossInfoTable1732032381304,
      AddColumnForMarkAsNotSuitLog1746092370665,
      AddJobSourceColumnForChatStartupLogAndMarkAsNotSuitLog1752380078526,
      AddJobHireStatusTable1766466476822,
      AddFavoriteAndJobHireStatusLog1791100000000,
      AddConfigSnapshotForRunRecord1791440000000,
      AddJobCompanyBrandName1791740000000,
      AddSalaryUnits1792454400000,
      AddJobDiscovery1792454500000,
      BackfillJobNatures1792454600000,
      IndexAccountHistory1792454700000,
      AddJobRunScope1792630000000,
      AddJobImportRecord1792630100000
    ],
    migrationsRun: true
  });
  return appDataSource.initialize();
}

export default class SqlitePlugin {
  initPromise: Promise<DataSource>;
  runRecordId: number;
  collectOnlyMatched: boolean;
  comparisonScope: string | null;
  comparisonStartedEmpty = false;
  captureNetworkDetails: boolean;

  constructor(dbFilePath, { collectOnlyMatched = false, comparisonScope = null as string | null, captureNetworkDetails = true } = {}) {
    this.initPromise = initDb(dbFilePath);
    this.runRecordId = minimist(process.argv.slice(2))['run-record-id'] ?? 0
    this.collectOnlyMatched = collectOnlyMatched
    this.comparisonScope = comparisonScope
    this.captureNetworkDetails = captureNetworkDetails
  }

  userInfo = null
  historyContext: any = null

  apply(hooks) {
    if (this.collectOnlyMatched && !hooks.jobMatchedForCollection)
      throw new Error('Matched-only collection requires the post-filter storage hook')
    const saveDetail = createDetailWriter(async (detail) => {
      const ds = await this.initPromise
      await saveJobInfoFromRecommendPage(ds, detail, this.runRecordId)
      await saveJobHireStatusRecord(ds, {
        encryptJobId: detail.jobInfo.encryptId,
        hireStatus: JobHireStatus.HIRING,
        lastSeenDate: new Date()
      })
    }, 256, async (detail) => {
      const ds = await this.initPromise
      observeJob((ds.driver as any).databaseConnection, detail.jobInfo.encryptId, this.runRecordId)
    })
    hooks.pageGotten.tap(
      'SqlitePlugin',
      (page) => {
        if (this.collectOnlyMatched || !this.captureNetworkDetails) return
        page.on('response', async (response) => {
          if (response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/job/detail.json')) {
            try {
              const data = await response.json()
              if (data.code === 0) await saveDetail(data.zpData)
            } catch (error) { console.error('保存网络捕获的岗位详情失败', error) }
          }
        })
      }
    )
    hooks.userInfoResponse.tapPromise(
      "SqlitePlugin",
      async ({ userInfoResponse }: { userInfoResponse?: any } = {}) => {
        if (!userInfoResponse || ![0, '0'].includes(userInfoResponse.code)) {
          return;
        }
        const { zpData: userInfo } = userInfoResponse;
        if (typeof userInfo?.encryptUserId !== 'string' || !userInfo.encryptUserId.trim())
          throw new Error('LOGIN_STATUS_UNKNOWN')
        this.userInfo = userInfo

        const ds = await this.initPromise;
        const userInfoRepository = ds.getRepository(UserInfo);

        const user = new UserInfo();
        user.encryptUserId = userInfo.encryptUserId;
        user.name = userInfo.name;

        await userInfoRepository.save(user);
        if (this.runRecordId > 0)
          bindJobRunScope((ds.driver as any).databaseConnection, this.runRecordId, user.encryptUserId,
            this.comparisonScope, this.comparisonStartedEmpty)
        if (!this.historyContext) return
        const { blockJobNotSuit, blockBossNotNewChat, ...strategies } = this.historyContext
        const records = await getNotSuitMarkRecordsInLastSomeDays(ds, 7, user.encryptUserId)
        restoreLocalCooldowns(records, strategies, blockJobNotSuit)
        const chats = await getChatStartupRecordsInLastSomeDays(ds, 30, user.encryptUserId)
        const ids = [...new Set(chats.map(record => record.encryptJobId).filter(Boolean))]
        for (const jobIds of chunk(ids, 200)) {
          for (const boss of await getBossIdsByJobIds(ds, jobIds)) {
            if (boss.encryptBossId) blockBossNotNewChat.add(boss.encryptBossId)
          }
        }
      }
    );
    hooks.mainFlowWillLaunch.tapPromise(
      "SqlitePlugin",
      async (context) => {
        this.userInfo = null
        this.historyContext = context
        // This hook runs before navigation. Detail preloads may arrive before
        // userInfoResponse; they still belong to this attempt once it confirms
        // the account. A retry with earlier unconfirmed observations fails shut.
        const ds = await this.initPromise
        this.comparisonStartedEmpty = !(ds.driver as any).databaseConnection
          .prepare('SELECT 1 FROM job_run_observation WHERE runRecordId = ? LIMIT 1').get(this.runRecordId)
      }
    );

    hooks.jobDetailIsGetFromRecommendList.tapPromise('SqlitePlugin',
      this.collectOnlyMatched ? async () => {} : saveDetail)
    if (this.collectOnlyMatched) hooks.jobMatchedForCollection.tapPromise('SqlitePlugin', saveDetail)
    hooks.newChatWillStartup.tapPromise('SqlitePlugin', async () => {
      if (!this.userInfo?.encryptUserId) throw new Error('LOGIN_STATUS_UNKNOWN')
    })

    hooks.dailyQuotaSeed?.tapPromise('SqlitePlugin', async (seed: number, { accountId, day }: { accountId: string; day: string }) => {
      const ds = await this.initPromise
      const from = new Date(`${day}T00:00:00+08:00`)
      const to = new Date(from.getTime() + 86400000)
      const count = await ds.getRepository(ChatStartupLog).createQueryBuilder('chat')
        .where('chat.encryptCurrentUserId = :accountId', { accountId })
        .andWhere('chat.date >= :from AND chat.date < :to', {
          from: from.toISOString().replace('T', ' ').replace('Z', ''),
          to: to.toISOString().replace('T', ' ').replace('Z', '')
        })
        .andWhere('chat.chatStartupFrom IS NULL').getCount()
      return Math.max(seed || 0, count)
    })

    hooks.newChatStartup.tapPromise("SqlitePlugin", async (_jobInfo, { chatStartupFrom = ChatStartupFrom.AutoFromRecommendList, jobSource = undefined } = {}) => {
      const ds = await this.initPromise;
      return await saveChatStartupRecord(ds, _jobInfo, this.userInfo, {
        autoStartupChatRecordId: this.runRecordId,
        chatStartupFrom,
        jobSource
      });
    });

    hooks.jobMarkedAsNotSuit.tapPromise("SqlitePlugin", async (_jobInfo, { markFrom = ChatStartupFrom.AutoFromRecommendList, markReason = undefined, extInfo = undefined, markOp = undefined, jobSource = undefined } = {}) => {
      const ds = await this.initPromise;
      return await saveMarkAsNotSuitRecord(ds, _jobInfo, this.userInfo, {
        autoStartupChatRecordId: this.runRecordId,
        markFrom,
        markReason,
        extInfo,
        markOp,
        jobSource
      });
    });
  }
}
