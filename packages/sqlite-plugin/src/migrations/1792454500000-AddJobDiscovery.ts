import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddJobDiscovery1792454500000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // A separate ledger survives deletion of a job's saved details. Historical rows have
    // no reliable first-seen date and must never become newly discovered on the next visit.
    await runner.query(`CREATE TABLE job_discovery (
      encryptJobId varchar PRIMARY KEY NOT NULL,
      firstSeenAt datetime, firstSeenRunId integer,
      origin varchar NOT NULL, lastSeenAt datetime
    )`)
    await runner.query(`INSERT INTO job_discovery (encryptJobId, origin)
      SELECT encryptJobId, 'legacy' FROM job_info`)
    await runner.query(`CREATE TABLE job_run_observation (
      runRecordId integer NOT NULL, encryptJobId varchar NOT NULL,
      firstObservedAt datetime NOT NULL, lastObservedAt datetime NOT NULL,
      PRIMARY KEY (runRecordId, encryptJobId)
    )`)
    await runner.query('CREATE INDEX idx_job_discovery_run ON job_discovery (firstSeenRunId)')
    await runner.query('CREATE INDEX idx_job_observation_job ON job_run_observation (encryptJobId)')
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE job_run_observation')
    await runner.query('DROP TABLE job_discovery')
  }
}
