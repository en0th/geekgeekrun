import { MigrationInterface, QueryRunner } from 'typeorm'

// Keep legacy monthly values and all existing rows. Old rows are backfilled on next visit.
export class AddSalaryUnits1792454400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "job_info" ADD "salaryDesc" varchar')
    await queryRunner.query('ALTER TABLE "job_info" ADD "salaryUnit" varchar')
    await queryRunner.query('ALTER TABLE "job_info" ADD "salaryAmountLow" real')
    await queryRunner.query('ALTER TABLE "job_info" ADD "salaryAmountHigh" real')
    await queryRunner.query('ALTER TABLE "job_info" ADD "jobNatureName" varchar')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['jobNatureName', 'salaryAmountHigh', 'salaryAmountLow', 'salaryUnit', 'salaryDesc'])
      await queryRunner.query(`ALTER TABLE "job_info" DROP COLUMN "${column}"`)
  }
}
