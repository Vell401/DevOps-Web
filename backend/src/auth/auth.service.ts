import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Request context recorded alongside a login attempt. */
export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair & { userId: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, passwordHash },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, userId: user.id };
  }

  async login(
    dto: LoginDto,
    meta: LoginMeta = {},
  ): Promise<TokenPair & { userId: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Unknown email: nothing to attribute an audit record to, so just reject.
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordLogin(user.id, false, meta);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Login-block: a blocked user cannot obtain new tokens. Any access token
    // they already hold keeps working until it expires (~15m) by design.
    if (user.blocked) {
      await this.recordLogin(user.id, false, meta);
      throw new ForbiddenException(
        'Your account is blocked. Contact an administrator.',
      );
    }

    await Promise.all([
      this.recordLogin(user.id, true, meta),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, userId: user.id };
  }

  /** Best-effort audit record of a login attempt; never blocks auth on failure. */
  private async recordLogin(
    userId: string,
    success: boolean,
    meta: LoginMeta,
  ): Promise<void> {
    await this.prisma.loginEvent
      .create({
        data: {
          userId,
          success,
          ip: meta.ip?.slice(0, 45) ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      })
      .catch(() => undefined);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.cfg.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);

    // Atomic rotate: a single deleteMany consumes the token. If 0 rows are deleted,
    // either someone already used it (replay) or it never existed. In either case
    // wipe the user's whole refresh family — safest response to a possible theft.
    const deleted = await this.prisma.refreshToken.deleteMany({
      where: { tokenHash, userId: payload.sub, expiresAt: { gt: new Date() } },
    });

    if (deleted.count === 0) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    return this.issueTokens(payload.sub, payload.email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken
      .delete({ where: { tokenHash } })
      .catch(() => undefined);
  }

  /**
   * Self-service password change. Verifies the current password, stores the new
   * hash, and revokes every existing refresh session (defence against a leaked
   * session). A fresh token pair is then issued so the caller's current session
   * stays signed in while all other devices are logged out.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    return this.issueTokens(user.id, user.email);
  }

  private async issueTokens(userId: string, email: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.jwtAccessSecret,
      expiresIn: this.cfg.jwtAccessTtl,
    });

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti },
      {
        secret: this.cfg.jwtRefreshSecret,
        expiresIn: this.cfg.jwtRefreshTtl,
      },
    );

    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    const expiresAt = new Date(decoded.exp * 1000);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
