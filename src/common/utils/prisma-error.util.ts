import { Prisma } from '../../../generated/prisma/client';

// FK 위반 SQLSTATE: 23001(restrict_violation, ON DELETE RESTRICT), 23503(foreign_key_violation)
const FK_VIOLATION_SQLSTATES = ['23001', '23503'];

// FK 제약 위반 여부. Prisma 7(adapter-pg)은 P2003 대신 P2039(드라이버 어댑터 에러)로 던지고
// 원래 DB 에러 코드는 meta.driverAdapterError.cause.originalCode에 담기므로 둘 다 확인한다
export function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2003') return true;
  if (error.code !== 'P2039') return false;

  const originalCode = (
    error.meta?.driverAdapterError as
      { cause?: { originalCode?: unknown } } | undefined
  )?.cause?.originalCode;
  return (
    typeof originalCode === 'string' &&
    FK_VIOLATION_SQLSTATES.includes(originalCode)
  );
}
