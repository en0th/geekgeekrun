import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryColumn } = typeorm

@Entity()
export class JobInfo {
  @PrimaryColumn()
  encryptJobId: string;

  @Column()
  jobName: string;

  @Column()
  positionName: string;

  @Column({
    nullable: true
  })
  salaryLow?: number;

  @Column({
    nullable: true
  })
  salaryHigh?: number;

  @Column({
    nullable: true
  })
  salaryMonth?: number;

  @Column({ nullable: true })
  salaryDesc?: string;

  @Column({ nullable: true })
  salaryUnit?: string;

  @Column({ type: 'real', nullable: true })
  salaryAmountLow?: number;

  @Column({ type: 'real', nullable: true })
  salaryAmountHigh?: number;

  @Column({ nullable: true })
  jobNatureName?: string;

  @Column()
  experienceName: string;

  @Column({
    nullable: true
  })
  publishDate?: Date;

  @Column({
    nullable: true
  })
  degreeName?: string;

  @Column({
    nullable: true
  })
  address?: string;

  @Column()
  description: string;

  @Column()
  encryptBossId: string;

  @Column()
  encryptCompanyId: string;
}
