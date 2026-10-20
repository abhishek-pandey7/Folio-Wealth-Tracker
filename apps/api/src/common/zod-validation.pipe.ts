import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Validates a request body with a shared zod contract; the handler receives the parsed value. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    // Requests without a body arrive as undefined; treat them as an empty object.
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException(z.prettifyError(result.error));
    }
    return result.data;
  }
}
