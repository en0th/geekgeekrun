import type { MigrationInterface, QueryRunner } from 'typeorm'
import { DETAIL_JOB_NATURES } from '@geekgeekrun/utils/job-values.cjs'

// Reuse the captured API evidence, not the title or pay period, for older saved rows.
export class BackfillJobNatures1792454600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const named = ['jobTypeName', 'jobNatureName', 'jobNature', 'jobType'].map(key =>
      `CASE json_extract(dataAsJson, '$.${key}') WHEN '全职' THEN '全职' WHEN '兼职' THEN '兼职' WHEN '实习' THEN '实习' END`)
    const detailCodes = Object.entries(DETAIL_JOB_NATURES).map(([code, label]) => `WHEN '${code}' THEN '${label}'`).join(' ')
    await runner.query(`WITH ranked AS MATERIALIZED (
      SELECT encryptJobId, dataAsJson,
        ROW_NUMBER() OVER (PARTITION BY encryptJobId ORDER BY updateTime DESC, id DESC) AS ordinal
      FROM job_info_change_log
    ), labels AS MATERIALIZED (
      SELECT encryptJobId, CASE WHEN json_valid(dataAsJson) THEN COALESCE(
        ${named.join(',')},
        CASE WHEN json_type(dataAsJson, '$.jobType') IN ('integer', 'text') THEN
          CASE CAST(json_extract(dataAsJson, '$.jobType') AS TEXT) ${detailCodes}
            WHEN '1901' THEN '全职' WHEN '1902' THEN '实习' WHEN '1903' THEN '兼职' END
        END) END AS label FROM ranked WHERE ordinal = 1
    ) UPDATE job_info AS j SET jobNatureName = labels.label FROM labels
      WHERE labels.encryptJobId = j.encryptJobId AND labels.label IS NOT NULL
        AND (j.jobNatureName IS NULL OR j.jobNatureName = '')`)
  }

  async down(): Promise<void> {
    // Derived data remains valid on rollback; do not clear labels saved by newer visits.
  }
}
