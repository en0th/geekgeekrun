import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddConfigSnapshotForRunRecord1791440000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("auto_start_chat_run_record")) {
      if (!await queryRunner.hasColumn("auto_start_chat_run_record", "configSnapshot")) {
        await queryRunner.addColumn(
          "auto_start_chat_run_record",
          new TableColumn({
            name: "configSnapshot",
            type: "text",
            isNullable: true,
          })
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
