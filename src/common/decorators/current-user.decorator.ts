import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name?: string; avatar?: string };
}

// 가드(SupabaseAuthGuard)를 통과한 요청의 req.user를 꺼내주는 파라미터 데코레이터
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
