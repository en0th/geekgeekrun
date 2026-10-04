import { MarkAsNotSuitOp, MarkAsNotSuitReason } from "./enums";
const WEEK = 7 * 24 * 60 * 60 * 1000;
export function restoreLocalCooldowns(
  records,
  strategies,
  blocks,
  now = Date.now(),
) {
  const keys = {
    [MarkAsNotSuitReason.JOB_NOT_SUIT]: "jobNotMatchStrategy",
    [MarkAsNotSuitReason.USER_MANUAL_OPERATION_WITH_UNKNOWN_REASON]:
      "jobNotMatchStrategy",
    [MarkAsNotSuitReason.BOSS_INACTIVE]: "jobNotActiveStrategy",
    [MarkAsNotSuitReason.JOB_CITY_NOT_SUIT]: "expectCityNotMatchStrategy",
    [MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT]:
      "expectWorkExpNotMatchStrategy",
    [MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT]: "expectSalaryNotMatchStrategy",
    [MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT]:
      "blockCompanyNameRegMatchStrategy",
    [MarkAsNotSuitReason.POSTER_TITLE_NOT_SUIT]: "posterHrNotMatchStrategy",
  };
  for (const row of records) {
    const strategy = strategies[keys[row.markReason]];
    if (
      ![
        MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
        MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
      ].includes(strategy)
    )
      continue;
    if (
      ![
        MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
        MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
      ].includes(row.markOp)
    )
      continue;
    const deadline = new Date(row.date).getTime() + WEEK;
    if (!row.encryptJobId || !Number.isFinite(deadline) || deadline <= now)
      continue;
    if (blocks.addWithExpiry) blocks.addWithExpiry(row.encryptJobId, deadline);
    else blocks.add(row.encryptJobId);
  }
}
