import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddJobImportRecord1792630100000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE job_import_record (
      encryptJobId varchar PRIMARY KEY NOT NULL, sourceFormat varchar NOT NULL,
      sourceCapturedAt varchar, importedAt datetime NOT NULL, fileName varchar NOT NULL,
      companyName varchar, missingDescription integer NOT NULL
    )`)
    await runner.query('DROP VIEW IF EXISTS v_job_library')
    await runner.query(`CREATE VIEW v_job_library AS SELECT j.*, b.name AS bossName, b.title AS bossTitle,
      COALESCE(NULLIF(c.name, ''), i.companyName) AS companyName,
      COALESCE(NULLIF(c.brandName, ''), i.companyName) AS companyBrandName
      FROM job_info j LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
      LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId
      LEFT JOIN job_import_record i ON i.encryptJobId = j.encryptJobId`)
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP VIEW IF EXISTS v_job_library')
    await runner.query(`CREATE VIEW v_job_library AS SELECT j.*, b.name AS bossName, b.title AS bossTitle,
      c.name AS companyName, c.brandName AS companyBrandName FROM job_info j
      LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
      LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId`)
    await runner.query('DROP TABLE job_import_record')
  }
}
