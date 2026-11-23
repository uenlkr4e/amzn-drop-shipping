import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from './roles';

export class MeDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ROLES }) role: Role;
  @ApiProperty() twoFactorEnabled: boolean;
}
