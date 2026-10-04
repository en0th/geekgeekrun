import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, Index } = typeorm;

// a job saved into a favorite folder; the same job can be in several folders
@Entity()
@Index(['folderId', 'encryptJobId'], { unique: true })
export class FavoriteJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  folderId: number;

  @Index()
  @Column()
  encryptJobId: string;

  @Column()
  createdAt: Date;
}
