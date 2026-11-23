import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { OpsStatusDto } from './ops.dto';
import { OpsService } from './ops.service';

@ApiTags('ops')
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('status')
  @Roles('admin', 'operator')
  @ApiOkResponse({ type: OpsStatusDto })
  status(): Promise<OpsStatusDto> {
    return this.ops.status();
  }
}
