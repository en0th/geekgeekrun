import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn } = typeorm;

@Entity()
export class AutoStartChatRunRecord {
  @PrimaryGeneratedColumn()
  id: number;
  
  @Column()
  date: Date;

  // JSON snapshot of the settings the run started with (任务详情 → 任务配置)
  @Column({ type: 'text', nullable: true })
  configSnapshot: string | null;
}