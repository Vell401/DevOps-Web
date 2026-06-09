import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [JwtModule.register({}), forwardRef(() => ProjectsModule)],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
