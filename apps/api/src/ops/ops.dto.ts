import { ApiProperty } from '@nestjs/swagger';

export class QueueStatusDto {
  @ApiProperty() name: string;
  @ApiProperty() waiting: number;
  @ApiProperty() active: number;
  @ApiProperty() delayed: number;
  @ApiProperty() failed: number;
  @ApiProperty() completed: number;
}

export class WorkerStatusDto {
  @ApiProperty() workerGroup: string;
  @ApiProperty() instanceId: string;
  @ApiProperty({ format: 'date-time' }) lastSeenAt: string;
  @ApiProperty() stale: boolean;
}

export class OpsStatusDto {
  @ApiProperty({ type: [QueueStatusDto] }) queues: QueueStatusDto[];
  @ApiProperty({ type: [WorkerStatusDto] }) workers: WorkerStatusDto[];
}
