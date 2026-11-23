import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { MeDto } from './me.dto';
import type { AuthenticatedUser } from './session.guard';

@ApiTags('auth')
@Controller('me')
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthenticatedUser): MeDto {
    return user;
  }
}
