import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';

describe('AuthService', () => {
  let service: AuthService;

  const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const cfgMock: Partial<AppConfigService> = {
    jwtAccessSecret: 'access-secret',
    jwtRefreshSecret: 'refresh-secret',
    jwtAccessTtl: '15m',
    jwtRefreshTtl: '7d',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'access-secret' })],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppConfigService, useValue: cfgMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    // Make sure jwt is wired
    moduleRef.get(JwtService);
  });

  describe('register', () => {
    it('throws ConflictException when email is taken', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
      await expect(
        service.register({ email: 'a@a.io', name: 'A', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates user and returns token pair', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({ id: 'u1', email: 'a@a.io' });
      prismaMock.refreshToken.create.mockResolvedValueOnce({});

      const result = await service.register({
        email: 'a@a.io',
        name: 'A',
        password: 'password123',
      });

      expect(result.userId).toBe('u1');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    it('throws on unknown email', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'x@x.io', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
