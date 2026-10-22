import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddJobRunScope1792630000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Historical observations have no proven scope/account. Do not invent one.
    await runner.query(`CREATE TABLE job_run_scope (
      runRecordId integer PRIMARY KEY NOT NULL,
      accountId varchar NOT NULL, signature varchar NOT NULL,
      comparable integer NOT NULL DEFAULT 1, reason varchar
    )`)
    await runner.query('CREATE INDEX idx_job_run_scope_identity ON job_run_scope (accountId, signature, comparable, runRecordId)')
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE job_run_scope')
  }
}
