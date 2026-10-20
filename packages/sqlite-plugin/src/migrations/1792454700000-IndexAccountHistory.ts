import type { MigrationInterface, QueryRunner } from 'typeorm'

export class IndexAccountHistory1792454700000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('CREATE INDEX IF NOT EXISTS idx_chat_startup_user_date ON chat_startup_log(encryptCurrentUserId, date)')
    await runner.query('CREATE INDEX IF NOT EXISTS idx_not_suit_user_date ON mark_as_not_suit_log(encryptCurrentUserId, date)')
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS idx_chat_startup_user_date')
    await runner.query('DROP INDEX IF EXISTS idx_not_suit_user_date')
  }
}
