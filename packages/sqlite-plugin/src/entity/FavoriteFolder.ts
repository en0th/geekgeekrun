import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn } = typeorm;

@Entity()
export class FavoriteFolder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  createdAt: Date;
}
