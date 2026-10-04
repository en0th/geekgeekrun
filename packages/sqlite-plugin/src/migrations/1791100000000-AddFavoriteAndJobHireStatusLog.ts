import { MigrationInterface, QueryRunner } from "typeorm"

// favorites and the job status history; only adds tables, existing data is untouched
export class AddFavoriteAndJobHireStatusLog1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "favorite_folder" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "createdAt" datetime NOT NULL);`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "favorite_job" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "folderId" integer NOT NULL, "encryptJobId" varchar NOT NULL, "createdAt" datetime NOT NULL);`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_favorite_job_folder_job" ON "favorite_job" ("folderId", "encryptJobId");`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_favorite_job_job" ON "favorite_job" ("encryptJobId");`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "job_hire_status_log" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "encryptJobId" varchar NOT NULL, "hireStatus" integer NOT NULL, "checkedAt" datetime NOT NULL);`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_job_hire_status_log_job" ON "job_hire_status_log" ("encryptJobId");`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "job_hire_status_log";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "favorite_job";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "favorite_folder";`);
  }
}
