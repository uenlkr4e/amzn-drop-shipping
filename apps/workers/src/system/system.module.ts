import { QUEUE_NAMES } from '@dropship/queue';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SystemProcessor } from './system.processor';
import { SystemScheduler } from './system.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.system })],
  providers: [SystemProcessor, SystemScheduler],
})
export class SystemModule {}
