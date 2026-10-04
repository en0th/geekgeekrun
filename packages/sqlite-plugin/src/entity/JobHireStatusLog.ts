import * as typeorm from 'typeorm';
import { JobHireStatus } from "../enums";
const { Entity, Column, PrimaryGeneratedColumn, Index } = typeorm;

// one row per status change of a job (and its first observation), see saveJobHireStatusRecord
@Entity()
export class JobHireStatusLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  encryptJobId: string;

  @Column()
  hireStatus: JobHireStatus;

  @Column()
  checkedAt: Date;
}
