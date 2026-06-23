import { Module } from '@nestjs/common';

import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { StorageModule } from '../storage/storage.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [StorageModule, RealtimeModule],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
