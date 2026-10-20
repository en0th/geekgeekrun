import { JobSource } from "../enums";
import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn } = typeorm

export const ChatStartupFrom = {
  AutoFromRecommendList: null,
  ManuallyFromRecommendList: 1
} as const
export type ChatStartupFrom = typeof ChatStartupFrom[keyof typeof ChatStartupFrom]

@Entity()
export class ChatStartupLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  encryptJobId!: string;

  @Column()
  encryptCurrentUserId!: string;

  @Column()
  date!: Date;

  @Column({
    type: 'integer',
    nullable: true
  })
  chatStartupFrom?: ChatStartupFrom;

  @Column({
    nullable: true
  })
  autoStartupChatRecordId?: number;

  @Column({
    nullable: true
  })
  jobSource?: JobSource;
}
