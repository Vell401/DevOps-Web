import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Use AFTER JwtAccessGuard. Looks up the live `isAdmin` flag in the DB so a
 * just-demoted admin can't keep their old privileges by holding an unexpired
 * access token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthenticatedUser | undefined;
    if (!user?.userId) throw new ForbiddenException();
    const row = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { isAdmin: true },
    });
    if (!row?.isAdmin) throw new ForbiddenException('Admin access required');
    return true;
  }
}
