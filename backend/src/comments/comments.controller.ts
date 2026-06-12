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

import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('comments')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  list(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.listForTask(taskId, user.userId);
  }

  @Post('tasks/:taskId/comments')
  create(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.create(taskId, user.userId, dto);
  }

  @Patch('comments/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.update(id, user.userId, dto);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.comments.remove(id, user.userId);
  }
}
