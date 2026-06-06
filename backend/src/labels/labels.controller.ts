import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('labels')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('projects/:projectId/labels')
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.list(projectId, user.userId);
  }

  @Post('projects/:projectId/labels')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.create(projectId, user.userId, dto);
  }

  @Patch('labels/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.update(id, user.userId, dto);
  }

  @Delete('labels/:id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.labels.remove(id, user.userId);
  }
}
