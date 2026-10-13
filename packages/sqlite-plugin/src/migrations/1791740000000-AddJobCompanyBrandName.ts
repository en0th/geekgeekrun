import { MigrationInterface, QueryRunner } from 'typeorm';

// Expose the same brand used by live list filtering; no job/company rows are changed.
export class AddJobCompanyBrandName1791740000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP VIEW IF EXISTS "v_job_library"');
    await queryRunner.query(`CREATE VIEW "v_job_library" AS SELECT
      job_info.*, boss_info.name AS bossName, boss_info.title AS bossTitle,
      company_info.name AS companyName, company_info.brandName AS companyBrandName
      FROM job_info
      LEFT JOIN boss_info ON boss_info.encryptBossId = job_info.encryptBossId
      LEFT JOIN company_info ON company_info.encryptCompanyId = job_info.encryptCompanyId`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP VIEW IF EXISTS "v_job_library"');
    await queryRunner.query(`CREATE VIEW "v_job_library" AS SELECT
      job_info.*, boss_info.name AS bossName, boss_info.title AS bossTitle,
      company_info.name AS companyName FROM job_info
      LEFT JOIN boss_info ON boss_info.encryptBossId = job_info.encryptBossId
      LEFT JOIN company_info ON company_info.encryptCompanyId = job_info.encryptCompanyId`);
  }
}
