import { zodResolver } from '@hookform/resolvers/zod';

export const relaxedZodResolver = zodResolver as unknown as (
  schema: unknown,
) => any;
